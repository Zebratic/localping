require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const chalk = require('../utils/colors');

let db = null;

const connectDB = async () => {
  try {
    const dbDir = path.join(process.cwd(), 'data');
    const dbPath = path.join(dbDir, 'localping.db');

    // Ensure data directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new Database(dbPath);

    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Initialize tables
    initializeTables();

    console.log(chalk.green('✓ SQLite database connected at:'), dbPath);

    // Return a minimal object compatible with the rest of the code
    return {
      collection: (name) => createCollectionWrapper(name),
      admin: () => ({
        ping: async () => true
      })
    };
  } catch (error) {
    console.error(chalk.red('✗ SQLite connection failed:'), error.message);
    process.exit(1);
  }
};

const initializeTables = () => {
  try {
    // Targets table
    db.exec(`
      CREATE TABLE IF NOT EXISTS targets (
        _id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        host TEXT NOT NULL,
        protocol TEXT NOT NULL,
        port INTEGER,
        path TEXT,
        enabled BOOLEAN DEFAULT 1,
        interval INTEGER DEFAULT 60,
        retries INTEGER DEFAULT 0,
        retryInterval INTEGER DEFAULT 5,
        timeout INTEGER DEFAULT 30,
        httpMethod TEXT DEFAULT 'GET',
        statusCodes TEXT DEFAULT '200-299',
        maxRedirects INTEGER DEFAULT 5,
        ignoreSsl BOOLEAN DEFAULT 0,
        upsideDown BOOLEAN DEFAULT 0,
        auth TEXT,
        appUrl TEXT,
        appIcon TEXT,
        position INTEGER DEFAULT 0,
        "group" TEXT,
        quickCommands TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ping results table
    db.exec(`
      CREATE TABLE IF NOT EXISTS pingResults (
        _id TEXT PRIMARY KEY,
        targetId TEXT NOT NULL,
        success BOOLEAN NOT NULL,
        responseTime INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        statusCode INTEGER,
        error TEXT,
        FOREIGN KEY(targetId) REFERENCES targets(_id),
        UNIQUE(targetId, timestamp)
      )
    `);

    // Alerts table
    db.exec(`
      CREATE TABLE IF NOT EXISTS alerts (
        _id TEXT PRIMARY KEY,
        targetId TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        message TEXT,
        FOREIGN KEY(targetId) REFERENCES targets(_id)
      )
    `);

    // Statistics table
    db.exec(`
      CREATE TABLE IF NOT EXISTS statistics (
        _id TEXT PRIMARY KEY,
        targetId TEXT NOT NULL,
        date DATE NOT NULL,
        totalPings INTEGER DEFAULT 0,
        successfulPings INTEGER DEFAULT 0,
        failedPings INTEGER DEFAULT 0,
        uptime REAL DEFAULT 0,
        lastResponseTime INTEGER DEFAULT 0,
        avgResponseTime REAL DEFAULT 0,
        minResponseTime INTEGER,
        maxResponseTime INTEGER,
        FOREIGN KEY(targetId) REFERENCES targets(_id),
        UNIQUE(targetId, date)
      )
    `);

    // Incidents table
    db.exec(`
      CREATE TABLE IF NOT EXISTS incidents (
        _id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        severity TEXT DEFAULT 'major',
        status TEXT DEFAULT 'investigating',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Actions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS actions (
        _id TEXT PRIMARY KEY,
        targetId TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        command TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(targetId) REFERENCES targets(_id),
        UNIQUE(targetId, name)
      )
    `);

    // Create indices
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_targets_enabled ON targets(enabled);
      CREATE INDEX IF NOT EXISTS idx_pingResults_targetId ON pingResults(targetId);
      CREATE INDEX IF NOT EXISTS idx_pingResults_timestamp ON pingResults(timestamp);
      CREATE INDEX IF NOT EXISTS idx_alerts_targetId ON alerts(targetId);
      CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp);
      CREATE INDEX IF NOT EXISTS idx_statistics_targetId ON statistics(targetId);
      CREATE INDEX IF NOT EXISTS idx_statistics_date ON statistics(date);
      CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
      CREATE INDEX IF NOT EXISTS idx_actions_targetId ON actions(targetId);
    `);

    console.log(chalk.green('✓ SQLite tables initialized'));
  } catch (error) {
    console.error(chalk.yellow('⚠ Warning initializing tables:'), error.message);
  }
};

const createCollectionWrapper = (name) => {
  return {
    find: (query = {}) => ({
      toArray: async () => {
        try {
          const keys = Object.keys(query).filter(k => typeof query[k] !== 'function');
          let sql = `SELECT * FROM ${name}`;
          const params = [];

          if (keys.length > 0) {
            const whereClauses = keys.map(k => {
              const val = query[k];
              // Convert boolean to 0/1 for SQLite
              params.push(typeof val === 'boolean' ? (val ? 1 : 0) : val);
              return `"${k}" = ?`;
            });
            sql += ' WHERE ' + whereClauses.join(' AND ');
          }

          const stmt = db.prepare(sql);
          return stmt.all(...params);
        } catch (error) {
          console.error(chalk.red(`Error finding ${name}:`), error.message);
          return [];
        }
      }
    }),
    findOne: async (query = {}) => {
      try {
        const keys = Object.keys(query).filter(k => typeof query[k] !== 'function');
        let sql = `SELECT * FROM ${name}`;
        const params = [];

        if (keys.length > 0) {
          const whereClauses = keys.map(k => {
            const val = query[k];
            // Convert boolean to 0/1 for SQLite
            params.push(typeof val === 'boolean' ? (val ? 1 : 0) : val);
            return `"${k}" = ?`;
          });
          sql += ' WHERE ' + whereClauses.join(' AND ');
        }

        sql += ' LIMIT 1';
        const stmt = db.prepare(sql);
        return stmt.get(...params);
      } catch (error) {
        console.error(chalk.red(`Error finding one ${name}:`), error.message);
        return null;
      }
    },
    insertOne: async (doc) => {
      try {
        const id = doc._id || require('uuid').v4();
        const docWithId = { _id: id, ...doc };
        const fields = Object.keys(docWithId);
        const placeholders = fields.map(() => '?').join(', ');
        const quotedFields = fields.map(f => `"${f}"`).join(', ');
        const values = fields.map(f => {
          const val = docWithId[f];
          // Convert boolean to 0/1 for SQLite
          if (typeof val === 'boolean') {
            return val ? 1 : 0;
          }
          // Convert arrays and objects to JSON strings
          if (typeof val === 'object' && val !== null) {
            return JSON.stringify(val);
          }
          return val;
        });

        const sql = `INSERT INTO ${name} (${quotedFields}) VALUES (${placeholders})`;
        const stmt = db.prepare(sql);
        stmt.run(...values);
        return { insertedId: id };
      } catch (error) {
        console.error(chalk.red(`Error inserting into ${name}:`), error.message);
        throw error;
      }
    },
    updateOne: async (query, update) => {
      try {
        const { $set } = update;
        const setClauses = Object.keys($set).map(k => `"${k}" = ?`).join(', ');
        const setValues = Object.values($set).map(v => {
          if (typeof v === 'boolean') {
            return v ? 1 : 0;
          }
          if (typeof v === 'object' && v !== null) {
            return JSON.stringify(v);
          }
          return v;
        });

        const queryKeys = Object.keys(query);
        const whereClauses = queryKeys.map(k => `"${k}" = ?`).join(' AND ');
        const whereValues = Object.values(query).map(v => {
          if (typeof v === 'boolean') {
            return v ? 1 : 0;
          }
          if (typeof v === 'object' && v !== null) {
            return JSON.stringify(v);
          }
          return v;
        });

        const sql = `UPDATE ${name} SET ${setClauses} WHERE ${whereClauses}`;
        const stmt = db.prepare(sql);
        const result = stmt.run(...setValues, ...whereValues);
        return { modifiedCount: result.changes };
      } catch (error) {
        console.error(chalk.red(`Error updating ${name}:`), error.message);
        throw error;
      }
    },
    deleteOne: async (query) => {
      try {
        const keys = Object.keys(query);
        const whereClauses = keys.map(k => `"${k}" = ?`).join(' AND ');
        const values = Object.values(query).map(v => typeof v === 'boolean' ? (v ? 1 : 0) : v);

        const sql = `DELETE FROM ${name} WHERE ${whereClauses}`;
        const stmt = db.prepare(sql);
        const result = stmt.run(...values);
        return { deletedCount: result.changes };
      } catch (error) {
        console.error(chalk.red(`Error deleting from ${name}:`), error.message);
        throw error;
      }
    },
    countDocuments: async (query = {}) => {
      try {
        const keys = Object.keys(query).filter(k => typeof query[k] !== 'function');
        let sql = `SELECT COUNT(*) as count FROM ${name}`;
        const params = [];

        if (keys.length > 0) {
          const whereClauses = keys.map(k => {
            const val = query[k];
            params.push(typeof val === 'boolean' ? (val ? 1 : 0) : val);
            return `"${k}" = ?`;
          });
          sql += ' WHERE ' + whereClauses.join(' AND ');
        }

        const stmt = db.prepare(sql);
        const result = stmt.get(...params);
        return result ? result.count : 0;
      } catch (error) {
        console.error(chalk.red(`Error counting ${name}:`), error.message);
        return 0;
      }
    },
    sort: (sortObj) => ({
      limit: (num) => ({
        toArray: async () => [] // Stub for compatibility
      })
    }),
    createIndex: async () => true
  };
};

const getDB = () => {
  if (!db) {
    throw new Error('Database not connected. Call connectDB() first.');
  }
  return {
    collection: (name) => createCollectionWrapper(name),
    admin: () => ({
      ping: async () => true
    })
  };
};

const closeDB = async () => {
  if (db) {
    db.close();
    console.log(chalk.green('✓ SQLite connection closed'));
  }
};

module.exports = {
  connectDB,
  getDB,
  closeDB,
};
