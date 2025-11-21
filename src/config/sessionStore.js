const Database = require('better-sqlite3');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

let db = null;

class SQLiteSessionStore extends session.Store {
  constructor(options = {}) {
    super(options);
    const dbDir = path.join(process.cwd(), 'data');
    const dbPath = path.join(dbDir, 'localping.db');

    // Ensure data directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');

    // Create sessions table if it doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expire INTEGER NOT NULL
      )
    `);

    // Create index on expire for cleanup
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire)
    `);

    // Clean up expired sessions periodically (every hour)
    setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000);
  }

  get(sid, callback) {
    try {
      const stmt = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expire > ?');
      const row = stmt.get(sid, Date.now());
      
      if (row) {
        callback(null, JSON.parse(row.sess));
      } else {
        callback(null, null);
      }
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sess, callback) {
    try {
      const expire = sess.cookie && sess.cookie.expires
        ? sess.cookie.expires.getTime()
        : Date.now() + (24 * 60 * 60 * 1000); // Default 24 hours

      const stmt = db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expire) VALUES (?, ?, ?)');
      stmt.run(sid, JSON.stringify(sess), expire);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback) {
    try {
      const stmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
      stmt.run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  all(callback) {
    try {
      const stmt = db.prepare('SELECT sess FROM sessions WHERE expire > ?');
      const rows = stmt.all(Date.now());
      const sessions = rows.map(row => JSON.parse(row.sess));
      callback(null, sessions);
    } catch (error) {
      callback(error);
    }
  }

  length(callback) {
    try {
      const stmt = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE expire > ?');
      const row = stmt.get(Date.now());
      callback(null, row ? row.count : 0);
    } catch (error) {
      callback(error);
    }
  }

  clear(callback) {
    try {
      db.exec('DELETE FROM sessions');
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sess, callback) {
    try {
      const expire = sess.cookie && sess.cookie.expires
        ? sess.cookie.expires.getTime()
        : Date.now() + (24 * 60 * 60 * 1000);

      const stmt = db.prepare('UPDATE sessions SET sess = ?, expire = ? WHERE sid = ?');
      stmt.run(JSON.stringify(sess), expire, sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  cleanup() {
    try {
      const stmt = db.prepare('DELETE FROM sessions WHERE expire < ?');
      stmt.run(Date.now());
    } catch (error) {
      console.error('Error cleaning up sessions:', error);
    }
  }
}

module.exports = SQLiteSessionStore;

