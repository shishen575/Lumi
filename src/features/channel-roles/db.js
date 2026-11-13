import { db, migrate } from '../../core/db.js';

migrate(`
CREATE TABLE IF NOT EXISTS chr_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  min_messages INTEGER NOT NULL DEFAULT 1,
  include_threads INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_chr_rules ON chr_rules(guild_id, channel_id);
CREATE TABLE IF NOT EXISTS chr_counts (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, channel_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, channel_id)
);
CREATE TABLE IF NOT EXISTS chr_granted (
  rule_id INTEGER NOT NULL, user_id TEXT NOT NULL,
  PRIMARY KEY (rule_id, user_id)
);
`);

export const getRules = (g) => db.prepare('SELECT * FROM chr_rules WHERE guild_id=? ORDER BY id').all(g);
export const rulesForChannel = (g, ch) => db.prepare('SELECT * FROM chr_rules WHERE guild_id=? AND channel_id=?').all(g, ch);
export const getRule = (g, id) => db.prepare('SELECT * FROM chr_rules WHERE guild_id=? AND id=?').get(g, id);
export const addRule = (g, r) => Number(db.prepare('INSERT INTO chr_rules (guild_id,channel_id,role_id,min_messages,include_threads) VALUES (?,?,?,?,?)')
  .run(g, r.channel_id, r.role_id, r.min_messages, r.include_threads).lastInsertRowid);
export const updateRule = (g, id, r) => Number(db.prepare('UPDATE chr_rules SET channel_id=?,role_id=?,min_messages=?,include_threads=? WHERE guild_id=? AND id=?')
  .run(r.channel_id, r.role_id, r.min_messages, r.include_threads, g, id).changes) > 0;
export function deleteRule(g, id) {
  const row = getRule(g, id); if (!row) return false;
  db.prepare('DELETE FROM chr_rules WHERE guild_id=? AND id=?').run(g, id);
  db.prepare('DELETE FROM chr_granted WHERE rule_id=?').run(id);
  // そのチャンネルのルールが無くなったら、数えていた回数も消す
  if (!rulesForChannel(g, row.channel_id).length) db.prepare('DELETE FROM chr_counts WHERE guild_id=? AND channel_id=?').run(g, row.channel_id);
  return true;
}
/** チャンネルでの発言数を1増やして、いまの回数を返す */
export const bump = (g, u, ch) => db.prepare(`INSERT INTO chr_counts (guild_id,user_id,channel_id,count) VALUES (?,?,?,1)
  ON CONFLICT(guild_id,user_id,channel_id) DO UPDATE SET count=count+1 RETURNING count`).get(g, u, ch).count;
export const isGranted = (rid, u) => !!db.prepare('SELECT 1 FROM chr_granted WHERE rule_id=? AND user_id=?').get(rid, u);
export const markGranted = (rid, u) => db.prepare('INSERT OR IGNORE INTO chr_granted (rule_id,user_id) VALUES (?,?)').run(rid, u);
