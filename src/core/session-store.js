import session from 'express-session';
import { db, migrate } from './db.js';

// ログイン状態をDBに保存する。メモリだけだと、BOTを再起動するたびに全員がログアウトされてしまう
migrate('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL)');

const DEFAULT_TTL = 7 * 864e5;
const expiryOf = (sess) => (sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + DEFAULT_TTL);

export class SqliteStore extends session.Store {
  constructor() {
    super();
    const purge = () => db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()); // 期限切れを掃除
    purge();
    setInterval(purge, 3600e3).unref?.();
  }
  get(sid, cb) {
    try {
      const r = db.prepare('SELECT data, expires FROM sessions WHERE sid=?').get(sid);
      if (!r || r.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(r.data));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      db.prepare('INSERT INTO sessions (sid,data,expires) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires=excluded.expires')
        .run(sid, JSON.stringify(sess), expiryOf(sess));
      cb?.(null);
    } catch (e) { cb?.(e); }
  }
  touch(sid, sess, cb) { // 期限だけ延ばす
    try { db.prepare('UPDATE sessions SET expires=? WHERE sid=?').run(expiryOf(sess), sid); cb?.(null); } catch (e) { cb?.(e); }
  }
  destroy(sid, cb) {
    try { db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); cb?.(null); } catch (e) { cb?.(e); }
  }
}
