import { MessageType } from 'discord.js';
import { db, migrate, getKV, setKV } from '../../core/db.js';

/**
 * 過去のピン留めの、集計。Discord は、「ピンを外した」あとの記録を、持っていませんが、
 * 「◯◯さんが、メッセージをピン留めしました」という、システムのメッセージが、チャンネルの履歴に、残っています(消されていなければ)。
 * それを、全チャンネルの履歴から、拾って、「ピン留めした人」と、「ピン留めされた発言の、発言者」を、数えます(外したピンも、入ります)。
 */
migrate(`CREATE TABLE IF NOT EXISTS pin_log (
  guild_id TEXT NOT NULL, sys_id TEXT NOT NULL, channel_id TEXT NOT NULL, pinner_id TEXT NOT NULL, target_id TEXT, target_author TEXT, at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, sys_id))`);
const locks = new Set();
export const scanState = (g) => getKV(g, 'pin_scan', null);
const setState = (g, patch) => setKV(g, 'pin_scan', { ...(scanState(g) ?? {}), ...patch });

/** 集計: { total, byPinner, byTarget, finishedAt }(まだ、調べていなければ null) */
export function pinHistory(g) {
  const st = scanState(g); if (!st || st.status !== 'done') return null;
  const rows = db.prepare('SELECT pinner_id, target_author FROM pin_log WHERE guild_id=?').all(g), byPinner = new Map(), byTarget = new Map();
  for (const r of rows) { byPinner.set(r.pinner_id, (byPinner.get(r.pinner_id) ?? 0) + 1); if (r.target_author && r.target_author !== '?') byTarget.set(r.target_author, (byTarget.get(r.target_author) ?? 0) + 1); }
  return { total: rows.length, byPinner, byTarget, unknownTargets: rows.filter((r) => !r.target_author || r.target_author === '?').length, finishedAt: st.finishedAt, channels: st.channels ?? 0 };
}

/** 調べを、始める(裏で、動く)。targets: 読めるチャンネル・スレッドの一覧 */
export function startPinScan(guild, targets, { notify = null } = {}) {
  const g = guild.id; if (locks.has(g)) return false;
  locks.add(g); setState(g, { status: 'running', startedAt: Date.now(), total: targets.length, done: 0, found: 0, current: '', error: null, channels: targets.length });
  run(guild, targets).catch((e) => { console.error('[pins:scan]', e); setState(g, { status: 'error', error: e.message }); }).finally(async () => { locks.delete(g); try { await notify?.(scanState(g)); } catch { /* 通知に、失敗しても、結果は、残る */ } });
  return true;
}
async function run(guild, targets) {
  const g = guild.id, ins = db.prepare('INSERT OR IGNORE INTO pin_log (guild_id, sys_id, channel_id, pinner_id, target_id, at) VALUES (?,?,?,?,?,?)');
  let found = 0, done = 0;
  for (const ch of targets) {
    setState(g, { current: ch.name });
    let before;
    try {
      for (;;) {
        const batch = await ch.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        if (!batch.size) break;
        db.exec('BEGIN');
        for (const m of batch.values()) if (m.type === MessageType.ChannelPinnedMessage && m.author && !m.author.bot) { found += Number(ins.run(g, m.id, ch.id, m.author.id, m.reference?.messageId ?? null, m.createdTimestamp).changes); }
        db.exec('COMMIT');
        before = batch.last().id; if (batch.size < 100) break;
      }
    } catch (e) { try { db.exec('ROLLBACK'); } catch { /* なし */ } console.warn(`[pins:scan] skip #${ch.name}: ${e.message}`); }
    done++; setState(g, { done, found: db.prepare('SELECT COUNT(*) c FROM pin_log WHERE guild_id=?').get(g).c });
  }
  // ピン留めされた発言の、発言者を、調べる(消された発言は、「不明」)
  setState(g, { current: '発言者を調べています' });
  const byId = new Map(targets.map((c) => [c.id, c]));
  const todo = db.prepare("SELECT sys_id, channel_id, target_id FROM pin_log WHERE guild_id=? AND target_id IS NOT NULL AND target_author IS NULL").all(g);
  const upd = db.prepare('UPDATE pin_log SET target_author=? WHERE guild_id=? AND sys_id=?');
  for (const r of todo) { const ch = byId.get(r.channel_id); let author = '?'; try { const m = await ch.messages.fetch(r.target_id); if (m.author && !m.author.bot) author = m.author.id; } catch { /* 消された */ } upd.run(author, g, r.sys_id); }
  setState(g, { status: 'done', finishedAt: Date.now(), current: '', found: db.prepare('SELECT COUNT(*) c FROM pin_log WHERE guild_id=?').get(g).c });
}
