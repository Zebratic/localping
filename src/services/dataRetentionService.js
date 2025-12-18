const { getPrisma } = require('../config/prisma');
const chalk = require('../utils/colors');

/**
 * Data Retention Service
 *
 * Manages data retention by:
 * 1. Keeping all data points within the retention period
 * 2. For data older than retention period, minimizing data points
 *    by keeping only important ones (min, max, and strategic samples)
 */
class DataRetentionService {
  /**
   * Get data retention settings
   */
  async getRetentionSettings() {
    try {
      const prisma = getPrisma();
      const settings = await prisma.adminSettings.findUnique({ where: { id: 'settings' } });
      return settings?.dataRetentionDays || 30;
    } catch (error) {
      console.error(chalk.red('Error getting retention settings:'), error.message);
      return 30; // Default to 30 days
    }
  }

  /**
   * Process data retention for a specific target
   * Optimized strategy:
   * - Last 30 days: Keep all raw data (for 1H, 24H, 7D, 30D graphs)
   * - 31-90 days: Aggregate to hourly buckets (keep 1 point per hour)
   * - 90+ days: Aggregate to daily buckets (keep 1 point per day)
   * - Statistics table always maintained for uptime calculations
   */
  async processRetentionForTarget(targetId) {
    try {
      const prisma = getPrisma();
      const now = new Date();

      // Define retention periods
      const keepRawDays = 30; // Keep all raw data for last 30 days
      const keepHourlyDays = 90; // Keep hourly aggregations for 31-90 days
      
      const rawCutoff = new Date(now);
      rawCutoff.setDate(rawCutoff.getDate() - keepRawDays);
      
      const hourlyCutoff = new Date(now);
      hourlyCutoff.setDate(hourlyCutoff.getDate() - keepHourlyDays);

      let totalDeleted = 0;

      // Step 1: Process 31-90 days range - aggregate to hourly buckets
      const hourlyData = await prisma.pingResult.findMany({
        where: {
          targetId: targetId,
          timestamp: {
            gte: hourlyCutoff,
            lt: rawCutoff,
          },
        },
        orderBy: { timestamp: 'asc' },
      });

      if (hourlyData.length > 0) {
        // Group by hour
        const hourlyBuckets = new Map();
        hourlyData.forEach(row => {
          const hourKey = new Date(row.timestamp);
          hourKey.setMinutes(0, 0, 0);
          const key = hourKey.toISOString();
          
          if (!hourlyBuckets.has(key)) {
            hourlyBuckets.set(key, []);
          }
          hourlyBuckets.get(key).push(row);
        });

        // For each hour, keep only representative points (min, max, first, last, status changes)
        const idsToKeep = new Set();
        
        for (const [hourKey, hourData] of hourlyBuckets.entries()) {
          if (hourData.length === 0) continue;
          
          // Always keep first and last of the hour
          idsToKeep.add(hourData[0].id);
          idsToKeep.add(hourData[hourData.length - 1].id);

          // Keep min and max response times
          const withResponseTime = hourData.filter(d => d.responseTime !== null);
          if (withResponseTime.length > 0) {
            const minPoint = withResponseTime.reduce((min, d) =>
              d.responseTime < min.responseTime ? d : min
            );
            const maxPoint = withResponseTime.reduce((max, d) =>
              d.responseTime > max.responseTime ? d : max
            );
            idsToKeep.add(minPoint.id);
            idsToKeep.add(maxPoint.id);
          }

          // Keep status change points
          for (let i = 1; i < hourData.length; i++) {
            if (hourData[i].success !== hourData[i - 1].success) {
              idsToKeep.add(hourData[i - 1].id);
              idsToKeep.add(hourData[i].id);
            }
          }

          // If hour has many points, sample evenly (keep ~5-10 points per hour)
          if (hourData.length > 10) {
            const sampleRate = Math.max(1, Math.floor(hourData.length / 8));
            for (let i = 0; i < hourData.length; i += sampleRate) {
              idsToKeep.add(hourData[i].id);
            }
          } else {
            // Keep all if less than 10 points
            hourData.forEach(row => idsToKeep.add(row.id));
          }
        }

        // Delete points not in keep set
        const idsToDelete = hourlyData
          .filter(row => !idsToKeep.has(row.id))
          .map(row => row.id);

        if (idsToDelete.length > 0) {
          await prisma.pingResult.deleteMany({
            where: { id: { in: idsToDelete } },
          });
          totalDeleted += idsToDelete.length;
        }
      }

      // Step 2: Process 90+ days range - aggregate to daily buckets
      const dailyData = await prisma.pingResult.findMany({
        where: {
          targetId: targetId,
          timestamp: { lt: hourlyCutoff },
        },
        orderBy: { timestamp: 'asc' },
      });

      if (dailyData.length > 0) {
        // Group by day
        const dailyBuckets = new Map();
        dailyData.forEach(row => {
          const dayKey = new Date(row.timestamp);
          dayKey.setHours(0, 0, 0, 0);
          const key = dayKey.toISOString().split('T')[0];
          
          if (!dailyBuckets.has(key)) {
            dailyBuckets.set(key, []);
          }
          dailyBuckets.get(key).push(row);
        });

        // For each day, keep only representative points
        const idsToKeep = new Set();
        
        for (const [dayKey, dayData] of dailyBuckets.entries()) {
          if (dayData.length === 0) continue;
          
          // Always keep first and last of the day
          idsToKeep.add(dayData[0].id);
          idsToKeep.add(dayData[dayData.length - 1].id);

          // Keep min and max response times
          const withResponseTime = dayData.filter(d => d.responseTime !== null);
          if (withResponseTime.length > 0) {
            const minPoint = withResponseTime.reduce((min, d) =>
              d.responseTime < min.responseTime ? d : min
            );
            const maxPoint = withResponseTime.reduce((max, d) =>
              d.responseTime > max.responseTime ? d : max
            );
            idsToKeep.add(minPoint.id);
            idsToKeep.add(maxPoint.id);
          }

          // Keep status change points
          for (let i = 1; i < dayData.length; i++) {
            if (dayData[i].success !== dayData[i - 1].success) {
              idsToKeep.add(dayData[i - 1].id);
              idsToKeep.add(dayData[i].id);
            }
          }

          // Sample evenly - keep ~3-5 points per day for very old data
          if (dayData.length > 5) {
            const sampleRate = Math.max(1, Math.floor(dayData.length / 4));
            for (let i = 0; i < dayData.length; i += sampleRate) {
              idsToKeep.add(dayData[i].id);
            }
          } else {
            // Keep all if less than 5 points
            dayData.forEach(row => idsToKeep.add(row.id));
          }
        }

        // Delete points not in keep set
        const idsToDelete = dailyData
          .filter(row => !idsToKeep.has(row.id))
          .map(row => row.id);

        if (idsToDelete.length > 0) {
          await prisma.pingResult.deleteMany({
            where: { id: { in: idsToDelete } },
          });
          totalDeleted += idsToDelete.length;
        }
      }

      if (totalDeleted > 0) {
        console.log(chalk.yellow(`⊘ Processed retention for target ${targetId}: deleted ${totalDeleted} old data points`));
      }

      return { processed: hourlyData.length + dailyData.length, deleted: totalDeleted };
    } catch (error) {
      console.error(chalk.red(`Error processing retention for target ${targetId}:`), error.message);
      return { processed: 0, deleted: 0, error: error.message };
    }
  }

  /**
   * Process retention for all targets
   */
  async processRetentionForAllTargets() {
    try {
      const prisma = getPrisma();
      const targets = await prisma.target.findMany();

      let totalProcessed = 0;
      let totalDeleted = 0;

      for (const target of targets) {
        const result = await this.processRetentionForTarget(target.id);
        totalProcessed += result.processed || 0;
        totalDeleted += result.deleted || 0;
      }

      if (totalDeleted > 0) {
        console.log(chalk.green(`✓ Data retention complete: processed ${totalProcessed} points, deleted ${totalDeleted} redundant points`));
      }

      return { totalProcessed, totalDeleted };
    } catch (error) {
      console.error(chalk.red('Error processing retention for all targets:'), error.message);
      throw error;
    }
  }

  /**
   * Clean up data older than retention period (hard delete)
   * This is a more aggressive cleanup that removes data entirely
   */
  async cleanupOldData() {
    try {
      const retentionDays = await this.getRetentionSettings();
      const prisma = getPrisma();

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // Delete all data older than retention period
      const result = await prisma.pingResult.deleteMany({
        where: { timestamp: { lt: cutoffDate } },
      });

      if (result.count > 0) {
        console.log(chalk.yellow(`⊘ Cleaned up ${result.count} data points older than ${retentionDays} days`));
      }

      return { deleted: result.count };
    } catch (error) {
      console.error(chalk.red('Error cleaning up old data:'), error.message);
      throw error;
    }
  }

  /**
   * Limit total ping results per target to optimize database performance
   * Keeps the most recent N results per target
   */
  async limitPingResultsPerTarget(maxResultsPerTarget = 10000) {
    try {
      const prisma = getPrisma();
      const targets = await prisma.target.findMany();
      let totalDeleted = 0;

      for (const target of targets) {
        // Count total ping results for this target
        const count = await prisma.pingResult.count({
          where: { targetId: target.id },
        });

        if (count > maxResultsPerTarget) {
          // Get the oldest results to delete
          const toDelete = count - maxResultsPerTarget;
          
          // Get the timestamp of the Nth oldest result (where N = maxResultsPerTarget)
          const oldestToKeep = await prisma.pingResult.findMany({
            where: { targetId: target.id },
            orderBy: { timestamp: 'desc' },
            take: maxResultsPerTarget,
            skip: 0,
          });

          if (oldestToKeep.length > 0) {
            const cutoffTimestamp = oldestToKeep[oldestToKeep.length - 1].timestamp;
            
            // Delete all results older than the cutoff
            const result = await prisma.pingResult.deleteMany({
              where: {
                targetId: target.id,
                timestamp: { lt: cutoffTimestamp },
              },
            });

            totalDeleted += result.count;
          }
        }
      }

      if (totalDeleted > 0) {
        console.log(chalk.yellow(`⊘ Limited ping results: deleted ${totalDeleted} old data points`));
      }

      return { deleted: totalDeleted };
    } catch (error) {
      console.error(chalk.red('Error limiting ping results:'), error.message);
      throw error;
    }
  }
}

module.exports = new DataRetentionService();
