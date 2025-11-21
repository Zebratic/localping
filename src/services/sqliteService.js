const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const chalk = require('../utils/colors');

let db = null;

// Initialize SQLite database
function initializeDatabase() {
  const dbDir = path.join(process.cwd(), 'data');
  const dbPath = path.join(dbDir, 'localping.db');

  // Ensure data directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  createTables();

  console.log(chalk.green('✓ SQLite database initialized at:'), dbPath);

  return db;
}

// Create tables if they don't exist
function createTables() {
  // Check if ping_results table exists and has unique constraint
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ping_results'").get();
    if (tableInfo && tableInfo.sql && tableInfo.sql.includes('UNIQUE(targetId, timestamp)')) {
      // Migration: Remove unique constraint by recreating table
      console.log(chalk.yellow('⊘ Migrating ping_results table to remove unique constraint...'));
      db.exec(`
        CREATE TABLE ping_results_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          targetId TEXT NOT NULL,
          success BOOLEAN NOT NULL,
          responseTime INTEGER,
          timestamp DATETIME NOT NULL,
          statusCode INTEGER,
          error TEXT
        );
        INSERT INTO ping_results_new SELECT * FROM ping_results;
        DROP TABLE ping_results;
        ALTER TABLE ping_results_new RENAME TO ping_results;
        CREATE INDEX IF NOT EXISTS idx_ping_results_targetId ON ping_results(targetId);
        CREATE INDEX IF NOT EXISTS idx_ping_results_timestamp ON ping_results(timestamp);
      `);
      console.log(chalk.green('✓ Migration complete'));
    }
  } catch (error) {
    // Table doesn't exist or migration not needed, continue
  }

  // Ping results table
  db.exec(`
    CREATE TABLE IF NOT EXISTS ping_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      targetId TEXT NOT NULL,
      success BOOLEAN NOT NULL,
      responseTime INTEGER,
      timestamp DATETIME NOT NULL,
      statusCode INTEGER,
      error TEXT
    )
  `);

  // Daily statistics table
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      targetId TEXT NOT NULL,
      date DATE NOT NULL,
      totalPings INTEGER DEFAULT 0,
      successfulPings INTEGER DEFAULT 0,
      avgResponseTime REAL DEFAULT 0,
      minResponseTime INTEGER,
      maxResponseTime INTEGER,
      UNIQUE(targetId, date)
    )
  `);

  // Create indices for faster queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ping_results_targetId ON ping_results(targetId);
    CREATE INDEX IF NOT EXISTS idx_ping_results_timestamp ON ping_results(timestamp);
    CREATE INDEX IF NOT EXISTS idx_daily_stats_targetId ON daily_stats(targetId);
    CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);
  `);
}

// Get database instance
function getDatabase() {
  if (!db) {
    initializeDatabase();
  }
  return db;
}

// Store ping result
function storePingResult(targetId, result, timestamp = null) {
  const database = getDatabase();

  try {
    // Use provided timestamp or current time with millisecond precision
    const pingTimestamp = timestamp || new Date().toISOString();
    
    const stmt = database.prepare(`
      INSERT INTO ping_results (targetId, success, responseTime, statusCode, error, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      targetId,
      result.success ? 1 : 0,
      result.responseTime || null,
      result.statusCode || null,
      result.error || null,
      pingTimestamp
    );
  } catch (error) {
    console.error(chalk.red('Error storing ping result:'), error.message);
  }
}

// Get ping results for a target
function getPingResults(targetId, options = {}) {
  const database = getDatabase();
  const { limit = 100, offset = 0, days = null } = options;

  try {
    let query = 'SELECT * FROM ping_results WHERE targetId = ?';
    const params = [targetId];

    if (days) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      query += ' AND timestamp >= ?';
      params.push(startDate.toISOString());
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = database.prepare(query);
    const results = stmt.all(...params);

    return results.map(r => ({
      ...r,
      success: r.success === 1,
      timestamp: new Date(r.timestamp)
    }));
  } catch (error) {
    console.error(chalk.red('Error fetching ping results:'), error.message);
    return [];
  }
}

// Get daily statistics for a target
function getDailyStats(targetId, options = {}) {
  const database = getDatabase();
  const { limit = 30, offset = 0 } = options;

  try {
    const stmt = database.prepare(`
      SELECT * FROM daily_stats
      WHERE targetId = ?
      ORDER BY date DESC
      LIMIT ? OFFSET ?
    `);

    return stmt.all(targetId, limit, offset);
  } catch (error) {
    console.error(chalk.red('Error fetching daily stats:'), error.message);
    return [];
  }
}

// Update or create daily statistics
function updateDailyStats(targetId) {
  const database = getDatabase();

  try {
    const today = new Date().toISOString().split('T')[0];

    // Get today's ping results
    const stmt = database.prepare(`
      SELECT
        COUNT(*) as totalPings,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successfulPings,
        AVG(CASE WHEN responseTime IS NOT NULL THEN responseTime ELSE NULL END) as avgResponseTime,
        MIN(CASE WHEN responseTime IS NOT NULL THEN responseTime ELSE NULL END) as minResponseTime,
        MAX(CASE WHEN responseTime IS NOT NULL THEN responseTime ELSE NULL END) as maxResponseTime
      FROM ping_results
      WHERE targetId = ? AND DATE(timestamp) = ?
    `);

    const stats = stmt.get(targetId, today);

    // Insert or update daily stats
    const insertStmt = database.prepare(`
      INSERT INTO daily_stats (targetId, date, totalPings, successfulPings, avgResponseTime, minResponseTime, maxResponseTime)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(targetId, date) DO UPDATE SET
        totalPings = excluded.totalPings,
        successfulPings = excluded.successfulPings,
        avgResponseTime = excluded.avgResponseTime,
        minResponseTime = excluded.minResponseTime,
        maxResponseTime = excluded.maxResponseTime
    `);

    insertStmt.run(
      targetId,
      today,
      stats.totalPings || 0,
      stats.successfulPings || 0,
      stats.avgResponseTime || 0,
      stats.minResponseTime || null,
      stats.maxResponseTime || null
    );
  } catch (error) {
    console.error(chalk.red('Error updating daily stats:'), error.message);
  }
}

// Get uptime percentage for a target
function getUptimePercentage(targetId, days = 30) {
  const database = getDatabase();

  try {
    const stmt = database.prepare(`
      SELECT
        COUNT(*) as totalPings,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successfulPings
      FROM ping_results
      WHERE targetId = ? AND timestamp >= datetime('now', '-' || ? || ' days')
    `);

    const result = stmt.get(targetId, days);

    if (result.totalPings === 0) {
      return 100;
    }

    return ((result.successfulPings / result.totalPings) * 100).toFixed(2);
  } catch (error) {
    console.error(chalk.red('Error calculating uptime:'), error.message);
    return 0;
  }
}

// Clean old ping results (keep only last 90 days)
function cleanupOldData() {
  const database = getDatabase();

  try {
    const stmt = database.prepare(`
      DELETE FROM ping_results
      WHERE timestamp < datetime('now', '-90 days')
    `);

    const changes = stmt.run().changes;

    if (changes > 0) {
      console.log(chalk.yellow(`⊘ Cleaned up ${changes} old ping records`));
    }
  } catch (error) {
    console.error(chalk.red('Error cleaning up old data:'), error.message);
  }
}

// Clear all ping data
function clearAllPingData() {
  const database = getDatabase();

  try {
    // Clear ping_results table
    const pingStmt = database.prepare('DELETE FROM ping_results');
    const pingChanges = pingStmt.run().changes;

    // Clear daily_stats table
    const statsStmt = database.prepare('DELETE FROM daily_stats');
    const statsChanges = statsStmt.run().changes;

    console.log(chalk.yellow(`⊘ Cleared ${pingChanges} ping records and ${statsChanges} daily stats`));
    
    return {
      pingRecordsDeleted: pingChanges,
      dailyStatsDeleted: statsChanges
    };
  } catch (error) {
    console.error(chalk.red('Error clearing ping data:'), error.message);
    throw error;
  }
}

// Close database connection
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  initializeDatabase,
  getDatabase,
  storePingResult,
  getPingResults,
  getDailyStats,
  updateDailyStats,
  getUptimePercentage,
  cleanupOldData,
  clearAllPingData,
  closeDatabase,
};
