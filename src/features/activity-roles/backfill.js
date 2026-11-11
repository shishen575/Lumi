import { ChannelType, PermissionFlagsBits, SnowflakeUtil } from 'discord.js';
import { db, migrate } from '../../core/db.js';
import { evaluateGuild } from './roles.js';

// 進捗・集計途中の値はすべてDBに保存(メモリには持たない)。再起動後も進捗が残り、続きから再開できる
migrate(`
CREATE TABLE IF NOT EXISTS backfill_jobs (
  guild_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,            -- running / done / error / interrupted
  phase TEXT NOT NULL DEFAULT 'collect',
  from_ts INTEGER, to_ts INTEGER, end_ts INTEGER NOT NULL, started_at INTEGER NOT NULL,
  scan_start INTEGER, finished_at INTEGER, elapsed_ms INTEGER NOT NULL DEFAULT 0,
  include_live INTEGER NOT NULL DEFAULT 1,
  total INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, scanned INTEGER NOT NULL DEFAULT 0,
  chfrac REAL NOT NULL DEFAULT 0, current TEXT NOT NULL DEFAULT '',
  error TEXT, users INTEGER NOT NULL DEFAULT 0, roles_changed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS backfill_counts (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS backfill_channels (
  guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, name TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0, cursor TEXT,
  PRIMARY KEY (guild_id, channel_id)
);
`);

const locks = new Set(); // 二重実行防止の鍵のみ(状態は持たない)

/** BOT起動時: 前回の実行中ジョブは中断扱いにする */
export function markInterrupted() {
  db.prepare("UPDATE backfill_jobs SET status='interrupted' WHERE status='running'").run();
}

export function getJob(guildId) {
  const j = db.prepare('SELECT * FROM backfill_jobs WHERE guild_id=?').get(guildId);
  if (!j) return null;
  const running = j.status === 'running';
  const p = j.status === 'done' ? 1 : j.total ? Math.min(1, (j.done + j.chfrac) / j.total) : 0;
  const elapsed = running ? j.elapsed_ms + (Date.now() - j.scan_start) : j.elapsed_ms;
  // 残り時間の目安: 経過時間を進捗率で外挿(2%未満は不正確なので出さない)
  const etaMs = running && j.phase === 'scan' && p >= 0.02 ? Math.round((elapsed / p) * (1 - p)) : null;
  return { status: j.status, running, phase: j.phase, percent: Math.floor(p * 100), etaMs, elapsedMs: elapsed,
    startedAt: j.started_at, from: j.from_ts, to: j.to_ts, total: j.total, done: j.done, scanned: j.scanned,
    current: j.current, error: j.error, finishedAt: j.finished_at, users: j.users, rolesChanged: j.roles_changed };
}

/** 取り込み中に届いたリアルタイムの発言を記録(最後に足し戻す) */
export function noteLive(guildId, userId) {
  const j = db.prepare("SELECT include_live FROM backfill_jobs WHERE guild_id=? AND status='running'").get(guildId);
  if (!j?.include_live) return;
  db.prepare(`INSERT INTO backfill_counts (guild_id,user_id,live) VALUES (?,?,1)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET live=live+1`).run(guildId, userId);
}

const canRead = (ch, me) =>
  ch.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]);

async function collectTargets(guild) {
  const me = guild.members.me;
  const targets = new Map();
  const add = (ch) => { if (ch?.isTextBased() && canRead(ch, me)) targets.set(ch.id, ch); };
  const archived = async (parent) => {
    let before;
    try {
      for (;;) { // 公開のアーカイブ済みスレッド
        const r = await parent.threads.fetchArchived({ type: 'public', before, limit: 100 });
        r.threads.forEach(add);
        if (!r.hasMore || !r.threads.size) break;
        before = r.threads.last();
      }
    } catch { /* 権限なし等は無視 */ }
  };
  for (const ch of guild.channels.cache.values()) {
    if (ch.isThread()) continue;
    if (ch.type === ChannelType.GuildForum || ch.type === ChannelType.GuildMedia) {
      if (canRead(ch, me)) await archived(ch);
    } else if (ch.isTextBased()) {
      add(ch);
      if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) await archived(ch);
    }
  }
  try { (await guild.channels.fetchActiveThreads()).threads.forEach(add); } catch { /* ignore */ }
  return [...targets.values()];
}

/** range: { from?: ms, to?: ms }  from以上 to未満の発言だけ数える(未指定なら全期間〜現在) */
export function startBackfill(guild, { from = null, to = null } = {}) {
  if (locks.has(guild.id)) return false;
  const T = Date.now();
  const end = to == null ? T : Math.min(to, T);
  db.exec('BEGIN');
  for (const t of ['backfill_jobs', 'backfill_counts', 'backfill_channels']) db.prepare(`DELETE FROM ${t} WHERE guild_id=?`).run(guild.id);
  db.prepare(`INSERT INTO backfill_jobs (guild_id,status,phase,from_ts,to_ts,end_ts,started_at,scan_start,include_live)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(guild.id, 'running', 'collect', from, to == null ? null : end, end, T, T, to == null || to >= T ? 1 : 0);
  db.exec('COMMIT');
  launch(guild, true);
  return true;
}

/** 中断されたジョブを続きから再開 */
export function resumeBackfill(guild) {
  const j = db.prepare('SELECT status FROM backfill_jobs WHERE guild_id=?').get(guild.id);
  if (locks.has(guild.id) || j?.status !== 'interrupted') return false;
  db.prepare("UPDATE backfill_jobs SET status='running', error=NULL, scan_start=? WHERE guild_id=?").run(Date.now(), guild.id);
  launch(guild, false);
  return true;
}

function launch(guild, fresh) {
  locks.add(guild.id);
  run(guild, fresh)
    .catch((e) => {
      console.error('[backfill]', e);
      db.prepare("UPDATE backfill_jobs SET status='error', error=? WHERE guild_id=?").run(e.message, guild.id);
    })
    .finally(() => locks.delete(guild.id));
}

async function run(guild, fresh) {
  const gid = guild.id;
  const jobRow = () => db.prepare('SELECT * FROM backfill_jobs WHERE guild_id=?').get(gid);
  const job = jobRow();
  const setJob = (cols, ...vals) => db.prepare(`UPDATE backfill_jobs SET ${cols} WHERE guild_id=?`).run(...vals, gid);

  if (fresh) {
    const targets = await collectTargets(guild);
    const ins = db.prepare('INSERT OR IGNORE INTO backfill_channels (guild_id,channel_id,name) VALUES (?,?,?)');
    db.exec('BEGIN'); for (const c of targets) ins.run(gid, c.id, c.name); db.exec('COMMIT');
    setJob("phase='scan', total=?, scan_start=?", targets.length, Date.now());
  } else setJob("phase='scan'");

  const upto = SnowflakeUtil.generate({ timestamp: job.end_ts }).toString();
  const addCount = db.prepare(`INSERT INTO backfill_counts (guild_id,user_id,n) VALUES (?,?,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET n=n+excluded.n`);
  const pending = db.prepare('SELECT * FROM backfill_channels WHERE guild_id=? AND done=0').all(gid);

  for (const row of pending) {
    const ch = await guild.channels.fetch(row.channel_id).catch(() => null);
    if (ch) {
      setJob('current=?', row.name);
      // チャンネル内の進捗は「最新メッセージ時刻 → 期間の開始(or作成日)」のどこまで遡ったかで推定
      const lo = Math.max(job.from_ts ?? 0, SnowflakeUtil.timestampFrom(ch.id));
      const hi = Math.min(job.end_ts, ch.lastMessageId ? SnowflakeUtil.timestampFrom(ch.lastMessageId) : job.end_ts);
      let before = row.cursor ?? upto;
      try {
        for (;;) {
          const batch = await ch.messages.fetch({ limit: 100, before });
          if (!batch.size) break;
          const per = new Map();
          let reachedStart = false;
          for (const m of batch.values()) {
            if (job.from_ts != null && m.createdTimestamp < job.from_ts) { reachedStart = true; continue; }
            if (m.author.bot || m.webhookId || m.system) continue;
            per.set(m.author.id, (per.get(m.author.id) ?? 0) + 1);
          }
          before = batch.last().id; // 新しい順なので最後が最古
          const frac = hi > lo ? Math.min(0.99, Math.max(0, (hi - Math.max(batch.last().createdTimestamp, lo)) / (hi - lo))) : 0;
          db.exec('BEGIN'); // カウント・カーソル・進捗を1トランザクションで保存(中断しても二重計上しない)
          for (const [u, n] of per) addCount.run(gid, u, n);
          db.prepare('UPDATE backfill_channels SET cursor=? WHERE guild_id=? AND channel_id=?').run(before, gid, row.channel_id);
          setJob('scanned=scanned+?, chfrac=?', batch.size, frac);
          db.exec('COMMIT');
          if (reachedStart || batch.size < 100) break;
        }
      } catch (e) { console.warn(`[backfill] skip #${row.name}: ${e.message}`); }
    }
    db.prepare('UPDATE backfill_channels SET done=1 WHERE guild_id=? AND channel_id=?').run(gid, row.channel_id);
    setJob('done=done+1, chfrac=0');
  }

  // 上書き: 過去分 + 取り込み中のリアルタイム分
  setJob("phase='apply', current=''");
  const counts = db.prepare('SELECT user_id, n+live AS total FROM backfill_counts WHERE guild_id=?').all(gid);
  db.exec('BEGIN');
  db.prepare('UPDATE stats SET messages=0 WHERE guild_id=?').run(gid);
  const up = db.prepare(`INSERT INTO stats (guild_id,user_id,messages) VALUES (?,?,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET messages=excluded.messages`);
  for (const c of counts) up.run(gid, c.user_id, c.total);
  db.exec('COMMIT');
  const changed = await evaluateGuild(guild);
  const cur = jobRow();
  setJob("status='done', phase='done', users=?, roles_changed=?, finished_at=?, elapsed_ms=?",
    counts.length, changed, Date.now(), cur.elapsed_ms + (Date.now() - cur.scan_start));
  db.prepare('DELETE FROM backfill_counts WHERE guild_id=?').run(gid); // 作業用データを掃除
  db.prepare('DELETE FROM backfill_channels WHERE guild_id=?').run(gid);
}
