require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const chalk = require('../utils/colors');
const cacheService = require('../services/cacheService');

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
        publicVisible BOOLEAN DEFAULT 1,
        publicShowDetails BOOLEAN DEFAULT 0,
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

    // Migration: Add publicVisible column if it doesn't exist
    try {
      db.exec(`ALTER TABLE targets ADD COLUMN publicVisible BOOLEAN DEFAULT 1`);
    } catch (error) {
      // Column already exists, ignore
    }

    // Migration: Add publicShowDetails column if it doesn't exist
    try {
      db.exec(`ALTER TABLE targets ADD COLUMN publicShowDetails BOOLEAN DEFAULT 0`);
    } catch (error) {
      // Column already exists, ignore
    }

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
        protocol TEXT,
        FOREIGN KEY(targetId) REFERENCES targets(_id)
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

    // Favicons table
    db.exec(`
      CREATE TABLE IF NOT EXISTS favicons (
        _id TEXT PRIMARY KEY,
        appUrl TEXT NOT NULL UNIQUE,
        favicon TEXT,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Public UI Settings table
    db.exec(`
      CREATE TABLE IF NOT EXISTS publicUISettings (
        _id TEXT PRIMARY KEY DEFAULT 'settings',
        title TEXT DEFAULT 'Homelab',
        subtitle TEXT DEFAULT 'System Status & Application Dashboard',
        customCSS TEXT,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Initialize default settings if not exists
    db.exec(`
      INSERT OR IGNORE INTO publicUISettings (_id, title, subtitle, customCSS)
      VALUES ('settings', 'Homelab', 'System Status & Application Dashboard', NULL)
    `);

    // Posts table (for blog/changelog)
    db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        _id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        published BOOLEAN DEFAULT 1,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Admin Settings table
    db.exec(`
      CREATE TABLE IF NOT EXISTS adminSettings (
        _id TEXT PRIMARY KEY DEFAULT 'settings',
        sessionDurationDays INTEGER DEFAULT 30,
        dataRetentionDays INTEGER DEFAULT 30,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration: Add dataRetentionDays column if it doesn't exist
    try {
      db.exec(`ALTER TABLE adminSettings ADD COLUMN dataRetentionDays INTEGER DEFAULT 30`);
    } catch (error) {
      // Column already exists, ignore
    }

    // Initialize default admin settings if not exists
    db.exec(`
      INSERT OR IGNORE INTO adminSettings (_id, sessionDurationDays, dataRetentionDays)
      VALUES ('settings', 30, 30)
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
      CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published);
      CREATE INDEX IF NOT EXISTS idx_posts_createdAt ON posts(createdAt);
    `);

    console.log(chalk.green('✓ SQLite tables initialized'));
  } catch (error) {
    console.error(chalk.yellow('⚠ Warning initializing tables:'), error.message);
  }
};

// Get TTL for different collections
const getTTL = (collectionName) => {
  const ttlMap = {
    'adminSettings': 300000,      // 5 minutes - rarely changes
    'publicUISettings': 300000,   // 5 minutes - rarely changes
    'targets': 30000,              // 30 seconds - may change more often
    'statistics': 120000,          // 2 minutes - updated periodically
    'favicons': 600000,            // 10 minutes - very rarely changes
    'posts': 60000,                // 1 minute - may change occasionally
    'incidents': 60000,            // 1 minute - may change occasionally
  };
  return ttlMap[collectionName] || 60000; // Default 1 minute
};

const createCollectionWrapper = (name) => {
  return {
    find: (query = {}) => {
      // Store options for chaining
      let sortOption = null;
      let limitOption = null;

      const chainable = {
        sort: (sortObj) => {
          sortOption = sortObj;
          return chainable;
        },
        limit: (num) => {
          limitOption = num;
          return chainable;
        },
        toArray: async () => {
          try {
            // Check cache first
            const cacheKey = cacheService.generateKey(name, query, { sort: sortOption, limit: limitOption });
            const cached = cacheService.get(cacheKey);
            if (cached !== null) {
              return cached;
            }

            const keys = Object.keys(query).filter(k => typeof query[k] !== 'function');
            let sql = `SELECT * FROM ${name}`;
            const params = [];

            if (keys.length > 0) {
              const whereClauses = keys.map(k => {
                const val = query[k];
                // Handle MongoDB-style operators
                if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
                  if ('$gte' in val) {
                    const gteVal = val.$gte;
                    if (gteVal instanceof Date) {
                      params.push(gteVal.toISOString().split('T')[0]);
                    } else {
                      params.push(gteVal);
                    }
                    return `"${k}" >= ?`;
                  } else if ('$lte' in val) {
                    const lteVal = val.$lte;
                    if (lteVal instanceof Date) {
                      params.push(lteVal.toISOString().split('T')[0]);
                    } else {
                      params.push(lteVal);
                    }
                    return `"${k}" <= ?`;
                  } else if ('$gt' in val) {
                    const gtVal = val.$gt;
                    if (gtVal instanceof Date) {
                      params.push(gtVal.toISOString().split('T')[0]);
                    } else {
                      params.push(gtVal);
                    }
                    return `"${k}" > ?`;
                  } else if ('$lt' in val) {
                    const ltVal = val.$lt;
                    if (ltVal instanceof Date) {
                      params.push(ltVal.toISOString().split('T')[0]);
                    } else {
                      params.push(ltVal);
                    }
                    return `"${k}" < ?`;
                  } else {
                    // Fallback to JSON stringify for other objects
                    params.push(JSON.stringify(val));
                    return `"${k}" = ?`;
                  }
                }
                // Handle different types
                if (typeof val === 'boolean') {
                  params.push(val ? 1 : 0);
                } else if (val instanceof Date) {
                  // Convert Date to ISO date string (YYYY-MM-DD)
                  params.push(val.toISOString().split('T')[0]);
                } else {
                  params.push(val);
                }
                return `"${k}" = ?`;
              });
              sql += ' WHERE ' + whereClauses.join(' AND ');
            }

            // Add sorting
            if (sortOption) {
              const sortKey = Object.keys(sortOption)[0];
              const sortDir = sortOption[sortKey] === 1 ? 'ASC' : 'DESC';
              sql += ` ORDER BY "${sortKey}" ${sortDir}`;
            }

            // Add limit
            if (limitOption) {
              sql += ` LIMIT ${limitOption}`;
            }

            const stmt = db.prepare(sql);
            const results = stmt.all(...params);
            
            // Cache the results
            cacheService.set(cacheKey, results, getTTL(name));
            
            return results;
          } catch (error) {
            console.error(chalk.red(`Error finding ${name}:`), error.message);
            return [];
          }
        }
      };

      return chainable;
    },
    findOne: async (query = {}) => {
      try {
        // Check cache first
        const cacheKey = cacheService.generateKey(name, query, { findOne: true });
        const cached = cacheService.get(cacheKey);
        if (cached !== null) {
          return cached;
        }

        const keys = Object.keys(query).filter(k => typeof query[k] !== 'function');
        let sql = `SELECT * FROM ${name}`;
        const params = [];

        if (keys.length > 0) {
          const whereClauses = keys.map(k => {
            const val = query[k];
            // Handle different types
            if (typeof val === 'boolean') {
              params.push(val ? 1 : 0);
            } else if (val instanceof Date) {
              // Convert Date to ISO date string (YYYY-MM-DD) for DATE columns
              // For statistics table date column, use date format
              if (name === 'statistics' && k === 'date') {
                params.push(val.toISOString().split('T')[0]);
              } else {
                params.push(val.toISOString().split('T')[0]);
              }
            } else if (typeof val === 'object' && val !== null) {
              params.push(JSON.stringify(val));
            } else {
              params.push(val);
            }
            return `"${k}" = ?`;
          });
          sql += ' WHERE ' + whereClauses.join(' AND ');
        }

        sql += ' LIMIT 1';
        const stmt = db.prepare(sql);
        const result = stmt.get(...params);
        
        // Cache the result
        cacheService.set(cacheKey, result, getTTL(name));
        
        return result;
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
          // Convert Date to ISO timestamp string (YYYY-MM-DD HH:MM:SS) or date string for DATE columns
          if (val instanceof Date) {
            // For statistics table date column, use date format
            if (name === 'statistics' && f === 'date') {
              return val.toISOString().split('T')[0];
            }
            return val.toISOString().replace('T', ' ').substring(0, 19);
          }
          // Convert arrays and objects to JSON strings
          if (typeof val === 'object' && val !== null) {
            return JSON.stringify(val);
          }
          return val;
        });

        // Standard INSERT - let the application handle conflicts
        const sql = `INSERT INTO ${name} (${quotedFields}) VALUES (${placeholders})`;
        const stmt = db.prepare(sql);
        stmt.run(...values);
        
        // Invalidate cache for this collection
        cacheService.invalidateCollection(name);
        
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
          if (v instanceof Date) {
            return v.toISOString().replace('T', ' ').substring(0, 19);
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
          if (v instanceof Date) {
            return v.toISOString().replace('T', ' ').substring(0, 19);
          }
          if (typeof v === 'object' && v !== null) {
            return JSON.stringify(v);
          }
          return v;
        });

        const sql = `UPDATE ${name} SET ${setClauses} WHERE ${whereClauses}`;
        const stmt = db.prepare(sql);
        const result = stmt.run(...setValues, ...whereValues);
        
        // Invalidate cache for this collection
        cacheService.invalidateCollection(name);
        
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
        const values = Object.values(query).map(v => {
          if (typeof v === 'boolean') {
            return v ? 1 : 0;
          }
          if (v instanceof Date) {
            return v.toISOString().replace('T', ' ').substring(0, 19);
          }
          return v;
        });

        const sql = `DELETE FROM ${name} WHERE ${whereClauses}`;
        const stmt = db.prepare(sql);
        const result = stmt.run(...values);
        
        // Invalidate cache for this collection
        cacheService.invalidateCollection(name);
        
        return { deletedCount: result.changes };
      } catch (error) {
        console.error(chalk.red(`Error deleting from ${name}:`), error.message);
        throw error;
      }
    },
    deleteMany: async (query = {}) => {
      try {
        const keys = Object.keys(query).filter(k => typeof query[k] !== 'function');
        let sql = `DELETE FROM ${name}`;
        const params = [];

        if (keys.length > 0) {
          const whereClauses = keys.map(k => {
            const val = query[k];
            if (typeof val === 'boolean') {
              params.push(val ? 1 : 0);
            } else if (val instanceof Date) {
              params.push(val.toISOString().split('T')[0]);
            } else {
              params.push(val);
            }
            return `"${k}" = ?`;
          });
          sql += ' WHERE ' + whereClauses.join(' AND ');
        }

        const stmt = db.prepare(sql);
        const result = stmt.run(...params);
        
        // Invalidate cache for this collection
        cacheService.invalidateCollection(name);
        
        return { deletedCount: result.changes };
      } catch (error) {
        console.error(chalk.red(`Error deleting from ${name}:`), error.message);
        throw error;
      }
    },
    countDocuments: async (query = {}) => {
      try {
        // Check cache first
        const cacheKey = cacheService.generateKey(name, query, { count: true });
        const cached = cacheService.get(cacheKey);
        if (cached !== null) {
          return cached;
        }

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
        const count = result ? result.count : 0;
        
        // Cache the count
        cacheService.set(cacheKey, count, getTTL(name));
        
        return count;
      } catch (error) {
        console.error(chalk.red(`Error counting ${name}:`), error.message);
        return 0;
      }
    },
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
