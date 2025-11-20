const { getDB } = require('../config/db');
const pingService = require('./pingService');
const notificationService = require('./notificationService');
const sqliteService = require('./sqliteService');
const chalk = require('../utils/colors');
const { v4: uuidv4 } = require('uuid');

class MonitorService {
  constructor() {
    this.intervals = new Map();
    this.targetStatus = new Map(); // Track current status of targets
    this.lastAlertTime = new Map(); // Prevent alert spam
    this.failureCount = new Map(); // Track consecutive failures for retry logic
  }

  /**
   * Start monitoring all enabled targets
   */
  async startMonitoring() {
    try {
      const db = getDB();
      const targets = await db.collection('targets').find({ enabled: true }).toArray();

      console.log(chalk.green(`✓ Starting monitor for ${targets.length} targets`));

      for (const target of targets) {
        this.startTargetMonitor(target);
      }
    } catch (error) {
      console.error(chalk.red('Error starting monitoring:'), error.message);
    }
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

    // Initialize status to 'unknown' - will be updated by first ping
    this.targetStatus.set(targetIdStr, 'unknown');

    // Initial ping
    this.pingTarget(target);

    // Set up interval
    const interval = setInterval(() => {
      this.pingTarget(target);
    }, (target.interval || 60) * 1000);

    this.intervals.set(targetIdStr, interval);
    console.log(chalk.blue(`↪ Monitoring ${target.name} every ${target.interval || 60}s`));
  }

  /**
   * Ping a target and store result
   */
  async pingTarget(target) {
    try {
      const result = await pingService.ping(target);
      const db = getDB();
      const timestamp = new Date();
      const targetIdStr = target._id.toString();

      // Store ping result in MongoDB
      await db.collection('pingResults').insertOne({
        targetId: target._id,
        ...result,
        timestamp,
      });

      // Also store in SQLite for local persistence
      sqliteService.storePingResult(targetIdStr, {
        success: result.success,
        responseTime: result.responseTime,
        statusCode: result.statusCode,
        error: result.error,
      });

      // Get current in-memory status
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

      // Only trigger alerts if status actually changed (not just unknown -> known)
      if (newStatus !== currentStatus && currentStatus !== 'unknown') {
        if (newStatus === 'down') {
          await this.handleTargetDown(target);
        } else if (newStatus === 'up') {
          await this.handleTargetUp(target);
        }
      }

      // Always update status
      this.targetStatus.set(targetIdStr, newStatus);

      // Update statistics
      await this.updateStatistics(target, result);
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

    // Send notification if cooldown passed
    if (now - lastAlertTime > alertCooldown) {
      await notificationService.alertTargetDown(target);
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

    // Send notification
    await notificationService.alertTargetUp(target);
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

        await db.collection('statistics').updateOne(
          { targetId: target._id, date: today },
          { $set: updateData }
        );
      } else {
        // Create new stats
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
      }
    } catch (error) {
      console.error(chalk.yellow('Warning updating statistics:'), error.message);
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
   * Get all monitoring intervals
   */
  getActiveMonitors() {
    return Array.from(this.intervals.keys());
  }
}

module.exports = new MonitorService();
