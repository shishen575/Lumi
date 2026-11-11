import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

fs.mkdirSync('data', { recursive: true });
export const db = new DatabaseSync('data/bot.db');
db.exec('PRAGMA journal_mode = WAL;');

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
