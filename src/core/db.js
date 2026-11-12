import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

fs.mkdirSync('data', { recursive: true });
export const db = new DatabaseSync('data/bot.db');
// WAL + synchronous=NORMAL: 書き込みのたびにディスクの完了を待たない(WALでは、電源断でも壊れず、最後の数件が失われるだけ)。
// このDBは同期APIなので、書き込みが遅いと、その間BOT全体が止まる。busy_timeout は、別のプロセスが使っているときの待ち時間
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');

// 遅いクエリを、ログに出す(原因調べ用)。200ms以上かかったものだけ
const SLOW_MS = 200;
const origPrepare = db.prepare.bind(db);
db.prepare = (sql) => {
  const st = origPrepare(sql);
  for (const m of ['run', 'get', 'all']) {
    const f = st[m].bind(st);
    st[m] = (...a) => { const t = performance.now(); try { return f(...a); } finally { const d = performance.now() - t; if (d > SLOW_MS) console.warn(`[db] 遅いクエリ ${Math.round(d)}ms: ${String(sql).replace(/\s+/g, ' ').slice(0, 100)}`); } };
  }
  return st;
};

/** 機能ごとのテーブル作成。各featureのinitで呼ぶ (CREATE IF NOT EXISTS 推奨) */
export const migrate = (sql) => db.exec(sql);

// 汎用の「サーバー×キー」設定ストア。新機能の設定はまずこれで足りる
migrate(`CREATE TABLE IF NOT EXISTS guild_kv (
  guild_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (guild_id, key))`);
export const getKV = (guildId, key, fallback = null) => {
  const r = db.prepare('SELECT value FROM guild_kv WHERE guild_id=? AND key=?').get(guildId, key);
  return r ? JSON.parse(r.value) : fallback;
};
export const setKV = (guildId, key, value) =>
  db.prepare(`INSERT INTO guild_kv (guild_id,key,value) VALUES (?,?,?)
    ON CONFLICT(guild_id,key) DO UPDATE SET value=excluded.value`).run(guildId, key, JSON.stringify(value));
