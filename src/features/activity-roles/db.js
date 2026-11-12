import { db, migrate } from '../../core/db.js';

migrate(`
CREATE TABLE IF NOT EXISTS stats (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  reactions_received INTEGER NOT NULL DEFAULT 0,
  reactions_given INTEGER NOT NULL DEFAULT 0,
  voice_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  role_id TEXT NOT NULL,
  replace_lower INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rules_guild ON rules(guild_id);
CREATE TABLE IF NOT EXISTS settings (
  guild_id TEXT PRIMARY KEY,
  message_cooldown INTEGER NOT NULL DEFAULT 5,
  voice_require_others INTEGER NOT NULL DEFAULT 0
);
`);

// 通知機能の追加カラム(既存DBにも適用。すでにあれば無視)
for (const col of ['notify_channel_id TEXT', 'notify_template TEXT']) {
  try { db.exec(`ALTER TABLE settings ADD COLUMN ${col}`); } catch { /* exists */ }
}

// ルールの「条件を下回ったらロールを剥奪」オプション(既存DBにも追加)
try { db.exec('ALTER TABLE rules ADD COLUMN revoke INTEGER NOT NULL DEFAULT 0'); } catch { /* exists */ }

// 退出したメンバーはランキングから除外する(統計は残すので、再参加すれば復活する)
try { db.exec('ALTER TABLE stats ADD COLUMN is_left INTEGER NOT NULL DEFAULT 0'); } catch { /* exists */ }

export const setLeft = (guildId, userId, left) =>
  db.prepare('UPDATE stats SET is_left=? WHERE guild_id=? AND user_id=?').run(left ? 1 : 0, guildId, userId);

/** サーバーに実在するメンバーIDの一覧で、退出フラグを一括で合わせ直す */
export function reconcileMembers(guildId, memberIds) {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE stats SET is_left=1 WHERE guild_id=?').run(guildId);
    const up = db.prepare('UPDATE stats SET is_left=0 WHERE guild_id=? AND user_id=?');
    for (const id of memberIds) up.run(guildId, id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// 条件の種類。voice_minutes は保存値(秒)から換算する
export const METRICS = {
  messages: '発言数',
  reactions_received: 'もらったリアクション数',
  reactions_given: 'つけたリアクション数',
  voice_minutes: 'VC接続時間(分)',
};
const COLS = ['messages', 'reactions_received', 'reactions_given', 'voice_seconds'];

export function addStat(guildId, userId, col, n = 1) {
  if (!COLS.includes(col)) throw new Error('bad column');
  db.prepare(
    `INSERT INTO stats (guild_id, user_id, ${col}) VALUES (?, ?, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET ${col} = MAX(0, ${col} + excluded.${col})`
  ).run(guildId, userId, n);
}

export function getStats(guildId, userId) {
  const r = db.prepare('SELECT * FROM stats WHERE guild_id=? AND user_id=?').get(guildId, userId);
  return r ?? { messages: 0, reactions_received: 0, reactions_given: 0, voice_seconds: 0 };
}

export const metricValue = (s, metric) =>
  metric === 'voice_minutes' ? Math.floor(s.voice_seconds / 60) : s[metric] ?? 0;

export const getRules = (guildId) =>
  db.prepare('SELECT * FROM rules WHERE guild_id=? ORDER BY metric, threshold').all(guildId);

export function getSettings(guildId) {
  return (
    db.prepare('SELECT * FROM settings WHERE guild_id=?').get(guildId) ?? {
      guild_id: guildId, message_cooldown: 5, voice_require_others: 0, notify_channel_id: null, notify_template: null,
    }
  );
}
export function saveSettings(guildId, { message_cooldown, voice_require_others, notify_channel_id = null, notify_template = null }) {
  db.prepare(
    `INSERT INTO settings (guild_id, message_cooldown, voice_require_others, notify_channel_id, notify_template) VALUES (?,?,?,?,?)
     ON CONFLICT(guild_id) DO UPDATE SET message_cooldown=excluded.message_cooldown,
       voice_require_others=excluded.voice_require_others,
       notify_channel_id=excluded.notify_channel_id, notify_template=excluded.notify_template`
  ).run(guildId, message_cooldown, voice_require_others, notify_channel_id, notify_template);
}

export const leaderboard = (guildId, metric, limit = 50) => {
  const col = metric === 'voice_minutes' ? 'voice_seconds' : metric;
  if (!COLS.includes(col)) return [];
  return db.prepare(`SELECT * FROM stats WHERE guild_id=? AND is_left=0 ORDER BY ${col} DESC LIMIT ?`).all(guildId, limit);
};
