import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits, ChannelType } from 'discord.js';
import { hasAccessSync, canEditAccess } from '../../core/access.js';
import { collectTargets } from '../activity-roles/backfill.js';
import { Events } from 'discord.js';
import { startPinScan, scanState, pinHistory, recordPin, markStarting, markFailed, isScanning } from './history.js';

/**
 * ピン留めの数を、調べる。
 *  /pins count   … 1つのチャンネル(スレッド)の、ピン留めの数・いつ留めたか・だれの発言が多いか
 *  /pins ranking … サーバー全体で、ピン留めが多いチャンネルの順位(全部のチャンネルを、順に調べるので、少し時間がかかります)
 */
const EPH = { flags: MessageFlags.Ephemeral };

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
export const pinsCommand = {
  data: new SlashCommandBuilder().setName('pins').setDescription('ピン留めの数を、調べます').setDMPermission(false)
    .addSubcommand((c) => c.setName('count').setDescription('チャンネル(スレッド)の、ピン留めの数と、内訳を調べます')
      .addChannelOption((o) => o.setName('channel').setDescription('調べるチャンネル(省略すると、ここ)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread))
      .addBooleanOption((o) => o.setName('public').setDescription('みんなに見せる(省略すると、自分だけ)')))
    .addSubcommand((c) => c.setName('scan').setDescription('【管理者向け】過去のピン留め(外した分も)を、全チャンネルの履歴から、数え始めます(時間がかかります)'))
    .addSubcommand((c) => c.setName('history').setDescription('過去のピン留めの集計(ピン留めした人・された人のランキング)と、調べの進み具合')
      .addBooleanOption((o) => o.setName('public').setDescription('みんなに見せる(省略すると、自分だけ)')))
    .addSubcommand((c) => c.setName('ranking').setDescription('サーバー全体で、ピン留めが多いチャンネルの順位(記録から)')
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
    // ranking: 記録(pin_log)から。サーバー全体を、探し直さない
    const h = pinHistory(i.guildId); if (!h?.total) return i.reply({ content: 'まだ、記録がありません。運営が `/pins scan` で、過去の分を、一度だけ数えると、使えます。(それ以降は、ピン留めされるたびに、足されます)', ...vis });
    const M = ['🥇', '🥈', '🥉'], list = [...h.byChannel].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, 15);
    const e = new EmbedBuilder().setColor(0xe74c3c).setTitle('📌 ピン留めが多いチャンネル(外した分も)').setDescription(`合計 **${h.total}件**`)
      .addFields({ name: '多いチャンネル', value: list.map(([c, n], k) => `${M[k] ?? `${k + 1}.`} <#${c}> — **${n}件**`).join('\n') })
      .setFooter({ text: h.partial ? '過去の分は、まだ数えていません(`/pins scan`)。いまからの分は、足されています' : 'ピン留めされるたびに、足されます' });
    return i.reply({ embeds: [e], ...vis, allowedMentions: { parse: [] } });
  },
};

export default {
  name: 'pins',
  title: 'ピン留め',
  commands: [pinsCommand],
  help: '`/pins count` で、チャンネルのピン留めの数と内訳、`/pins ranking` で、サーバー全体の、ピン留めが多いチャンネルの順位を、調べられます。',
  ui: '/dashboard/features/pins.js',
  register({ router, client }) {
    client.on(Events.MessageCreate, (m) => { try { recordPin(m); } catch (e) { console.warn('[pins] 記録に失敗:', e.message); } }); // ピン留めされたら、1件、足す
    const nameOf = async (g, id) => { const m = g.members.cache.get(id) ?? await g.members.fetch(id).catch(() => null); return m?.displayName ?? '(不明)'; };
    const names = (g, map) => Promise.all([...map].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, 20).map(async ([u, n]) => ({ user_id: u, name: await nameOf(g, u), count: n })));
    router.get('/status', async (req, res) => {
      const g = req.guild, st = scanState(g.id), h = pinHistory(g.id);
      res.json({
        state: st ? { status: st.status === 'running' && !isScanning(g.id) ? 'stopped' : st.status, done: st.done, total: st.total, found: st.found, current: st.current, error: st.error, startedAt: st.startedAt, finishedAt: st.finishedAt } : null,
        result: h ? { total: h.total, partial: h.partial, channels: [...h.byChannel].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id, n]) => ({ id, name: g.channels.cache.get(id)?.name ?? '(不明)', count: n })), unknown: h.unknownTargets, pinners: await names(g, h.byPinner), targets: await names(g, h.byTarget) } : null,
      });
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
