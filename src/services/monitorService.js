const { getPrisma } = require('../config/prisma');
const pingService = require('./pingService');
const chalk = require('../utils/colors');

class MonitorService {
  constructor() {
    this.intervals = new Map();
    this.targetStatus = new Map(); // Track current status of targets
    this.debugLogging = false; // Cache debug logging setting
    this.debugLoggingChecked = false; // Track if we've checked the setting
    this.lastAlertTime = new Map(); // Prevent alert spam
    this.failureCount = new Map(); // Track consecutive failures for retry logic
    this.downTimestamp = new Map(); // Track when monitor went down
    this.notificationSent = new Map(); // Track if notification was sent for current down state
    this.notificationTimers = new Map(); // Delay monitor notifications until the outage is sustained
    this.notificationScheduling = new Map();
    this.monitorGeneration = new Map(); // Ignore results from monitors that were restarted
    this.inFlight = new Map(); // Prevent overlapping pings without blocking restarted monitors
    this.monitorTargets = new Map();
    this.notificationDelayMinutes = 5;
    this.notificationDelayVersion = 0;
    this.lastNotificationSentAt = new Map();
  }

  /**
   * Start monitoring all enabled targets (non-blocking)
   */
  startMonitoring() {
    // Run in background to avoid blocking webserver startup
    setImmediate(async () => {
      try {
        // Prime the delay before the first failures can be recorded.
        try {
          const notificationService = require('./notificationService');
          this.setNotificationDelayMinutes(await notificationService.getMonitorDownDelayMinutes());
        } catch (error) {
          // Keep the safe five-minute default if settings are unavailable.
        }
        const prisma = getPrisma();
        const targets = await prisma.target.findMany({ where: { enabled: true } });

        console.log(chalk.green(`✓ Starting monitor for ${targets.length} targets`));

        // Set up monitoring intervals for all targets immediately
        for (const target of targets) {
          this.startTargetMonitor(target);
        }

        // Ping all targets in background to get current status (non-blocking)
        if (targets.length > 0) {
          console.log(chalk.blue('↪ Pinging all monitors to get current status (background)...'));
          // Don't await - let it run in background
          Promise.allSettled(targets.map(target => this.pingTarget(target, this.monitorGeneration.get((target.id || target._id).toString()))))
            .then(() => {
              console.log(chalk.green('✓ Initial ping complete, status updated'));
            })
            .catch((error) => {
              console.error(chalk.yellow('Some initial pings failed:'), error.message);
            });
        }
      } catch (error) {
        console.error(chalk.red('Error starting monitoring:'), error.message);
      }
    });
  }

  /**
   * Start monitoring a single target
   */
  startTargetMonitor(target) {
    // Support both Prisma's 'id' and legacy '_id'
    const targetIdStr = (target.id || target._id).toString();
    const generation = (this.monitorGeneration.get(targetIdStr) || 0) + 1;
    this.monitorGeneration.set(targetIdStr, generation);
    this.monitorTargets.set(targetIdStr, target);

    // Clear existing interval if any
    if (this.intervals.has(targetIdStr)) {
      clearInterval(this.intervals.get(targetIdStr));
      // A restarted generation must not inherit a timer whose callback still
      // carries the previous generation token. Keep the outage timestamp so a
      // restart does not manufacture a fresh outage, then let the next ping
      // schedule against the active delay.
      this.clearNotificationTimer(targetIdStr);
      this.notificationScheduling.delete(targetIdStr);
    }

    // Status should already be set from initial ping in startMonitoring()
    // If not, initialize to 'unknown'
    if (!this.targetStatus.has(targetIdStr)) {
      this.targetStatus.set(targetIdStr, 'unknown');
    }

    // Set up interval (initial ping already done in startMonitoring())
    const interval = setInterval(() => {
      const currentTarget = this.monitorTargets.get(targetIdStr) || target;
      this.pingTarget(currentTarget, generation);
    }, (target.interval || 60) * 1000);

    this.intervals.set(targetIdStr, interval);
    console.log(chalk.blue(`↪ Monitoring ${target.name} every ${target.interval || 60}s`));
  }

  /**
   * Replace the target metadata used by an active monitor without resetting
   * its status, retry counters, or sustained-outage timer. Public visibility,
   * labels, icons, and notification metadata can change while a service is
   * down; those changes should not restart the outage clock.
   */
  updateTargetReference(target) {
    const targetId = target.id || target._id;
    if (targetId === undefined || targetId === null) return;
    const targetIdStr = targetId.toString();
    if (this.monitorTargets.has(targetIdStr)) {
      this.monitorTargets.set(targetIdStr, target);
    }
  }

  /**
   * Ping a target and store result (non-blocking)
   */
  async pingTarget(target, expectedGeneration = null) {
    const targetId = target.id || target._id;
    const targetIdStr = targetId.toString();
    // Give direct/manual pings the same generation protection as interval
    // pings. This also means a monitor started while a direct ping is in
    // flight can invalidate that result safely.
    if (!this.monitorGeneration.has(targetIdStr)) {
      this.monitorGeneration.set(targetIdStr, 0);
    }
    // Calls made by an interval carry an explicit generation. Direct calls
    // (for example a startup ping or an admin test) inherit the current one
    // so a result cannot update a monitor after it has been restarted.
    const pingGeneration = expectedGeneration ?? this.monitorGeneration.get(targetIdStr);
    if (this.monitorGeneration.get(targetIdStr) !== pingGeneration) return;
    const activePing = this.inFlight.get(targetIdStr);
    if (activePing && activePing.generation === pingGeneration) return;
    const pingToken = {};
    this.inFlight.set(targetIdStr, { generation: pingGeneration, token: pingToken });

    try {
      // Support both Prisma's 'id' and legacy '_id'

      // Check debug logging setting (cache it, check every 60 seconds)
      if (!this.debugLoggingChecked || Date.now() - (this.debugLoggingLastCheck || 0) > 60000) {
        try {
          const prisma = getPrisma();
          const settings = await prisma.adminSettings.findUnique({ where: { id: 'settings' } });
          this.debugLogging = settings?.debugLogging === true;
          this.debugLoggingChecked = true;
          this.debugLoggingLastCheck = Date.now();
        } catch (err) {
          // If we can't check, default to false
          this.debugLogging = false;
        }
      }

      // Ping is now non-blocking via worker threads
      const result = await pingService.ping(target);
      if (pingGeneration !== null && this.monitorGeneration.get(targetIdStr) !== pingGeneration) return;

      // Debug logging
      if (this.debugLogging) {
        const timestamp = new Date().toISOString();
        const status = result.success ? chalk.green('✓ UP') : chalk.red('✗ DOWN');
        const responseTime = result.responseTime ? `${Math.round(result.responseTime)}ms` : 'N/A';
        const protocol = result.protocol || target.protocol || 'UNKNOWN';
        console.log(chalk.cyan(`[${timestamp}]`) + ` ${status} ${chalk.yellow(target.name)} (${target.host}:${target.port || 'default'}) - ${protocol} - ${responseTime}`);
        if (result.error) {
          console.log(chalk.gray(`  Error: ${result.error}`));
        }
        if (result.statusCode) {
          console.log(chalk.gray(`  Status Code: ${result.statusCode}`));
        }
      }

      // Get current in-memory status (synchronous, fast)
      const currentStatus = this.targetStatus.get(targetIdStr);

      // Determine status based on ping result and upside down mode
      let pingSuccess = result.success;
      if (target.upsideDown === true) {
        pingSuccess = !pingSuccess; // Invert the status
      }

      // Handle retry logic
      const maxRetries = target.retries || 0;
      let newStatus = 'unknown';
      let downtimeDuration = null; // Capture downtime duration for notification
      let wasNotificationSent = false;

      if (pingSuccess) {
        // Success - reset failure counter
        this.failureCount.set(targetIdStr, 0);
        newStatus = 'up';
        // Calculate downtime duration before clearing the timestamp
        const downTime = this.downTimestamp.get(targetIdStr);
        downtimeDuration = downTime ? Date.now() - downTime : null;
        wasNotificationSent = this.notificationSent.get(targetIdStr) === true;
        // Clear down timestamp and notification flag when coming back up
        this.downTimestamp.delete(targetIdStr);
        this.clearNotificationTimer(targetIdStr);
        this.notificationSent.delete(targetIdStr);
      } else {
        // Failure - increment counter
        const currentFailures = (this.failureCount.get(targetIdStr) || 0) + 1;
        this.failureCount.set(targetIdStr, currentFailures);

        // Only mark as down if we've exceeded retry threshold
        if (currentFailures > maxRetries) {
          newStatus = 'down';
          // Track when monitor went down (only set once)
          if (!this.downTimestamp.has(targetIdStr)) {
            this.downTimestamp.set(targetIdStr, Date.now());
          }
          this.scheduleDownNotification(target, targetIdStr, result.responseTime, pingGeneration);
        } else {
          // Still retrying, keep current status or mark as unknown
          newStatus = currentStatus || 'unknown';
        }
      }

      // Always update status immediately (in-memory, fast)
      this.targetStatus.set(targetIdStr, newStatus);

      // Defer database operations to next tick to avoid blocking
      setImmediate(async () => {
        try {
          // The monitor may have been disabled or restarted while the ping
          // result was waiting for the event loop. Do not persist or emit
          // status events from that stale generation.
          if (this.monitorGeneration.get(targetIdStr) !== pingGeneration) return;
          const prisma = getPrisma();
          const timestamp = new Date();

          // Store ping result in database (non-blocking)
          prisma.pingResult.create({
            data: {
              targetId: targetId,
              success: result.success,
              responseTime: result.responseTime || null,
              timestamp,
              statusCode: result.statusCode || null,
              error: result.error || null,
              protocol: result.protocol || null,
            },
          }).then(() => {
            // Debug logging for successful DB write
            if (this.debugLogging) {
              console.log(chalk.gray(`  → Ping result saved to database`));
            }
          }).catch(err => {
            // Log DB errors to help diagnose issues
            console.error(chalk.red(`✗ DB write error for ${target.name}:`), err.message);
            console.error(chalk.gray('  Error details:'), err);
          });

          // Update statistics (non-blocking)
          this.updateStatistics(target, result).then(() => {
            // Debug logging for successful statistics update
            if (this.debugLogging) {
              console.log(chalk.gray(`  → Statistics updated`));
            }
          }).catch((err) => {
            // Log statistics errors to help diagnose issues
            console.error(chalk.red(`✗ Statistics update error for ${target.name}:`), err.message);
            console.error(chalk.gray('  Error details:'), err);
          });

          // Handle status changes
          if (newStatus !== currentStatus && currentStatus !== 'unknown') {
            if (newStatus === 'up') {
              // Use downtime duration calculated before timestamp was deleted (captured in closure)
              this.handleTargetUp(target, result.responseTime, downtimeDuration, wasNotificationSent).catch(err => {
                if (process.env.NODE_ENV === 'development') {
                  console.error(chalk.yellow(`Alert error for ${target.name}:`), err.message);
                }
              });
            }

            // Evaluate event detection rules (non-blocking)
            setImmediate(async () => {
              try {
                const eventDetectionService = require('./eventDetectionService');
                await eventDetectionService.evaluateRules({
                  targetId: targetIdStr,
                  target: target,
                  status: newStatus,
                  responseTime: result.responseTime,
                  targetGroup: target.group,
                });
              } catch (error) {
                // Silently fail - event detection is not critical
                if (process.env.NODE_ENV === 'development') {
                  console.error(chalk.yellow(`Event detection error for ${target.name}:`), error.message);
                }
              }
            });
          }
        } catch (error) {
          // Silently handle errors to avoid blocking
          if (process.env.NODE_ENV === 'development') {
            console.error(chalk.yellow(`Error processing result for ${target.name}:`), error.message);
          }
        }
      });
    } catch (error) {
      console.error(chalk.red(`Error pinging ${target.name}:`), error.message);
    } finally {
      // A newer generation may already be pinging this target. Do not let an
      // older worker completion clear the newer request's in-flight marker.
      if (this.inFlight.get(targetIdStr)?.token === pingToken) {
        this.inFlight.delete(targetIdStr);
      }
    }
  }

  getNotificationDelayMs() {
    return Math.max(1, this.notificationDelayMinutes || 5) * 60 * 1000;
  }

  setNotificationDelayMinutes(value, options = {}) {
    const parsed = Number.parseInt(value, 10);
    const nextDelay = Number.isFinite(parsed) ? Math.min(1440, Math.max(1, parsed)) : 5;
    const changed = nextDelay !== this.notificationDelayMinutes;
    this.notificationDelayMinutes = nextDelay;
    if (changed) {
      this.notificationDelayVersion += 1;
      if (options.reschedule !== false) this.rescheduleNotificationTimers();
    }
  }

  getNotificationState(targetId) {
    const id = targetId.toString ? targetId.toString() : String(targetId);
    const downSince = this.downTimestamp.get(id) || null;
    const downDurationMs = downSince ? Math.max(0, Date.now() - downSince) : 0;
    return {
      downSince: downSince ? new Date(downSince).toISOString() : null,
      downDurationMs,
      notificationDelayMinutes: this.notificationDelayMinutes,
      notificationEligible: Boolean(downSince && downDurationMs >= this.getNotificationDelayMs()),
      notificationSent: this.notificationSent.get(id) === true,
      lastNotificationSentAt: this.lastNotificationSentAt.get(id) || null,
    };
  }

  clearNotificationTimer(targetId) {
    const timer = this.notificationTimers.get(targetId);
    if (timer) clearTimeout(timer);
    this.notificationTimers.delete(targetId);
  }

  async scheduleDownNotification(target, targetIdStr, responseTime = null, expectedGeneration = null) {
    if (expectedGeneration !== null && this.monitorGeneration.get(targetIdStr) !== expectedGeneration) return;
    if (this.notificationSent.get(targetIdStr) || this.notificationTimers.has(targetIdStr) || this.notificationScheduling.has(targetIdStr)) return;
    const schedulingGeneration = expectedGeneration ?? this.monitorGeneration.get(targetIdStr) ?? null;
    this.notificationScheduling.set(targetIdStr, schedulingGeneration);
    const delayVersionAtStart = this.notificationDelayVersion;
    try {
      let delayMinutes = this.notificationDelayMinutes;
      try {
        const notificationService = require('./notificationService');
        if (typeof notificationService.getMonitorDownDelayMinutes === 'function') {
          delayMinutes = await notificationService.getMonitorDownDelayMinutes();
        }
      } catch (error) {
        // Keep scheduling with the safe in-memory default when the settings
        // store is temporarily unavailable. The next outage check can pick
        // up the persisted value once the database is healthy again.
        if (process.env.NODE_ENV === 'development') {
          console.error(chalk.yellow(`Notification settings lookup failed for ${target.name}:`), error.message);
        }
      }
      // A settings update may have happened while the database lookup was in
      // flight. Do not let an older lookup overwrite the newly selected global
      // delay; use the current in-memory value in that case.
      if (this.notificationDelayVersion === delayVersionAtStart) {
        this.setNotificationDelayMinutes(delayMinutes, { reschedule: false });
      }
      const downSince = this.downTimestamp.get(targetIdStr);
      if (!downSince || this.notificationSent.get(targetIdStr)) return;
      if ((this.monitorGeneration.get(targetIdStr) ?? null) !== schedulingGeneration) return;
      const remaining = Math.max(0, downSince + this.getNotificationDelayMs() - Date.now());
      const timer = setTimeout(() => {
        this.notificationTimers.delete(targetIdStr);
        if ((this.monitorGeneration.get(targetIdStr) ?? null) !== schedulingGeneration) return;
        if (this.targetStatus.get(targetIdStr) !== 'down' || !this.downTimestamp.has(targetIdStr) || this.notificationSent.get(targetIdStr)) return;
        this.notificationSent.set(targetIdStr, true);
        this.lastNotificationSentAt.set(targetIdStr, new Date().toISOString());
        const currentTarget = this.monitorTargets.get(targetIdStr) || target;
        this.handleTargetDown(currentTarget, responseTime).catch(err => {
          if (process.env.NODE_ENV === 'development') console.error(chalk.yellow(`Alert error for ${target.name}:`), err.message);
        });
      }, remaining);
      this.notificationTimers.set(targetIdStr, timer);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.error(chalk.yellow(`Notification scheduling error for ${target.name}:`), error.message);
    } finally {
      if (this.notificationScheduling.get(targetIdStr) === schedulingGeneration) {
        this.notificationScheduling.delete(targetIdStr);
      }
    }
  }

  rescheduleNotificationTimers() {
    for (const [targetIdStr, target] of this.monitorTargets.entries()) {
      if (this.downTimestamp.has(targetIdStr) && !this.notificationSent.get(targetIdStr)) {
        this.clearNotificationTimer(targetIdStr);
        this.scheduleDownNotification(target, targetIdStr, null, this.monitorGeneration.get(targetIdStr) ?? null);
      }
    }
  }

  /**
   * Handle target going down
   */
  async handleTargetDown(target, responseTime = null) {
    const prisma = getPrisma();
    const targetId = target.id || target._id;
    const targetIdStr = targetId.toString();
    const now = Date.now();
    const lastAlertTime = this.lastAlertTime.get(targetIdStr) || 0;
    const alertCooldown = (process.env.ALERT_COOLDOWN || 300) * 1000; // 5 minutes default

    // Create alert
    await prisma.alert.create({
      data: {
        targetId: targetId,
        type: 'down',
        timestamp: new Date(),
        message: `${target.name} is DOWN (${target.host} - ${target.protocol})`,
      },
    });

    // Log alert if cooldown passed
    if (now - lastAlertTime > alertCooldown) {
      this.lastAlertTime.set(targetIdStr, now);
      console.log(chalk.red(`✗ ${target.name} is DOWN`));
    }

    // Send external notifications (non-blocking)
    setImmediate(async () => {
      try {
        const notificationService = require('./notificationService');
        await notificationService.notifyMonitorStatus(target, 'down', responseTime);
      } catch (error) {
        // Silently fail - notifications are not critical
        if (process.env.NODE_ENV === 'development') {
          console.error(chalk.yellow(`Notification error for ${target.name}:`), error.message);
        }
      }
    });
  }

  /**
   * Handle target coming back up
   */
  async handleTargetUp(target, responseTime = null, downtimeDuration = null, notificationWasSent = null) {
    const prisma = getPrisma();
    const targetId = target.id || target._id;
    const shouldNotify = notificationWasSent === null
      ? this.notificationSent.get(targetId.toString()) === true
      : notificationWasSent === true;

    // Create alert
    await prisma.alert.create({
      data: {
        targetId: targetId,
        type: 'up',
        timestamp: new Date(),
        message: `${target.name} is UP (${target.host} - ${target.protocol})`,
      },
    });

    // Log recovery
    console.log(chalk.green(`✓ ${target.name} is UP`));

    // A recovery notification is paired with a previously emitted outage
    // notification. Short or otherwise unnotified outages stay silent while
    // the internal alert history still records the state transition.
    if (!shouldNotify) {
      return { skipped: true, reason: 'Outage shorter than notification delay' };
    }

    // Send external notifications (non-blocking)
    setImmediate(async () => {
      try {
        const notificationService = require('./notificationService');
        await notificationService.notifyMonitorStatus(target, 'up', responseTime, downtimeDuration);
      } catch (error) {
        // Silently fail - notifications are not critical
        if (process.env.NODE_ENV === 'development') {
          console.error(chalk.yellow(`Notification error for ${target.name}:`), error.message);
        }
      }
    });
  }

  /**
   * Update statistics for target
   */
  async updateStatistics(target, pingResult) {
    try {
      const prisma = getPrisma();
      const targetId = target.id || target._id;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Use upsert for atomic update or insert
      const stats = await prisma.statistic.findUnique({
        where: {
          targetId_date: {
            targetId: targetId,
            date: today,
          },
        },
      });

      if (stats) {
        // Update existing stats
        const newTotalPings = stats.totalPings + 1;
        const newSuccessfulPings = pingResult.success ? stats.successfulPings + 1 : stats.successfulPings;
        const newFailedPings = !pingResult.success ? stats.failedPings + 1 : stats.failedPings;

        await prisma.statistic.update({
          where: {
            targetId_date: {
              targetId: targetId,
              date: today,
            },
          },
          data: {
            totalPings: newTotalPings,
            successfulPings: newSuccessfulPings,
            failedPings: newFailedPings,
            uptime: (newSuccessfulPings / newTotalPings) * 100,
            lastResponseTime: pingResult.responseTime || 0,
            avgResponseTime:
              (stats.avgResponseTime * stats.totalPings + (pingResult.responseTime || 0)) / newTotalPings,
          },
        });
      } else {
        // Create new stats
        await prisma.statistic.create({
          data: {
            targetId: targetId,
            date: today,
            totalPings: 1,
            successfulPings: pingResult.success ? 1 : 0,
            failedPings: pingResult.success ? 0 : 1,
            uptime: pingResult.success ? 100 : 0,
            lastResponseTime: pingResult.responseTime || 0,
            avgResponseTime: pingResult.responseTime || 0,
          },
        });
      }
    } catch (error) {
      // Handle unique constraint violation (race condition) - retry
      if (error.code === 'P2002') {
        try {
          const prisma = getPrisma();
          const targetId = target.id || target._id;
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const existingStats = await prisma.statistic.findUnique({
            where: {
              targetId_date: {
                targetId: targetId,
                date: today,
              },
            },
          });

          if (existingStats) {
            const newTotalPings = existingStats.totalPings + 1;
            const newSuccessfulPings = pingResult.success ? existingStats.successfulPings + 1 : existingStats.successfulPings;
            const newFailedPings = !pingResult.success ? existingStats.failedPings + 1 : existingStats.failedPings;

            await prisma.statistic.update({
              where: {
                targetId_date: {
                  targetId: targetId,
                  date: today,
                },
              },
              data: {
                totalPings: newTotalPings,
                successfulPings: newSuccessfulPings,
                failedPings: newFailedPings,
                uptime: (newSuccessfulPings / newTotalPings) * 100,
                lastResponseTime: pingResult.responseTime || 0,
                avgResponseTime:
                  (existingStats.avgResponseTime * existingStats.totalPings + (pingResult.responseTime || 0)) / newTotalPings,
              },
            });
          }
        } catch (retryError) {
          // Silently ignore retry errors
        }
      }
      // Silently ignore other statistics errors to avoid log spam
      // They're not critical for core functionality
    }
  }

  /**
   * Stop monitoring a target
   */
  stopTargetMonitor(targetId) {
    const targetIdStr = targetId.toString ? targetId.toString() : targetId;
    // Invalidate any ping that is still awaiting a worker response. This is
    // important when a monitor is disabled or its settings are replaced.
    this.monitorGeneration.set(targetIdStr, (this.monitorGeneration.get(targetIdStr) || 0) + 1);
    if (this.intervals.has(targetIdStr)) {
      clearInterval(this.intervals.get(targetIdStr));
      this.intervals.delete(targetIdStr);
      console.log(chalk.yellow(`⊘ Stopped monitoring ${targetIdStr}`));
    }
    this.targetStatus.delete(targetIdStr);
    this.lastAlertTime.delete(targetIdStr);
    this.failureCount.delete(targetIdStr);
    this.downTimestamp.delete(targetIdStr);
    this.notificationSent.delete(targetIdStr);
    this.lastNotificationSentAt.delete(targetIdStr);
    this.clearNotificationTimer(targetIdStr);
    this.notificationScheduling.delete(targetIdStr);
    this.monitorTargets.delete(targetIdStr);
    this.inFlight.delete(targetIdStr);
  }

  /**
   * Stop all monitoring
   */
  stopAllMonitoring() {
    for (const [targetId, interval] of this.intervals.entries()) {
      clearInterval(interval);
    }
    this.intervals.clear();
    this.targetStatus.clear();
    this.lastAlertTime.clear();
    this.failureCount.clear();
    this.downTimestamp.clear();
    this.notificationSent.clear();
    this.lastNotificationSentAt.clear();
    for (const timer of this.notificationTimers.values()) clearTimeout(timer);
    this.notificationTimers.clear();
    this.notificationScheduling.clear();
    this.monitorTargets.clear();
    this.inFlight.clear();
    // Keep generation numbers monotonic so a ping from before a full stop
    // cannot be mistaken for a ping from a newly started monitor that reuses
    // the same id.
    for (const [targetId, generation] of this.monitorGeneration.entries()) {
      this.monitorGeneration.set(targetId, generation + 1);
    }
    console.log(chalk.yellow('⊘ Stopped all monitoring'));
  }

  /**
   * Get target status
   */
  getTargetStatus(targetId) {
    return this.targetStatus.get(targetId.toString ? targetId.toString() : targetId) || 'unknown';
  }

  /**
   * Set target status (for manual updates like test endpoints)
   */
  setTargetStatus(targetId, status) {
    const targetIdStr = targetId.toString ? targetId.toString() : targetId;
    this.targetStatus.set(targetIdStr, status);
  }

  /**
   * Get all monitoring intervals
   */
  getActiveMonitors() {
    return Array.from(this.intervals.keys());
  }
}

module.exports = new MonitorService();
