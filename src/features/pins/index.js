import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits, ChannelType, MessageType, Events } from 'discord.js';
import { hasAccessSync, canEditAccess } from '../../core/access.js';
import { collectTargets } from '../activity-roles/backfill.js';
import { startPinScan, scanState, pinHistory, markStarting, markFailed, isScanning } from './history.js';

/**
 * ピン留めの数を、調べる。
 *  /pins count   … 1つのチャンネル(スレッド)の、ピン留めの数・いつ留めたか・だれの発言が多いか
 *  /pins ranking … サーバー全体で、ピン留めが多いチャンネルの順位(全部のチャンネルを、順に調べるので、少し時間がかかります)
 */
const EPH = { flags: MessageFlags.Ephemeral };
const cache = new Map(); // いまのピン留めの結果。自動では、探し直さない(「調べ直す」を押したときだけ)。新しいピン留めは、bumpPin で足す

const canRead = (ch, me) => ch.permissionsFor?.(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]);
/** そのチャンネルの、ピン留めを、全部、取る: [{ pinnedTimestamp, message }](新しい順) */
export async function fetchAllPins(ch, { max = 1000 } = {}) {
  const out = []; let before;
  while (out.length < max) {
    const page = await ch.messages.fetchPins({ limit: 50, ...(before ? { before } : {}) });
    out.push(...page.items);
    if (!page.hasMore || !page.items.length) break;
    before = page.items.at(-1).pinnedTimestamp;
  }
  return out;
}
/** サーバー内の、ピン留めの数を、チャンネルごとに数える(見られるチャンネルと、開いているスレッド)。4つずつ、同時に調べる。onProgress(done, total) で、進み具合を知らせる */
export async function countGuildPins(guild, { fetchPins = fetchAllPins, concurrency = 4, onProgress = null } = {}) {
  const me = guild.members.me, found = [];
  for (const ch of guild.channels.cache.values()) if (ch.isTextBased?.() && !ch.isVoiceBased?.() && ch.messages && canRead(ch, me)) found.push(ch);
  try { for (const th of (await guild.channels.fetchActiveThreads()).threads.values()) if (th.messages && canRead(th, me)) found.push(th); } catch { /* スレッドは、読めなくても、続ける */ }
  const list = [...new Map(found.map((c) => [c.id, c])).values()], rows = [], byUser = new Map();
  let failed = 0, next = 0, done = 0;
  onProgress?.(0, list.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (next < list.length) {
      const ch = list[next++];
      try {
        const pins = await Promise.race([fetchPins(ch), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 60_000))]); // 1チャンネルに、60秒以上は、かけない
        if (pins.length) rows.push({ id: ch.id, name: ch.name, count: pins.length, thread: !!ch.isThread?.() });
        for (const p of pins) { const a = p.message.author; if (a && !a.bot) byUser.set(a.id, (byUser.get(a.id) ?? 0) + 1); } // ピン留めされた発言の、発言者ごとの数(BOTの発言は、除く)
      } catch { failed++; }
      onProgress?.(++done, list.length);
    }
  }));
  return { rows: rows.sort((a, b) => b.count - a.count), byUser, failed, scanned: list.length };
}

/** 過去のピン留めの調べを、始める(裏で動く)。チャンネルの一覧集めも、裏で行うので、返事を待たせない。始められたら true */
export function startPinScanFor(i, deps = {}) {
  const g = i.guildId, channel = i.channel;
  if (isScanning(g)) return false;
  markStarting(g);
  (async () => {
    try {
      const targets = await (deps.targets ?? collectTargets)(i.guild);
      startPinScan(i.guild, targets, { notify: async (st) => { const h = pinHistory(g); await channel?.send?.({ content: st?.status === 'done' ? `✅ 過去のピン留めの集計が、終わりました(${h?.total ?? 0}件)。\`/pins history\` で見られます。\`/top metric:ピン留めされた数\` にも、入ります。` : `⚠️ ピン留めの集計が、止まりました: ${st?.error ?? '不明'}`, allowedMentions: { parse: [] } }); } });
    } catch (e) { markFailed(g, e.message); await channel?.send?.({ content: `⚠️ ピン留めの集計を、始められませんでした: ${e.message}`, allowedMentions: { parse: [] } }).catch(() => {}); }
  })();
  return true;
}
const when = (ts) => `<t:${Math.floor(ts / 1000)}:D>`;
const inflight = new Map(); // サーバーごとの、調べ中のもの(同じものを、何度も、調べない): { promise, done, total }
/** 調べている途中の、進み具合(なければ null) */
export const scanProgress = (g) => { const f = inflight.get(g); return f ? { done: f.done, total: f.total } : null; };
/** ピン留めされた(システムメッセージが来た)ら、覚えている結果に、1件、足す。外された分は、「調べ直す」まで、反映されない */
export function bumpPin(m) {
  if (m.type !== MessageType.ChannelPinnedMessage || !m.guildId || m.author?.bot) return;
  const hit = cache.get(m.guildId); if (!hit) return;
  const row = hit.rows.find((r) => r.id === m.channelId); if (row) row.count++; else hit.rows.push({ id: m.channelId, name: m.channel?.name ?? '', count: 1, thread: !!m.channel?.isThread?.() });
  hit.rows.sort((a, b) => b.count - a.count);
  const ref = m.reference?.messageId; if (!ref) return;
  m.channel.messages.fetch(ref).then((t) => { if (t.author && !t.author.bot) hit.byUser.set(t.author.id, (hit.byUser.get(t.author.id) ?? 0) + 1); }).catch(() => {});
}
/** サーバーに、いる人だけを、残す(抜けた人・アカウントが消えた人は、「不明」になるので、一覧から、消す)。entries: [[userId, n], ...] */
export async function onlyMembers(guild, entries) {
  const missing = entries.map(([u]) => u).filter((u) => !guild.members.cache.has(u));
  for (let k = 0; k < missing.length; k += 100) { try { await guild.members.fetch({ user: missing.slice(k, k + 100) }); } catch { /* 取れない人は、不明として、消える */ } }
  return entries.filter(([u]) => guild.members.cache.has(u));
}
export const cachedResult = (g) => cache.get(g) ?? null;
/** サーバー全体のピン留めの集計(10分、覚える)。/pins ranking・/top・ダッシュボードで、共有する。調べ中なら、その結果を、待つ */
export function cachedScan(guild, { refresh = false, scan = countGuildPins } = {}) {
  const hit = cache.get(guild.id);
  if (hit && !refresh) return Promise.resolve(hit);
  const running = inflight.get(guild.id); if (running) return running.promise;
  const f = { done: 0, total: 0 };
  f.promise = (async () => { try { const res = { ...(await scan(guild, { onProgress: (d, t) => { f.done = d; f.total = t; } })), at: Date.now() }; cache.set(guild.id, res); return res; } finally { inflight.delete(guild.id); } })();
  inflight.set(guild.id, f); return f.promise;
}
/** 調べている間、返事の「考え中」が、止まって見えないように、進み具合を、数秒おきに、書き換える。エラーは、メッセージにして返す */
export async function withProgress(i, promise, label = 'ピン留めを調べています') {
  const timer = setInterval(() => { const p = scanProgress(i.guildId); if (p?.total) i.editReply({ content: `🔎 ${label}… ${p.done} / ${p.total} チャンネル` }).catch(() => {}); }, 4000);
  try { return { ok: true, value: await promise }; }
  catch (e) { return { ok: false, error: e }; }
  finally { clearInterval(timer); }
}
export const pinsCommand = {
  data: new SlashCommandBuilder().setName('pins').setDescription('ピン留めの数を、調べます').setDMPermission(false)
    .addSubcommand((c) => c.setName('count').setDescription('チャンネル(スレッド)の、ピン留めの数と、内訳を調べます')
      .addChannelOption((o) => o.setName('channel').setDescription('調べるチャンネル(省略すると、ここ)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread))
      .addBooleanOption((o) => o.setName('public').setDescription('みんなに見せる(省略すると、自分だけ)')))
    .addSubcommand((c) => c.setName('scan').setDescription('【管理者向け】過去のピン留め(外した分も)を、全チャンネルの履歴から、数え始めます(時間がかかります)'))
    .addSubcommand((c) => c.setName('history').setDescription('過去のピン留めの集計(ピン留めした人・された人のランキング)と、調べの進み具合')
      .addBooleanOption((o) => o.setName('public').setDescription('みんなに見せる(省略すると、自分だけ)')))
    .addSubcommand((c) => c.setName('ranking').setDescription('サーバー全体で、ピン留めが多いチャンネルの順位(少し時間がかかります)')
      .addBooleanOption((o) => o.setName('refresh').setDescription('覚えている結果を捨てて、調べ直す'))
      .addBooleanOption((o) => o.setName('public').setDescription('みんなに見せる(省略すると、自分だけ)'))),
  async execute(i, deps = {}) {
    const vis = i.options.getBoolean('public') ? {} : EPH, sub = i.options.getSubcommand();
    if (sub === 'scan') {
      if (!hasAccessSync(i.guild, i.member, i.user.id)) return i.reply({ content: '調べを始められるのは、運営・サーバーのオーナー・管理者だけです。', ...EPH });
      if (!startPinScanFor(i, deps)) return i.reply({ content: 'すでに、調べています。進み具合は、`/pins history` で見られます。', ...EPH });
      return i.reply({ content: '🔎 過去のピン留めを、調べ始めました。チャンネルの一覧を集めてから、全チャンネルの履歴を読みます(メッセージが多いと、時間がかかります)。終わったら、このチャンネルに、お知らせします。(進み具合: `/pins history`)', ...EPH });
    }
    if (sub === 'history') {
      const st = scanState(i.guildId);
      if (!st) return i.reply({ content: 'まだ、調べていません。運営が `/pins scan` で、調べられます。', ...vis });
      if (st.status === 'running' && !isScanning(i.guildId)) return i.reply({ content: '前回の調べは、再起動などで、途中で止まりました。もう一度、`/pins scan` で、始められます。', ...vis });
      if (st.status === 'running') return i.reply({ content: `🔎 調べている途中です: ${st.done ?? 0} / ${st.total ?? '?'} チャンネル(見つけたピン留め ${st.found ?? 0}件)${st.current ? `\n-# いま: ${st.current}` : ''}`, ...vis });
      if (st.status === 'error') return i.reply({ content: `調べが、止まりました: ${st.error}。もう一度、\`/pins scan\` で、始められます。`, ...vis });
      const h = pinHistory(i.guildId); await i.deferReply(vis); const present = async (m) => onlyMembers(i.guild, [...m]); const [pn, tn] = [await present(h.byPinner), await present(h.byTarget)], top = (m) => [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, 10), M = ['🥇', '🥈', '🥉'];
      const e = new EmbedBuilder().setColor(0xe74c3c).setTitle('📌 過去のピン留め(外した分も)').setDescription(`合計 **${h.total}件**(${h.channels}チャンネルを調べました)`)
        .addFields({ name: 'ピン留めした人', value: top(pn).map(([u, n], k) => `${M[k] ?? `${k + 1}.`} <@${u}> — ${n}件`).join('\n') || 'なし', inline: true },
          { name: 'ピン留めされた発言の、発言者', value: top(tn).map(([u, n], k) => `${M[k] ?? `${k + 1}.`} <@${u}> — ${n}件`).join('\n') || 'なし', inline: true })
        .setFooter({ text: `${new Date(h.finishedAt).toLocaleDateString('ja-JP')}に調べた結果${h.unknownTargets ? ` ・ 発言者が不明: ${h.unknownTargets}件(発言が消されたなど)` : ''}` });
      return i.editReply({ embeds: [e], allowedMentions: { parse: [] } });
    }
    if (sub === 'count') {
      const target = i.options.getChannel('channel') ?? i.channel, ch = i.guild.channels.cache.get(target.id) ?? await i.guild.channels.fetch(target.id).catch(() => null);
      if (!ch?.messages || !canRead(ch, i.guild.members.me)) return i.reply({ content: 'そのチャンネルは、BOTが読めません。(「チャンネルを見る」と「メッセージ履歴を読む」の権限が必要です)', ...EPH });
      await i.deferReply(vis);
      let pins; try { pins = await (deps.fetchPins ?? fetchAllPins)(ch); } catch (e) { return i.editReply({ content: `調べられませんでした: ${e.message}` }); }
      const e = new EmbedBuilder().setColor(0xe74c3c).setTitle(`📌 #${ch.name} のピン留め`).setDescription(`**${pins.length}件**`);
      if (pins.length) {
        const by = new Map(); for (const p of pins) { const a = p.message.author?.id ?? '?'; by.set(a, (by.get(a) ?? 0) + 1); }
        const top = [...by].sort((a, b) => b[1] - a[1]).slice(0, 5);
        e.addFields({ name: '日付', value: `いちばん新しいピン: ${when(pins[0].pinnedTimestamp)}\nいちばん古いピン: ${when(pins.at(-1).pinnedTimestamp)}`, inline: true },
          { name: '発言した人(ピンの多い順)', value: top.map(([u, n]) => `<@${u}> — ${n}件`).join('\n'), inline: true },
          { name: '新しい10件', value: pins.slice(0, 10).map((p) => `[${(p.message.content || (p.message.embeds?.length ? '(埋め込み)' : p.message.attachments?.size ? '(添付)' : '(本文なし)')).replace(/\s+/g, ' ').slice(0, 40)}](${p.message.url}) — ${when(p.pinnedTimestamp)}`).join('\n') });
      }
      return i.editReply({ embeds: [e], allowedMentions: { parse: [] } });
    }
    // ranking
    await i.deferReply(vis);
    const r = await withProgress(i, cachedScan(i.guild, { refresh: !!i.options.getBoolean('refresh'), scan: deps.count ? (g, o) => countGuildPins(g, { ...o, fetchPins: deps.count }) : countGuildPins }));
    if (!r.ok) return i.editReply({ content: `調べられませんでした: ${r.error.message}` });
    const res = r.value;
    const total = res.rows.reduce((a, r) => a + r.count, 0), M = ['🥇', '🥈', '🥉'];
    const e = new EmbedBuilder().setColor(0xe74c3c).setTitle('📌 ピン留めの数(サーバー全体)').setDescription(`合計 **${total}件**(${res.rows.length}チャンネル)`)
      .addFields({ name: '多いチャンネル', value: res.rows.slice(0, 15).map((r, n) => `${M[n] ?? `${n + 1}.`} <#${r.id}> — **${r.count}件**`).join('\n') || 'ピン留めは、ありません。' })
      .setFooter({ text: `${res.scanned}チャンネルを調べました${res.failed ? ` ・ 読めなかった: ${res.failed}` : ''} ・ <t:${Math.floor(res.at / 1000)}:R> に調べた結果` });
    return i.editReply({ embeds: [e], allowedMentions: { parse: [] } });
  },
};

export default {
  name: 'pins',
  title: 'ピン留め',
  commands: [pinsCommand],
  help: '`/pins count` で、チャンネルのピン留めの数と内訳、`/pins ranking` で、サーバー全体の、ピン留めが多いチャンネルの順位を、調べられます。',
  ui: '/dashboard/features/pins.js',
  register({ router, client }) {
    client.on(Events.MessageCreate, (m) => { try { bumpPin(m); } catch { /* 足せなくても、次の「調べ直す」で、直る */ } });
    const names = async (g, map) => (await onlyMembers(g, [...map])).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, 20).map(([u, n]) => ({ user_id: u, name: g.members.cache.get(u).displayName, count: n })); // いない人は、消す
    // いまの状態: いまのピン留め(覚えている結果)・調べ中の進み具合・過去の集計
    router.get('/status', async (req, res) => {
      const g = req.guild, cur = cachedResult(g.id), prog = scanProgress(g.id), st = scanState(g.id), h = pinHistory(g.id);
      res.json({
        current: cur ? { at: cur.at, total: cur.rows.reduce((a, r) => a + r.count, 0), scanned: cur.scanned, failed: cur.failed, channels: cur.rows.slice(0, 20), users: await names(g, cur.byUser) } : null,
        refreshing: prog,
        history: { state: st ? { status: st.status === 'running' && !isScanning(g.id) ? 'stopped' : st.status, done: st.done, total: st.total, found: st.found, current: st.current, error: st.error, startedAt: st.startedAt, finishedAt: st.finishedAt } : null,
          result: h ? { total: h.total, channels: h.channels, unknown: h.unknownTargets, pinners: await names(g, h.byPinner), targets: await names(g, h.byTarget) } : null },
      });
    });
    // いまのピン留めを、調べ直す(裏で。結果は、/status で見る)
    router.post('/refresh', (req, res) => {
      if (scanProgress(req.guild.id)) return res.json({ started: false, running: true });
      cachedScan(req.guild, { refresh: true }).catch((e) => console.warn('[pins] 調べ直しに失敗:', e.message));
      res.json({ started: true });
    });
    // 過去のピン留めを、数え始める(運営・管理者のみ)
    router.post('/scan', (req, res) => {
      if (!canEditAccess(req.access)) return res.status(403).json({ error: '始められるのは、サーバーのオーナー・管理者・運営だけです' });
      const g = req.guild;
      const ok = startPinScanFor({ guildId: g.id, guild: g, channel: null }); // お知らせは、ダッシュボードの画面の、進み具合で見る
      res.json({ started: ok });
    });
  },
};
