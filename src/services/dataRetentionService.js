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
   * This minimizes old data points while keeping important ones
   */
  async processRetentionForTarget(targetId) {
    try {
      const retentionDays = await this.getRetentionSettings();
      const prisma = getPrisma();

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // Get all data points older than retention period
      const oldData = await prisma.pingResult.findMany({
        where: {
          targetId: targetId,
          timestamp: { lt: cutoffDate },
        },
        orderBy: { timestamp: 'asc' },
      });

      if (oldData.length === 0) {
        return { processed: 0, deleted: 0 };
      }

      // Group data by day for processing
      const dataByDay = {};
      oldData.forEach(row => {
        const date = new Date(row.timestamp);
        const dayKey = date.toISOString().split('T')[0];
        if (!dataByDay[dayKey]) {
          dataByDay[dayKey] = [];
        }
        dataByDay[dayKey].push(row);
      });

      let totalDeleted = 0;

      // Process each day
      for (const [dayKey, dayData] of Object.entries(dataByDay)) {
        if (dayData.length <= 10) {
          // If day has 10 or fewer points, keep all
          continue;
        }

        // For days with more data, keep only important points:
        // 1. First point of the day
        // 2. Last point of the day
        // 3. Min response time
        // 4. Max response time
        // 5. Any failure points (status changes)
        // 6. Sample every Nth point (to maintain some granularity)

        const importantIds = new Set();

        // First and last
        importantIds.add(dayData[0].id);
        importantIds.add(dayData[dayData.length - 1].id);

        // Find min and max response times
        const withResponseTime = dayData.filter(d => d.responseTime !== null);
        if (withResponseTime.length > 0) {
          const minPoint = withResponseTime.reduce((min, d) =>
            d.responseTime < min.responseTime ? d : min
          );
          const maxPoint = withResponseTime.reduce((max, d) =>
            d.responseTime > max.responseTime ? d : max
          );
          importantIds.add(minPoint.id);
          importantIds.add(maxPoint.id);
        }

        // Find status change points (transitions from success to failure or vice versa)
        for (let i = 1; i < dayData.length; i++) {
          if (dayData[i].success !== dayData[i - 1].success) {
            importantIds.add(dayData[i - 1].id);
            importantIds.add(dayData[i].id);
          }
        }

        // Sample every Nth point to maintain some granularity
        // Calculate sample rate: keep roughly 10-20 points per day
        const sampleRate = Math.max(1, Math.floor(dayData.length / 15));
        for (let i = 0; i < dayData.length; i += sampleRate) {
          importantIds.add(dayData[i].id);
        }

        // Delete all points not in important set
        const idsToDelete = dayData
          .filter(row => !importantIds.has(row.id))
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

      return { processed: oldData.length, deleted: totalDeleted };
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
}

module.exports = new DataRetentionService();
