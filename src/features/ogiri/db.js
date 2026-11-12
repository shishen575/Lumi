import { db, migrate, getKV, setKV } from '../../core/db.js';

// 大喜利のデータ。仕様書8章の構造(guilds/posts/rounds/current/kusaEmoji)を、テーブルに置き換えたもの
migrate(`
CREATE TABLE IF NOT EXISTS ogiri_rounds (          -- お題(ラウンド)。round_id は最初のお題メッセージのID(再掲しても変わらない)
  round_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, odai TEXT NOT NULL,
  msg_id TEXT NOT NULL,                             -- 今のお題メッセージのID(再掲で変わる)
  since_bump INTEGER NOT NULL DEFAULT 0, last_bump INTEGER NOT NULL, created_at INTEGER NOT NULL,
  ended INTEGER NOT NULL DEFAULT 0                  -- 1: 終了(チャンネルごとに、ended=0 のお題は多くても1つ)
);
CREATE INDEX IF NOT EXISTS idx_ogiri_rounds_ch ON ogiri_rounds (guild_id, channel_id, ended);
CREATE TABLE IF NOT EXISTS ogiri_round_msgs (       -- お題として使ったメッセージ(再掲前のものも含む)。古いボタンからお題を辿る
  msg_id TEXT PRIMARY KEY, round_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ogiri_posts (            -- 回答
  msg_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, round_id TEXT NOT NULL,
  uid TEXT NOT NULL, name TEXT NOT NULL, odai TEXT NOT NULL, text TEXT NOT NULL,
  emoji_id TEXT, emoji_name TEXT,                   -- 投稿時の草の絵文字(あとで設定を変えても、この絵文字で数え続ける)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ogiri_posts_guild ON ogiri_posts (guild_id);
CREATE INDEX IF NOT EXISTS idx_ogiri_posts_round ON ogiri_posts (round_id);
CREATE TABLE IF NOT EXISTS ogiri_voters (           -- 草(投票者)。同じ人は1回だけ
  msg_id TEXT NOT NULL, uid TEXT NOT NULL, PRIMARY KEY (msg_id, uid)
);
`);

export const DEFAULT_EMOJI = { id: null, name: '☑️', animated: false };
export const kusaEmoji = (guildId) => getKV(guildId, 'ogiri_emoji', DEFAULT_EMOJI);
export const setKusaEmoji = (guildId, e) => setKV(guildId, 'ogiri_emoji', e);

/* ---------- 草の書き込み: 連打で重くならないよう、メモリにためて0.8秒ごとにまとめて書く ---------- */
let queue = [];
let timer = null;
export function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!queue.length) return;
  const ops = queue; queue = [];
  const add = db.prepare('INSERT OR IGNORE INTO ogiri_voters (msg_id, uid) VALUES (?, ?)');
  const del = db.prepare('DELETE FROM ogiri_voters WHERE msg_id=? AND uid=?');
  db.exec('BEGIN');
  try { for (const [op, msg, uid] of ops) (op === 'add' ? add : del).run(msg, uid); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); queue = ops.concat(queue); throw e; }
}
export function queueVote(op, msgId, uid) {
  queue.push([op, msgId, uid]);
  if (!timer) {
    timer = setTimeout(() => { timer = null; try { flush(); } catch (e) { console.error('[ogiri] 保存に失敗:', e.message); } }, 800);
    timer.unref?.();
  }
}

/* ---------- お題 ---------- */
export const activeRound = (guildId, channelId) =>
  db.prepare('SELECT * FROM ogiri_rounds WHERE guild_id=? AND channel_id=? AND ended=0 ORDER BY created_at DESC LIMIT 1').get(guildId, channelId);
export const roundById = (roundId) => db.prepare('SELECT * FROM ogiri_rounds WHERE round_id=?').get(roundId);
export const roundIdByMsg = (msgId) => db.prepare('SELECT round_id FROM ogiri_round_msgs WHERE msg_id=?').get(msgId)?.round_id;

/** 新しいお題を作る。同じチャンネルの進行中のお題は、終了扱いにする */
export function createRound({ guildId, channelId, odai, msgId }) {
  const now = Date.now();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE ogiri_rounds SET ended=1 WHERE guild_id=? AND channel_id=? AND ended=0').run(guildId, channelId);
    db.prepare('INSERT INTO ogiri_rounds (round_id,guild_id,channel_id,odai,msg_id,last_bump,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(msgId, guildId, channelId, odai, msgId, now, now);
    db.prepare('INSERT INTO ogiri_round_msgs (msg_id, round_id) VALUES (?, ?)').run(msgId, msgId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export const endRound = (roundId) => db.prepare('UPDATE ogiri_rounds SET ended=1 WHERE round_id=?').run(roundId);

/** 再掲: お題メッセージを差し替える(回答は round_id で紐づいているので、そのまま引き継がれる) */
export function moveRound(roundId, newMsgId) {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE ogiri_rounds SET msg_id=?, since_bump=0, last_bump=? WHERE round_id=?').run(newMsgId, Date.now(), roundId);
    db.prepare('INSERT OR REPLACE INTO ogiri_round_msgs (msg_id, round_id) VALUES (?, ?)').run(newMsgId, roundId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export const countAnswer = (roundId) => {
  db.prepare('UPDATE ogiri_rounds SET since_bump=since_bump+1 WHERE round_id=?').run(roundId);
  return roundById(roundId)?.since_bump ?? 0;
};

/* ---------- 回答 ---------- */
export const hasSameAnswer = (roundId, uid, text) =>
  !!db.prepare('SELECT 1 FROM ogiri_posts WHERE round_id=? AND uid=? AND text=?').get(roundId, uid, text);
export const addPost = (p) => db.prepare(`INSERT INTO ogiri_posts (msg_id,guild_id,channel_id,round_id,uid,name,odai,text,emoji_id,emoji_name,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(p.msgId, p.guildId, p.channelId, p.roundId, p.uid, p.name, p.odai, p.text, p.emoji.id, p.emoji.name, Date.now());
export const postByMsg = (msgId) => db.prepare('SELECT * FROM ogiri_posts WHERE msg_id=?').get(msgId);

const WITH_VOTES = `SELECT p.*, COALESCE(v.c, 0) AS votes FROM ogiri_posts p
  LEFT JOIN (SELECT msg_id, COUNT(*) AS c FROM ogiri_voters GROUP BY msg_id) v ON v.msg_id = p.msg_id`;
/** 草が多い順。同数は投稿の古い順 */
export const postsOfRound = (roundId) => { flush(); return db.prepare(`${WITH_VOTES} WHERE p.round_id=? ORDER BY votes DESC, p.created_at ASC`).all(roundId); };
export const lastPostInChannel = (guildId, channelId) =>
  db.prepare('SELECT * FROM ogiri_posts WHERE guild_id=? AND channel_id=? ORDER BY created_at DESC LIMIT 1').get(guildId, channelId);
export const bestPost = (guildId) => { flush(); return db.prepare(`${WITH_VOTES} WHERE p.guild_id=? ORDER BY votes DESC, p.created_at ASC LIMIT 1`).get(guildId); };
/** ユーザーごとの回答数と草の合計。草が多い順、同数なら回答数の少ない順 */
export const ranking = (guildId, limit = 10) => {
  flush();
  return db.prepare(`SELECT uid, COUNT(*) AS answers, COALESCE(SUM(votes), 0) AS kusa FROM (${WITH_VOTES} WHERE p.guild_id=?)
    GROUP BY uid ORDER BY kusa DESC, answers ASC, MIN(created_at) ASC LIMIT ?`).all(guildId, limit);
};
