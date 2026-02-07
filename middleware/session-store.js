const session = require('express-session');
const db = require('../db/init');

class SQLiteStore extends session.Store {
  constructor() {
    super();
  }

  get(sid, callback) {
    try {
      const stmt = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?');
      const row = stmt.get(sid, Date.now());
      if (row) {
        callback(null, JSON.parse(row.sess));
      } else {
        callback(null, null);
      }
    } catch (err) {
      callback(err);
    }
  }

  set(sid, session, callback) {
    try {
      const maxAge = session.cookie?.maxAge || 86400000;
      const expired = Date.now() + maxAge;
      const sess = JSON.stringify(session);

      const stmt = db.prepare(`
        INSERT OR REPLACE INTO sessions (sid, sess, expired)
        VALUES (?, ?, ?)
      `);
      stmt.run(sid, sess, expired);
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid, callback) {
    try {
      const stmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
      stmt.run(sid);
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid, session, callback) {
    this.set(sid, session, callback);
  }

  clear(callback) {
    try {
      db.prepare('DELETE FROM sessions').run();
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  length(callback) {
    try {
      const stmt = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE expired > ?');
      const row = stmt.get(Date.now());
      callback(null, row?.count || 0);
    } catch (err) {
      callback(err);
    }
  }
}

module.exports = SQLiteStore;
