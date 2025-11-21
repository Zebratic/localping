#!/usr/bin/env node

/**
 * Verification script to check if ping data is being saved to the database
 * Run this script to verify that ping results and statistics are being stored correctly
 */

require('dotenv').config();
const { connectDB, getDB } = require('../src/config/db');
const chalk = require('../src/utils/colors');

async function verifyPingData() {
  try {
    console.log(chalk.cyan('Connecting to database...'));
    await connectDB();
    const db = getDB();

    console.log(chalk.cyan('\n=== Verifying Ping Data ===\n'));

    // Check targets
    const targets = await db.collection('targets').find({ enabled: true }).toArray();
    console.log(chalk.yellow(`Found ${targets.length} enabled target(s)\n`));

    if (targets.length === 0) {
      console.log(chalk.red('✗ No enabled targets found. Please create and enable at least one target.'));
      process.exit(1);
    }

    // Check ping results for each target
    for (const target of targets) {
      console.log(chalk.cyan(`\n--- Target: ${target.name} (${target._id}) ---`));
      
      // Get recent ping results (last 24 hours)
      const oneDayAgo = new Date();
      oneDayAgo.setHours(oneDayAgo.getHours() - 24);
      
      const recentPings = await db.collection('pingResults').find({
        targetId: target._id,
        timestamp: { $gte: oneDayAgo }
      }).toArray();

      console.log(`  Recent ping results (last 24h): ${recentPings.length}`);
      
      if (recentPings.length > 0) {
        const latest = recentPings[recentPings.length - 1];
        const latestTime = new Date(latest.timestamp);
        const minutesAgo = Math.floor((Date.now() - latestTime.getTime()) / 1000 / 60);
        console.log(chalk.green(`  ✓ Latest ping: ${minutesAgo} minutes ago`));
        console.log(`    Success: ${latest.success}, Response Time: ${latest.responseTime || 'N/A'}ms`);
      } else {
        console.log(chalk.red(`  ✗ No ping results found in last 24 hours`));
      }

      // Get total ping results
      const totalPings = await db.collection('pingResults').find({
        targetId: target._id
      }).toArray();
      console.log(`  Total ping results: ${totalPings.length}`);

      // Check statistics
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStats = await db.collection('statistics').findOne({
        targetId: target._id,
        date: today
      });

      if (todayStats) {
        console.log(chalk.green(`  ✓ Today's statistics:`));
        console.log(`    Total Pings: ${todayStats.totalPings}`);
        console.log(`    Successful: ${todayStats.successfulPings}`);
        console.log(`    Failed: ${todayStats.failedPings}`);
        console.log(`    Avg Response Time: ${Math.round(todayStats.avgResponseTime || 0)}ms`);
        console.log(`    Uptime: ${todayStats.uptime?.toFixed(2) || 0}%`);
      } else {
        console.log(chalk.yellow(`  ⚠ No statistics found for today`));
      }
    }

    // Overall summary
    const allPings = await db.collection('pingResults').find({}).toArray();
    const allStats = await db.collection('statistics').find({}).toArray();
    
    console.log(chalk.cyan('\n=== Summary ==='));
    console.log(`Total ping results in database: ${allPings.length}`);
    console.log(`Total statistics records: ${allStats.length}`);

    if (allPings.length === 0) {
      console.log(chalk.red('\n✗ WARNING: No ping results found in database!'));
      console.log(chalk.yellow('  This could mean:'));
      console.log(chalk.yellow('  1. Monitoring is not running'));
      console.log(chalk.yellow('  2. Targets are not enabled'));
      console.log(chalk.yellow('  3. Database writes are failing (check logs)'));
      process.exit(1);
    } else {
      console.log(chalk.green('\n✓ Ping data is being saved to the database'));
    }

  } catch (error) {
    console.error(chalk.red('\n✗ Error verifying ping data:'), error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run verification
verifyPingData().then(() => {
  process.exit(0);
}).catch(err => {
  console.error(chalk.red('Fatal error:'), err);
  process.exit(1);
});

