import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits, ChannelType } from 'discord.js';
import { hasAccessSync } from '../../core/access.js';
import { collectTargets } from '../activity-roles/backfill.js';
import { startPinScan, scanState, pinHistory } from './history.js';

/**
 * ピン留めの数を、調べる。
 *  /pins count   … 1つのチャンネル(スレッド)の、ピン留めの数・いつ留めたか・だれの発言が多いか
 *  /pins ranking … サーバー全体で、ピン留めが多いチャンネルの順位(全部のチャンネルを、順に調べるので、少し時間がかかります)
 */
const EPH = { flags: MessageFlags.Ephemeral };
const CACHE_MS = 10 * 60_000, cache = new Map(); // ranking の結果を、10分、覚える(調べ直しで、Discordに負担をかけない)

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
/** サーバー内の、ピン留めの数を、チャンネルごとに数える(見られるチャンネルと、開いているスレッド)。結果は [{ id, name, count }](多い順)と、読めなかった数 */
export async function countGuildPins(guild, { fetchPins = fetchAllPins } = {}) {
  const me = guild.members.me, targets = [];
  for (const ch of guild.channels.cache.values()) if (ch.isTextBased?.() && !ch.isVoiceBased?.() && ch.messages && canRead(ch, me)) targets.push(ch);
  try { for (const th of (await guild.channels.fetchActiveThreads()).threads.values()) if (th.messages && canRead(th, me)) targets.push(th); } catch { /* スレッドは、読めなくても、続ける */ }
  const rows = [], byUser = new Map(); let failed = 0;
  for (const ch of new Map(targets.map((c) => [c.id, c])).values()) {
    try {
      const pins = await fetchPins(ch);
      if (pins.length) rows.push({ id: ch.id, name: ch.name, count: pins.length, thread: !!ch.isThread?.() });
      for (const p of pins) { const a = p.message.author; if (a && !a.bot) byUser.set(a.id, (byUser.get(a.id) ?? 0) + 1); } // ピン留めされた発言の、発言者ごとの数(BOTの発言は、除く)
    } catch { failed++; }
  }
  return { rows: rows.sort((a, b) => b.count - a.count), byUser, failed, scanned: targets.length };
}

const when = (ts) => `<t:${Math.floor(ts / 1000)}:D>`;
/** サーバー全体のピン留めの集計(10分、覚える)。/pins ranking と、/top の「ピン留めされた数」で、共有する */
export async function cachedScan(guild, { refresh = false, scan = countGuildPins } = {}) {
  const hit = cache.get(guild.id);
  if (hit && !refresh && Date.now() - hit.at < CACHE_MS) return hit;
  const res = { ...(await scan(guild)), at: Date.now() }; cache.set(guild.id, res); return res;
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
      .addBooleanOption((o) => o.setName('refresh').setDescription('10分以内でも、調べ直す'))
      .addBooleanOption((o) => o.setName('public').setDescription('みんなに見せる(省略すると、自分だけ)'))),
  async execute(i, deps = {}) {
    const vis = i.options.getBoolean('public') ? {} : EPH, sub = i.options.getSubcommand();
    if (sub === 'scan') {
      if (!hasAccessSync(i.guild, i.member, i.user.id)) return i.reply({ content: '調べを始められるのは、運営・サーバーのオーナー・管理者だけです。', ...EPH });
      await i.deferReply(EPH);
      const targets = await (deps.targets ?? collectTargets)(i.guild);
      const channel = i.channel;
      const ok = startPinScan(i.guild, targets, { notify: async (st) => { const h = pinHistory(i.guildId); await channel?.send?.({ content: st?.status === 'done' ? `✅ 過去のピン留めの集計が、終わりました(${h?.total ?? 0}件)。\`/pins history\` で見られます。\`/top metric:ピン留めされた数\` にも、入ります。` : `⚠️ ピン留めの集計が、止まりました: ${st?.error ?? '不明'}`, allowedMentions: { parse: [] } }); } });
      return i.editReply({ content: ok ? `🔎 過去のピン留めを、${targets.length}チャンネルの履歴から、数え始めました。メッセージが多いと、時間がかかります。終わったら、このチャンネルに、お知らせします。(進み具合: \`/pins history\`)` : 'すでに、調べています。進み具合は、`/pins history` で見られます。' });
    }
    if (sub === 'history') {
      const st = scanState(i.guildId);
      if (!st) return i.reply({ content: 'まだ、調べていません。運営が `/pins scan` で、調べられます。', ...vis });
      if (st.status === 'running') return i.reply({ content: `🔎 調べている途中です: ${st.done ?? 0} / ${st.total ?? '?'} チャンネル(見つけたピン留め ${st.found ?? 0}件)${st.current ? `\n-# いま: ${st.current}` : ''}`, ...vis });
      if (st.status === 'error') return i.reply({ content: `調べが、止まりました: ${st.error}。もう一度、\`/pins scan\` で、始められます。`, ...vis });
      const h = pinHistory(i.guildId), top = (m) => [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, 10), M = ['🥇', '🥈', '🥉'];
      const e = new EmbedBuilder().setColor(0xe74c3c).setTitle('📌 過去のピン留め(外した分も)').setDescription(`合計 **${h.total}件**(${h.channels}チャンネルを調べました)`)
        .addFields({ name: 'ピン留めした人', value: top(h.byPinner).map(([u, n], k) => `${M[k] ?? `${k + 1}.`} <@${u}> — ${n}件`).join('\n') || 'なし', inline: true },
          { name: 'ピン留めされた発言の、発言者', value: top(h.byTarget).map(([u, n], k) => `${M[k] ?? `${k + 1}.`} <@${u}> — ${n}件`).join('\n') || 'なし', inline: true })
        .setFooter({ text: `${new Date(h.finishedAt).toLocaleDateString('ja-JP')}に調べた結果${h.unknownTargets ? ` ・ 発言者が不明: ${h.unknownTargets}件(発言が消されたなど)` : ''}` });
      return i.reply({ embeds: [e], ...vis, allowedMentions: { parse: [] } });
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
    const res = await cachedScan(i.guild, { refresh: !!i.options.getBoolean('refresh'), scan: deps.count ? (g) => countGuildPins(g, { fetchPins: deps.count }) : countGuildPins });
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
  register() { /* コマンドだけ */ },
};
