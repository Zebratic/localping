const { getPrisma } = require('../config/prisma');
const pingService = require('./pingService');
const chalk = require('../utils/colors');
const { v4: uuidv4 } = require('uuid');

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
  }

  /**
   * Start monitoring all enabled targets (non-blocking)
   */
  startMonitoring() {
    // Run in background to avoid blocking webserver startup
    setImmediate(async () => {
      try {
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
          Promise.allSettled(targets.map(target => this.pingTarget(target)))
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

    // Clear existing interval if any
    if (this.intervals.has(targetIdStr)) {
      clearInterval(this.intervals.get(targetIdStr));
    }

    // Status should already be set from initial ping in startMonitoring()
    // If not, initialize to 'unknown'
    if (!this.targetStatus.has(targetIdStr)) {
      this.targetStatus.set(targetIdStr, 'unknown');
    }

    // Set up interval (initial ping already done in startMonitoring())
    const interval = setInterval(() => {
      this.pingTarget(target);
    }, (target.interval || 60) * 1000);

    this.intervals.set(targetIdStr, interval);
    console.log(chalk.blue(`↪ Monitoring ${target.name} every ${target.interval || 60}s`));
  }

  /**
   * Ping a target and store result (non-blocking)
   */
  async pingTarget(target) {
    try {
      // Support both Prisma's 'id' and legacy '_id'
      const targetId = target.id || target._id;
      const targetIdStr = targetId.toString();

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

      if (pingSuccess) {
        // Success - reset failure counter
        this.failureCount.set(targetIdStr, 0);
        newStatus = 'up';
        // Calculate downtime duration before clearing the timestamp
        const downTime = this.downTimestamp.get(targetIdStr);
        downtimeDuration = downTime ? Date.now() - downTime : null;
        // Clear down timestamp and notification flag when coming back up
        this.downTimestamp.delete(targetIdStr);
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

          // Handle alerts (non-blocking)
          // Check if we need to send DOWN notification (after 3+ consecutive failures)
          if (newStatus === 'down') {
            const consecutiveFailures = this.failureCount.get(targetIdStr) || 0;
            if (consecutiveFailures >= 3 && !this.notificationSent.get(targetIdStr)) {
              this.notificationSent.set(targetIdStr, true);
              this.handleTargetDown(target, result.responseTime).catch(err => {
                if (process.env.NODE_ENV === 'development') {
                  console.error(chalk.yellow(`Alert error for ${target.name}:`), err.message);
                }
              });
            }
          }
          
          // Handle status changes
          if (newStatus !== currentStatus && currentStatus !== 'unknown') {
            if (newStatus === 'up') {
              // Use downtime duration calculated before timestamp was deleted (captured in closure)
              this.handleTargetUp(target, result.responseTime, downtimeDuration).catch(err => {
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
  async handleTargetUp(target, responseTime = null, downtimeDuration = null) {
    const prisma = getPrisma();
    const targetId = target.id || target._id;

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
    if (this.intervals.has(targetIdStr)) {
      clearInterval(this.intervals.get(targetIdStr));
      this.intervals.delete(targetIdStr);
      this.targetStatus.delete(targetIdStr);
      this.lastAlertTime.delete(targetIdStr);
      this.failureCount.delete(targetIdStr);
      this.downTimestamp.delete(targetIdStr);
      this.notificationSent.delete(targetIdStr);
      console.log(chalk.yellow(`⊘ Stopped monitoring ${targetIdStr}`));
    }
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
