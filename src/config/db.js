require('dotenv').config();
const { Pool } = require('pg');
const chalk = require('../utils/colors');
const cacheService = require('../services/cacheService');

let pool = null;

const connectDB = async () => {
  try {
    // Get database connection details from environment or use defaults
    const dbConfig = {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'localping',
      user: process.env.DB_USER || 'localping',
      password: process.env.DB_PASSWORD || 'localping',
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };

    pool = new Pool(dbConfig);

    // Test connection
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();

    // Initialize tables
    await initializeTables();

    console.log(chalk.green('✓ PostgreSQL database connected'));

    // Return a minimal object compatible with the rest of the code
    return {
      collection: (name) => createCollectionWrapper(name),
      admin: () => ({
        ping: async () => {
          try {
            const client = await pool.connect();
            await client.query('SELECT 1');
            client.release();
            return true;
          } catch (error) {
            return false;
          }
        }
      })
    };
  } catch (error) {
    console.error(chalk.red('✗ PostgreSQL connection failed:'), error.message);
    process.exit(1);
  }
};

const executeQuery = async (text, params) => {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
};

const initializeTables = async () => {
  try {
    // Targets table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS targets (
        _id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        host TEXT NOT NULL,
        protocol TEXT NOT NULL,
        port INTEGER,
        path TEXT,
        enabled BOOLEAN DEFAULT true,
        "publicVisible" BOOLEAN DEFAULT true,
        "publicShowDetails" BOOLEAN DEFAULT false,
        "publicShowStatus" BOOLEAN DEFAULT true,
        "publicShowAppLink" BOOLEAN DEFAULT true,
        interval INTEGER DEFAULT 60,
        retries INTEGER DEFAULT 0,
        "retryInterval" INTEGER DEFAULT 5,
        timeout INTEGER DEFAULT 30,
        "httpMethod" TEXT DEFAULT 'GET',
        "statusCodes" TEXT DEFAULT '200-299',
        "maxRedirects" INTEGER DEFAULT 5,
        "ignoreSsl" BOOLEAN DEFAULT false,
        "upsideDown" BOOLEAN DEFAULT false,
        auth TEXT,
        "appUrl" TEXT,
        "appIcon" TEXT,
        position INTEGER DEFAULT 0,
        "group" TEXT,
        "quickCommands" TEXT,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration: Add publicVisible column if it doesn't exist
    try {
      await executeQuery(`ALTER TABLE targets ADD COLUMN IF NOT EXISTS "publicVisible" BOOLEAN DEFAULT true`);
    } catch (error) {
      // Column already exists, ignore
    }

    // Migration: Add publicShowDetails column if it doesn't exist
    try {
      await executeQuery(`ALTER TABLE targets ADD COLUMN IF NOT EXISTS "publicShowDetails" BOOLEAN DEFAULT false`);
    } catch (error) {
      // Column already exists, ignore
    }

    // Migration: Add publicShowStatus column if it doesn't exist
    try {
      await executeQuery(`ALTER TABLE targets ADD COLUMN IF NOT EXISTS "publicShowStatus" BOOLEAN DEFAULT true`);
    } catch (error) {
      // Column already exists, ignore
    }

    // Migration: Add publicShowAppLink column if it doesn't exist
    try {
      await executeQuery(`ALTER TABLE targets ADD COLUMN IF NOT EXISTS "publicShowAppLink" BOOLEAN DEFAULT true`);
    } catch (error) {
      // Column already exists, ignore
    }

    // Ping results table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS "pingResults" (
        _id TEXT PRIMARY KEY,
        "targetId" TEXT NOT NULL,
        success BOOLEAN NOT NULL,
        "responseTime" INTEGER,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "statusCode" INTEGER,
        error TEXT,
        protocol TEXT,
        FOREIGN KEY("targetId") REFERENCES targets(_id)
      )
    `);

    // Alerts table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS alerts (
        _id TEXT PRIMARY KEY,
        "targetId" TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        message TEXT,
        FOREIGN KEY("targetId") REFERENCES targets(_id)
      )
    `);

    // Statistics table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS statistics (
        _id TEXT PRIMARY KEY,
        "targetId" TEXT NOT NULL,
        date DATE NOT NULL,
        "totalPings" INTEGER DEFAULT 0,
        "successfulPings" INTEGER DEFAULT 0,
        "failedPings" INTEGER DEFAULT 0,
        uptime REAL DEFAULT 0,
        "lastResponseTime" INTEGER DEFAULT 0,
        "avgResponseTime" REAL DEFAULT 0,
        "minResponseTime" INTEGER,
        "maxResponseTime" INTEGER,
        FOREIGN KEY("targetId") REFERENCES targets(_id),
        UNIQUE("targetId", date)
      )
    `);

    // Incidents table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS incidents (
        _id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        severity TEXT DEFAULT 'major',
        status TEXT DEFAULT 'investigating',
        "affectedServices" TEXT,
        updates TEXT,
        "resolvedAt" TIMESTAMP,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration: Add affectedServices column if it doesn't exist
    try {
      await executeQuery(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS "affectedServices" TEXT`);
    } catch (error) {
      // Column already exists, ignore
    }

    // Migration: Add updates column if it doesn't exist
    try {
      await executeQuery(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS updates TEXT`);
    } catch (error) {
      // Column already exists, ignore
    }

    // Migration: Add resolvedAt column if it doesn't exist
    try {
      await executeQuery(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP`);
    } catch (error) {
      // Column already exists, ignore
    }

    // Actions table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS actions (
        _id TEXT PRIMARY KEY,
        "targetId" TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        command TEXT,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY("targetId") REFERENCES targets(_id),
        UNIQUE("targetId", name)
      )
    `);

    // Favicons table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS favicons (
        _id TEXT PRIMARY KEY,
        "appUrl" TEXT NOT NULL UNIQUE,
        favicon TEXT,
        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Public UI Settings table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS "publicUISettings" (
        _id TEXT PRIMARY KEY DEFAULT 'settings',
        title TEXT DEFAULT 'Homelab',
        subtitle TEXT DEFAULT 'System Status & Application Dashboard',
        "customCSS" TEXT,
        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Initialize default settings if not exists
    await executeQuery(`
      INSERT INTO "publicUISettings" (_id, title, subtitle, "customCSS")
      VALUES ('settings', 'Homelab', 'System Status & Application Dashboard', NULL)
      ON CONFLICT (_id) DO NOTHING
    `);

    // Posts table (for blog/changelog)
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS posts (
        _id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        published BOOLEAN DEFAULT true,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Admin Settings table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS "adminSettings" (
        _id TEXT PRIMARY KEY DEFAULT 'settings',
        "sessionDurationDays" INTEGER DEFAULT 30,
        "dataRetentionDays" INTEGER DEFAULT 30,
        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration: Add dataRetentionDays column if it doesn't exist
    try {
      await executeQuery(`ALTER TABLE "adminSettings" ADD COLUMN IF NOT EXISTS "dataRetentionDays" INTEGER DEFAULT 30`);
    } catch (error) {
      // Column already exists, ignore
    }

    // Migration: Add debugLogging column if it doesn't exist
    try {
      await executeQuery(`ALTER TABLE "adminSettings" ADD COLUMN IF NOT EXISTS "debugLogging" BOOLEAN DEFAULT false`);
    } catch (error) {
      // Column already exists, ignore
    }

    // Initialize default admin settings if not exists
    await executeQuery(`
      INSERT INTO "adminSettings" (_id, "sessionDurationDays", "dataRetentionDays")
      VALUES ('settings', 30, 30)
      ON CONFLICT (_id) DO NOTHING
    `);

    // Create indices
    await executeQuery(`CREATE INDEX IF NOT EXISTS idx_targets_enabled ON targets(enabled)`);
    await executeQuery(`CREATE INDEX IF NOT EXISTS idx_pingResults_targetId ON "pingResults"("targetId")`);
    await executeQuery(`CREATE INDEX IF NOT EXISTS idx_pingResults_timestamp ON "pingResults"(timestamp)`);
    await executeQuery(`CREATE INDEX IF NOT EXISTS idx_alerts_targetId ON alerts("targetId")`);
    await executeQuery(`CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp)`);
    await executeQuery(`CREATE INDEX IF NOT EXISTS idx_statistics_targetId ON statistics("targetId")`);
    await executeQuery(`CREATE INDEX IF NOT EXISTS idx_statistics_date ON statistics(date)`);
    await executeQuery(`CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status)`);
    await executeQuery(`CREATE INDEX IF NOT EXISTS idx_actions_targetId ON actions("targetId")`);
    await executeQuery(`CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published)`);
    await executeQuery(`CREATE INDEX IF NOT EXISTS idx_posts_createdAt ON posts("createdAt")`);

    console.log(chalk.green('✓ PostgreSQL tables initialized'));
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
    find: (queryObj = {}) => {
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
            const cacheKey = cacheService.generateKey(name, queryObj, { sort: sortOption, limit: limitOption });
            const cached = cacheService.get(cacheKey);
            if (cached !== null) {
              return cached;
            }

            const keys = Object.keys(queryObj).filter(k => typeof queryObj[k] !== 'function');
            let sql = `SELECT * FROM "${name}"`;
            const params = [];
            let paramIndex = 1;

            if (keys.length > 0) {
              const whereClauses = keys.map(k => {
                const val = queryObj[k];
                // Handle MongoDB-style operators
                if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
                  if ('$gte' in val) {
                    const gteVal = val.$gte;
                    if (gteVal instanceof Date) {
                      params.push(gteVal.toISOString().split('T')[0]);
                    } else {
                      params.push(gteVal);
                    }
                    const idx = paramIndex++;
                    return `"${k}" >= $${idx}`;
                  } else if ('$lte' in val) {
                    const lteVal = val.$lte;
                    if (lteVal instanceof Date) {
                      params.push(lteVal.toISOString().split('T')[0]);
                    } else {
                      params.push(lteVal);
                    }
                    const idx = paramIndex++;
                    return `"${k}" <= $${idx}`;
                  } else if ('$gt' in val) {
                    const gtVal = val.$gt;
                    if (gtVal instanceof Date) {
                      params.push(gtVal.toISOString().split('T')[0]);
                    } else {
                      params.push(gtVal);
                    }
                    const idx = paramIndex++;
                    return `"${k}" > $${idx}`;
                  } else if ('$lt' in val) {
                    const ltVal = val.$lt;
                    if (ltVal instanceof Date) {
                      params.push(ltVal.toISOString().split('T')[0]);
                    } else {
                      params.push(ltVal);
                    }
                    const idx = paramIndex++;
                    return `"${k}" < $${idx}`;
                  } else {
                    // Fallback to JSON stringify for other objects
                    params.push(JSON.stringify(val));
                    const idx = paramIndex++;
                    return `"${k}" = $${idx}`;
                  }
                }
                // Handle different types
                if (typeof val === 'boolean') {
                  params.push(val);
                } else if (val instanceof Date) {
                  // Convert Date to ISO date string (YYYY-MM-DD)
                  params.push(val.toISOString().split('T')[0]);
                } else {
                  params.push(val);
                }
                const idx = paramIndex++;
                return `"${k}" = $${idx}`;
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

            const result = await executeQuery(sql, params);
            
            // Convert boolean integers back to booleans for compatibility
            const results = result.rows.map(row => {
              const converted = {};
              for (const [key, value] of Object.entries(row)) {
                // PostgreSQL returns booleans as booleans, but keep for consistency
                converted[key] = value;
              }
              return converted;
            });
            
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
    findOne: async (queryObj = {}) => {
      try {
        // Check cache first
        const cacheKey = cacheService.generateKey(name, queryObj, { findOne: true });
        const cached = cacheService.get(cacheKey);
        if (cached !== null) {
          return cached;
        }

        const keys = Object.keys(queryObj).filter(k => typeof queryObj[k] !== 'function');
        let sql = `SELECT * FROM "${name}"`;
        const params = [];
        let paramIndex = 1;

        if (keys.length > 0) {
          const whereClauses = keys.map(k => {
            const val = queryObj[k];
            // Handle different types
            if (typeof val === 'boolean') {
              params.push(val);
            } else if (val instanceof Date) {
              // Convert Date to ISO date string (YYYY-MM-DD) for DATE columns
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
            const idx = paramIndex++;
            return `"${k}" = $${idx}`;
          });
          sql += ' WHERE ' + whereClauses.join(' AND ');
        }

        sql += ' LIMIT 1';
        const result = await executeQuery(sql, params);
        const row = result.rows[0] || null;
        
        // Cache the result
        cacheService.set(cacheKey, row, getTTL(name));
        
        return row;
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
        const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
        const quotedFields = fields.map(f => `"${f}"`).join(', ');
        const values = fields.map(f => {
          const val = docWithId[f];
          // PostgreSQL handles booleans natively
          if (typeof val === 'boolean') {
            return val;
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

        // Use INSERT with ON CONFLICT for tables with unique constraints
        let sql = `INSERT INTO "${name}" (${quotedFields}) VALUES (${placeholders})`;
        
        // Handle unique constraints with ON CONFLICT for specific tables
        if (name === 'statistics') {
          // Statistics has UNIQUE(targetId, date) - use ON CONFLICT to increment values atomically
          // In ON CONFLICT, reference existing row columns directly (no qualifier needed)
          // and new row columns with excluded.
          const updateClauses = [];
          // Increment counters
          if (fields.includes('totalPings')) {
            updateClauses.push(`"totalPings" = statistics."totalPings" + excluded."totalPings"`);
          }
          if (fields.includes('successfulPings')) {
            updateClauses.push(`"successfulPings" = statistics."successfulPings" + excluded."successfulPings"`);
          }
          if (fields.includes('failedPings')) {
            updateClauses.push(`"failedPings" = statistics."failedPings" + excluded."failedPings"`);
          }
          // Update latest values
          if (fields.includes('lastResponseTime')) {
            updateClauses.push(`"lastResponseTime" = excluded."lastResponseTime"`);
          }
          // Recalculate average: weighted average of existing and new
          if (fields.includes('avgResponseTime')) {
            updateClauses.push(`"avgResponseTime" = CASE 
              WHEN statistics."totalPings" + excluded."totalPings" > 0 
              THEN (statistics."avgResponseTime" * statistics."totalPings" + excluded."avgResponseTime" * excluded."totalPings") / (statistics."totalPings" + excluded."totalPings")
              ELSE excluded."avgResponseTime"
            END`);
          }
          // Recalculate uptime percentage
          if (fields.includes('uptime')) {
            updateClauses.push(`"uptime" = CASE 
              WHEN statistics."totalPings" + excluded."totalPings" > 0 
              THEN (CAST(statistics."successfulPings" + excluded."successfulPings" AS REAL) / CAST(statistics."totalPings" + excluded."totalPings" AS REAL)) * 100
              ELSE excluded."uptime"
            END`);
          }
          // Update min/max response times
          if (fields.includes('minResponseTime')) {
            updateClauses.push(`"minResponseTime" = CASE 
              WHEN statistics."minResponseTime" IS NULL THEN excluded."minResponseTime"
              WHEN excluded."minResponseTime" IS NULL THEN statistics."minResponseTime"
              WHEN statistics."minResponseTime" < excluded."minResponseTime" THEN statistics."minResponseTime"
              ELSE excluded."minResponseTime"
            END`);
          }
          if (fields.includes('maxResponseTime')) {
            updateClauses.push(`"maxResponseTime" = CASE 
              WHEN statistics."maxResponseTime" IS NULL THEN excluded."maxResponseTime"
              WHEN excluded."maxResponseTime" IS NULL THEN statistics."maxResponseTime"
              WHEN statistics."maxResponseTime" > excluded."maxResponseTime" THEN statistics."maxResponseTime"
              ELSE excluded."maxResponseTime"
            END`);
          }
          if (updateClauses.length > 0) {
            sql = `INSERT INTO "${name}" (${quotedFields}) VALUES (${placeholders}) ON CONFLICT("targetId", date) DO UPDATE SET ${updateClauses.join(', ')}`;
          }
        } else if (name === 'actions') {
          // Actions has UNIQUE(targetId, name) - use ON CONFLICT to update instead
          const updateFields = fields.filter(f => f !== '_id' && f !== 'targetId' && f !== 'name');
          const updateClauses = updateFields.map(f => `"${f}" = excluded."${f}"`).join(', ');
          sql = `INSERT INTO "${name}" (${quotedFields}) VALUES (${placeholders}) ON CONFLICT("targetId", name) DO UPDATE SET ${updateClauses}`;
        } else if (name === 'favicons') {
          // Favicons has UNIQUE(appUrl) - use ON CONFLICT to update instead
          const updateFields = fields.filter(f => f !== '_id' && f !== 'appUrl');
          const updateClauses = updateFields.map(f => `"${f}" = excluded."${f}"`).join(', ');
          sql = `INSERT INTO "${name}" (${quotedFields}) VALUES (${placeholders}) ON CONFLICT("appUrl") DO UPDATE SET ${updateClauses}`;
        } else if (name === 'targets') {
          // Targets has UNIQUE(name) - use ON CONFLICT to update instead
          const updateFields = fields.filter(f => f !== '_id' && f !== 'name');
          const updateClauses = updateFields.map(f => `"${f}" = excluded."${f}"`).join(', ');
          sql = `INSERT INTO "${name}" (${quotedFields}) VALUES (${placeholders}) ON CONFLICT(name) DO UPDATE SET ${updateClauses}`;
        }
        
        await executeQuery(sql, values);
        
        // Invalidate cache for this collection
        cacheService.invalidateCollection(name);
        
        return { insertedId: id };
      } catch (error) {
        console.error(chalk.red(`Error inserting into ${name}:`), error.message);
        throw error;
      }
    },
    updateOne: async (queryObj, update) => {
      try {
        const { $set } = update;
        const setClauses = Object.keys($set).map((k, i) => `"${k}" = $${i + 1}`).join(', ');
        const setValues = Object.values($set).map((v, idx) => {
          if (typeof v === 'boolean') {
            return v;
          }
          if (v instanceof Date) {
            // For statistics table date column, use date format (YYYY-MM-DD)
            const key = Object.keys($set)[idx];
            if (name === 'statistics' && key === 'date') {
              return v.toISOString().split('T')[0];
            }
            return v.toISOString().replace('T', ' ').substring(0, 19);
          }
          if (typeof v === 'object' && v !== null) {
            return JSON.stringify(v);
          }
          return v;
        });

        const queryKeys = Object.keys(queryObj);
        const whereClauses = queryKeys.map((k, i) => `"${k}" = $${setValues.length + i + 1}`).join(' AND ');
        const whereValues = Object.values(queryObj).map((v, idx) => {
          if (typeof v === 'boolean') {
            return v;
          }
          if (v instanceof Date) {
            // For statistics table date column, use date format (YYYY-MM-DD)
            const key = Object.keys(queryObj)[idx];
            if (name === 'statistics' && key === 'date') {
              return v.toISOString().split('T')[0];
            }
            return v.toISOString().replace('T', ' ').substring(0, 19);
          }
          if (typeof v === 'object' && v !== null) {
            return JSON.stringify(v);
          }
          return v;
        });

        const sql = `UPDATE "${name}" SET ${setClauses} WHERE ${whereClauses}`;
        const result = await executeQuery(sql, [...setValues, ...whereValues]);
        
        // Invalidate cache for this collection
        cacheService.invalidateCollection(name);
        
        return { modifiedCount: result.rowCount || 0 };
      } catch (error) {
        console.error(chalk.red(`Error updating ${name}:`), error.message);
        throw error;
      }
    },
    deleteOne: async (queryObj) => {
      try {
        const keys = Object.keys(queryObj);
        const whereClauses = keys.map((k, i) => `"${k}" = $${i + 1}`).join(' AND ');
        const values = Object.values(queryObj).map(v => {
          if (typeof v === 'boolean') {
            return v;
          }
          if (v instanceof Date) {
            return v.toISOString().replace('T', ' ').substring(0, 19);
          }
          return v;
        });

        const sql = `DELETE FROM "${name}" WHERE ${whereClauses}`;
        const result = await executeQuery(sql, values);
        
        // Invalidate cache for this collection
        cacheService.invalidateCollection(name);
        
        return { deletedCount: result.rowCount || 0 };
      } catch (error) {
        console.error(chalk.red(`Error deleting from ${name}:`), error.message);
        throw error;
      }
    },
    deleteMany: async (queryObj = {}) => {
      try {
        const keys = Object.keys(queryObj).filter(k => typeof queryObj[k] !== 'function');
        let sql = `DELETE FROM "${name}"`;
        const params = [];
        let paramIndex = 1;

        if (keys.length > 0) {
          const whereClauses = keys.map(k => {
            const val = queryObj[k];
            if (typeof val === 'boolean') {
              params.push(val);
            } else if (val instanceof Date) {
              params.push(val.toISOString().split('T')[0]);
            } else {
              params.push(val);
            }
            const idx = paramIndex++;
            return `"${k}" = $${idx}`;
          });
          sql += ' WHERE ' + whereClauses.join(' AND ');
        }

        const result = await executeQuery(sql, params);
        
        // Invalidate cache for this collection
        cacheService.invalidateCollection(name);
        
        return { deletedCount: result.rowCount || 0 };
      } catch (error) {
        console.error(chalk.red(`Error deleting from ${name}:`), error.message);
        throw error;
      }
    },
    countDocuments: async (queryObj = {}) => {
      try {
        // Check cache first
        const cacheKey = cacheService.generateKey(name, queryObj, { count: true });
        const cached = cacheService.get(cacheKey);
        if (cached !== null) {
          return cached;
        }

        const keys = Object.keys(queryObj).filter(k => typeof queryObj[k] !== 'function');
        let sql = `SELECT COUNT(*) as count FROM "${name}"`;
        const params = [];
        let paramIndex = 1;

        if (keys.length > 0) {
          const whereClauses = keys.map(k => {
            const val = queryObj[k];
            params.push(typeof val === 'boolean' ? val : val);
            const idx = paramIndex++;
            return `"${k}" = $${idx}`;
          });
          sql += ' WHERE ' + whereClauses.join(' AND ');
        }

        const result = await executeQuery(sql, params);
        const count = result.rows[0] ? parseInt(result.rows[0].count) : 0;
        
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
  if (!pool) {
    throw new Error('Database not connected. Call connectDB() first.');
  }
  return {
    collection: (name) => createCollectionWrapper(name),
    admin: () => ({
      ping: async () => {
        try {
          const client = await pool.connect();
          await client.query('SELECT 1');
          client.release();
          return true;
        } catch (error) {
          return false;
        }
      }
    }),
    // Direct query method for complex SQL queries
    query: async (text, params) => {
      return await executeQuery(text, params);
    }
  };
};

const closeDB = async () => {
  if (pool) {
    await pool.end();
    console.log(chalk.green('✓ PostgreSQL connection closed'));
  }
};

module.exports = {
  connectDB,
  getDB,
  closeDB,
};
