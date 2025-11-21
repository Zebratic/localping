const { getDB } = require('../config/db');
const pingService = require('./pingService');
// sqliteService removed - using PostgreSQL via db.js now
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
  }

  /**
   * Start monitoring all enabled targets (non-blocking)
   */
  startMonitoring() {
    // Run in background to avoid blocking webserver startup
    setImmediate(async () => {
      try {
        const db = getDB();
        const targets = await db.collection('targets').find({ enabled: true }).toArray();

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
    const targetIdStr = target._id.toString();

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
      // Check debug logging setting (cache it, check every 60 seconds)
      if (!this.debugLoggingChecked || Date.now() - (this.debugLoggingLastCheck || 0) > 60000) {
        try {
          const db = getDB();
          const settings = await db.collection('adminSettings').findOne({ _id: 'settings' });
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
      const targetIdStr = target._id.toString();

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

      if (pingSuccess) {
        // Success - reset failure counter
        this.failureCount.set(targetIdStr, 0);
        newStatus = 'up';
      } else {
        // Failure - increment counter
        const currentFailures = (this.failureCount.get(targetIdStr) || 0) + 1;
        this.failureCount.set(targetIdStr, currentFailures);

        // Only mark as down if we've exceeded retry threshold
        if (currentFailures > maxRetries) {
          newStatus = 'down';
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
          const db = getDB();
          const timestamp = new Date();

          // Store ping result in database (non-blocking)
          db.collection('pingResults').insertOne({
            targetId: target._id,
            ...result,
            timestamp,
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

          // Ping results are stored via db.collection('pingResults').insertOne() above

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
          if (newStatus !== currentStatus && currentStatus !== 'unknown') {
            if (newStatus === 'down') {
              this.handleTargetDown(target).catch(err => {
                if (process.env.NODE_ENV === 'development') {
                  console.error(chalk.yellow(`Alert error for ${target.name}:`), err.message);
                }
              });
            } else if (newStatus === 'up') {
              this.handleTargetUp(target).catch(err => {
                if (process.env.NODE_ENV === 'development') {
                  console.error(chalk.yellow(`Alert error for ${target.name}:`), err.message);
                }
              });
            }
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
  async handleTargetDown(target) {
    const db = getDB();
    const now = Date.now();
    const lastAlertTime = this.lastAlertTime.get(target._id.toString()) || 0;
    const alertCooldown = (process.env.ALERT_COOLDOWN || 300) * 1000; // 5 minutes default

    // Create alert
    await db.collection('alerts').insertOne({
      targetId: target._id,
      type: 'down',
      timestamp: new Date(),
      message: `${target.name} is DOWN (${target.host} - ${target.protocol})`,
    });

    // Log alert if cooldown passed
    if (now - lastAlertTime > alertCooldown) {
      this.lastAlertTime.set(target._id.toString(), now);
      console.log(chalk.red(`✗ ${target.name} is DOWN`));
    }
  }

  /**
   * Handle target coming back up
   */
  async handleTargetUp(target) {
    const db = getDB();

    // Create alert
    await db.collection('alerts').insertOne({
      targetId: target._id,
      type: 'up',
      timestamp: new Date(),
      message: `${target.name} is UP (${target.host} - ${target.protocol})`,
    });

    // Log recovery
    console.log(chalk.green(`✓ ${target.name} is UP`));
  }

  /**
   * Update statistics for target
   */
  async updateStatistics(target, pingResult) {
    try {
      const db = getDB();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Try to update first (most common case)
      const stats = await db.collection('statistics').findOne({
        targetId: target._id,
        date: today,
      });

      if (stats) {
        // Update existing stats
        const updateData = {
          totalPings: stats.totalPings + 1,
          successfulPings: pingResult.success ? stats.successfulPings + 1 : stats.successfulPings,
          failedPings: !pingResult.success ? stats.failedPings + 1 : stats.failedPings,
          uptime: ((pingResult.success ? stats.successfulPings + 1 : stats.successfulPings) / (stats.totalPings + 1)) * 100,
          lastResponseTime: pingResult.responseTime || 0,
          avgResponseTime:
            (stats.avgResponseTime * stats.totalPings + (pingResult.responseTime || 0)) /
            (stats.totalPings + 1),
        };

        const result = await db.collection('statistics').updateOne(
          { targetId: target._id, date: today },
          { $set: updateData }
        );

        // If update didn't modify any rows, try insert (race condition)
        if (result.modifiedCount === 0) {
          try {
            await db.collection('statistics').insertOne({
              targetId: target._id,
              date: today,
              totalPings: 1,
              successfulPings: pingResult.success ? 1 : 0,
              failedPings: pingResult.success ? 0 : 1,
              uptime: pingResult.success ? 100 : 0,
              lastResponseTime: pingResult.responseTime || 0,
              avgResponseTime: pingResult.responseTime || 0,
            });
          } catch (insertError) {
            // If insert also fails, another process inserted - retry update
            if (insertError.message && insertError.message.includes('UNIQUE constraint')) {
              const retryStats = await db.collection('statistics').findOne({
                targetId: target._id,
                date: today,
              });
              if (retryStats) {
                const retryUpdateData = {
                  totalPings: retryStats.totalPings + 1,
                  successfulPings: pingResult.success ? retryStats.successfulPings + 1 : retryStats.successfulPings,
                  failedPings: !pingResult.success ? retryStats.failedPings + 1 : retryStats.failedPings,
                  uptime: ((pingResult.success ? retryStats.successfulPings + 1 : retryStats.successfulPings) / (retryStats.totalPings + 1)) * 100,
                  lastResponseTime: pingResult.responseTime || 0,
                  avgResponseTime:
                    (retryStats.avgResponseTime * retryStats.totalPings + (pingResult.responseTime || 0)) /
                    (retryStats.totalPings + 1),
                };
                await db.collection('statistics').updateOne(
                  { targetId: target._id, date: today },
                  { $set: retryUpdateData }
                );
              }
            }
          }
        }
      } else {
        // No stats exist, try to insert
        try {
          await db.collection('statistics').insertOne({
            targetId: target._id,
            date: today,
            totalPings: 1,
            successfulPings: pingResult.success ? 1 : 0,
            failedPings: pingResult.success ? 0 : 1,
            uptime: pingResult.success ? 100 : 0,
            lastResponseTime: pingResult.responseTime || 0,
            avgResponseTime: pingResult.responseTime || 0,
          });
        } catch (insertError) {
          // If insert failed due to race condition, retry with update
          if (insertError.message && insertError.message.includes('UNIQUE constraint')) {
            const existingStats = await db.collection('statistics').findOne({
              targetId: target._id,
              date: today,
            });
            if (existingStats) {
              const updateData = {
                totalPings: existingStats.totalPings + 1,
                successfulPings: pingResult.success ? existingStats.successfulPings + 1 : existingStats.successfulPings,
                failedPings: !pingResult.success ? existingStats.failedPings + 1 : existingStats.failedPings,
                uptime: ((pingResult.success ? existingStats.successfulPings + 1 : existingStats.successfulPings) / (existingStats.totalPings + 1)) * 100,
                lastResponseTime: pingResult.responseTime || 0,
                avgResponseTime:
                  (existingStats.avgResponseTime * existingStats.totalPings + (pingResult.responseTime || 0)) /
                  (existingStats.totalPings + 1),
              };
              await db.collection('statistics').updateOne(
                { targetId: target._id, date: today },
                { $set: updateData }
              );
            }
          }
        }
      }
    } catch (error) {
      // Silently ignore statistics errors to avoid log spam
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
