import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { messageRoles, fastestSinceJoin, pairStats, joinToStats, summarize, dur, periodText, trackingSince } from './roletime.js';

/**
 * ロール → ロール の達成時間ランキングの画面(`/roletime pair`・`fastest`)。
 * 「どこから」「どのロールまで」を、画面の中のメニューで、選び直せて、ページ送り・自分の順位へのジャンプもできる。
 * from = '0' は、「サーバーに入ってから」。対象は、会話数(発言数)で付与するロールだけ
 */
const PER = 10, MEDALS = ['🥇', '🥈', '🥉'];
const b36 = (n) => (n == null ? '-' : Number(n).toString(36)), unb36 = (s) => (s === '-' || s == null ? null : parseInt(s, 36));
const exists = (guild, id) => guild.roles.cache.has(id);

export function buildRankView(guild, { from = '0', to = null, page = 0, period = null, uid = null }) {
  const g = guild.id, roles = messageRoles(g).filter((r) => exists(guild, r.role_id)), ids = new Set(roles.map((r) => r.role_id));
  if (!roles.length) return { error: '会話数(発言数)で付与するロールの、ルールが、ありません。' };
  if (from !== '0' && !ids.has(from)) from = '0';
  if (!to || !ids.has(to)) to = roles.at(-1).role_id; // 決まっていなければ、いちばん上のロール
  const name = (id) => guild.roles.cache.get(id)?.name ?? '?', joinedOf = (u) => guild.members.cache.get(u)?.joinedTimestamp ?? null;
  let rows, stats;
  if (from === '0') { rows = fastestSinceJoin(g, to, joinedOf, 1e6, period); stats = joinToStats(g, to, joinedOf, period); }
  else if (from === to) { rows = []; stats = { n: 0 }; }
  else { const r = pairStats(g, from, to, 1e6, period); rows = r.fastest; stats = r; }
  const pages = Math.max(1, Math.ceil(rows.length / PER)), me = uid ? rows.findIndex((x) => x.user_id === uid) : -1;
  page = Math.min(Math.max(0, page), pages - 1);
  const slice = rows.slice(page * PER, page * PER + PER);
  const e = new EmbedBuilder().setColor(0xf1c40f).setTitle(`🏆 ${from === '0' ? 'サーバーに入ってから' : `「${name(from)}」から`} →「${name(to)}」`)
    .setDescription(from === to && from !== '0' ? '同じロールです。「どのロールまで」を、変えてください。' : slice.length ? slice.map((x, n) => { const rank = page * PER + n; return `${MEDALS[rank] ?? `${rank + 1}.`} <@${x.user_id}> — **${dur(x.ms)}**${x.user_id === uid ? ' ← あなた' : ''}`; }).join('\n') : '記録が、ありません。');
  if (stats.n) e.addFields({ name: `${stats.n}人の記録`, value: `平均 **${dur(stats.avg)}** ・ 中央値 **${dur(stats.median)}** ・ 最短 ${dur(stats.min)} ・ 最長 ${dur(stats.max)}` });
  if (me >= 0 && !slice.some((x) => x.user_id === uid)) e.addFields({ name: 'あなた', value: `**${me + 1}位** — ${dur(rows[me].ms)}(${rows.length}人中)` });
  const since = trackingSince(g);
  e.setFooter({ text: `${page + 1} / ${pages} ページ${periodText(period) ? ` ・ ${periodText(period)}(あとのロールを、取った時刻で)` : ''}${since ? '' : ' ・ 記録は、まだ、始まっていません'}` });
  const sb = b36(period?.since), ub = b36(period?.until);
  const fromSel = new StringSelectMenuBuilder().setCustomId(`roletime:f:${to}:${sb}:${ub}`).setPlaceholder('どこから').addOptions([{ label: 'サーバーに入ってから', value: '0', default: from === '0' }, ...roles.slice(0, 24).map((r) => ({ label: `${name(r.role_id)}(会話 ${r.threshold.toLocaleString()}回)`.slice(0, 100), value: r.role_id, default: from === r.role_id }))]);
  const toSel = new StringSelectMenuBuilder().setCustomId(`roletime:t:${from}:${sb}:${ub}`).setPlaceholder('どのロールまで').addOptions(roles.slice(0, 25).map((r) => ({ label: `${name(r.role_id)}(会話 ${r.threshold.toLocaleString()}回)`.slice(0, 100), value: r.role_id, default: to === r.role_id })));
  const btn = (action, label, p, disabled) => new ButtonBuilder().setCustomId(`roletime:${action}:${from}:${to}:${p}:${sb}:${ub}`).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled);
  const rowsC = [new ActionRowBuilder().addComponents(fromSel), new ActionRowBuilder().addComponents(toSel)];
  if (pages > 1 || me >= 0) rowsC.push(new ActionRowBuilder().addComponents(btn('p', '◀ 前', page - 1, page <= 0), btn('n', '次 ▶', page + 1, page >= pages - 1), btn('m', 'あなたの順位', me >= 0 ? Math.floor(me / PER) : 0, me < 0)));
  return { embeds: [e], components: rowsC, allowedMentions: { parse: [] } };
}

/** メニュー・ボタンの処理(customId: roletime:<f|t|p|n|m>:…) */
export const roletimeComponent = {
  id: 'roletime',
  async execute(i) {
    const [, act, a, b, c, d, e] = i.customId.split(':');
    let from, to, page = 0, sb, ub;
    if (act === 'f') { from = i.values[0]; to = a; sb = b; ub = c; }          // どこから を選んだ(to は、そのまま)
    else if (act === 't') { to = i.values[0]; from = a; sb = b; ub = c; }     // どのロールまで を選んだ
    else { from = a; to = b; page = Number(c) || 0; sb = d; ub = e; }          // ページ送り
    const view = buildRankView(i.guild, { from, to, page, period: { since: unb36(sb), until: unb36(ub) }, uid: i.user.id });
    return i.update(view.error ? { content: view.error, embeds: [], components: [] } : { content: '', ...view });
  },
};
