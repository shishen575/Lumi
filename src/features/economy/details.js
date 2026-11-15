import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getSettings, money } from './settings.js';
import { SLOTS, shopItems, itemText } from './shop.js';
import { ITEMS as MARKET_ITEMS, marketRate, priceOf, toolFor } from './market.js';
import { estateOf, hourlyNet } from './estate.js';
import { petsOpen, petList, bonusLabel, LEVEL_XP, MAX_LEVEL } from './pets.js';
import { COMPANIES, companyOf, VOL_LABELS } from './stocks.js';
import { CRIMES, JOBS } from './jobs.js';
import { HEISTS } from './heist.js';
import { crimeOf, jobOf, heistOf, itemOf, marketCfg, petCfg, estateCfg, stockCfg } from './balance.js';
import { allItems, activeStatuses, getPets, holding, stockHoldersAll, recentNews, estateCount } from './db.js';
import { marketNow, unitPrice } from './stockmarket.js';

/**
 * /detail: 品・闇市の道具・不動産・ペット・株(会社)・犯罪・バイト などの、1つについての、くわしい説明。
 * 名前は、入力しながら、候補から選べる(オートコンプリート)。候補を選ばず、名前の一部を打っても、見つかったものを出す
 */
const KINDS = { shop: 'お店の品', market: '闇市の道具', estate: '不動産', pet: 'ペット(動物)', stock: '株(会社)', crime: '犯罪・大型犯罪', job: 'バイト' };
const norm = (v) => String(v ?? '').normalize('NFKC').toLowerCase().trim();
const dur = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}` : `${m}分`; };

/** その種類の、選べるもの一覧: [{ id, label, hay }]。hay は、探すときの文字 */
export function choicesOf(kind, s) {
  if (kind === 'shop') return s.shopEnabled ? shopItems(s).map((x) => ({ id: x.id, label: `${x.emoji} ${x.name}`, hay: `${x.name} ${x.desc ?? ''}` })) : [];
  if (kind === 'market') return s.blackMarket ? MARKET_ITEMS.map((x) => ({ id: x.id, label: `${x.emoji} ${x.name}`, hay: `${x.name} ${x.desc}` })) : [];
  if (kind === 'estate') return s.estateEnabled ? estateOf(s).map((x) => ({ id: x.id, label: `${x.emoji} ${x.name}`, hay: `${x.name} ${x.desc ?? ''}` })) : [];
  if (kind === 'pet') return s.petsEnabled ? petList(s).map((x) => ({ id: x.id, label: `${x.emoji} ${x.name}${x.enabled ? '' : '(無効)'}`, hay: `${x.name} ${x.foodName}` })) : [];
  if (kind === 'stock') return s.stocksEnabled ? COMPANIES.map((c0) => { const c = companyOf(s, c0); return { id: c0.id, label: `${c.emoji} ${c.ticker} ${c.name}`, hay: `${c.ticker} ${c.name}` }; }) : [];
  if (kind === 'crime') return [...Object.entries(CRIMES).map(([k, c]) => ({ id: `c:${k}`, label: `${c.emoji} ${c.name}`, hay: c.name })), ...Object.values(HEISTS).map((T) => ({ id: `h:${T.id}`, label: `${T.emoji} ${T.name}(大型)`, hay: `${T.name} ${T.short ?? ''}` }))];
  if (kind === 'job') return Object.entries(JOBS).map(([k, j]) => ({ id: k, label: `${j.emoji} ${j.name}`, hay: j.name }));
  return [];
}
/** 入力された名前(候補の値、または、名前の一部)から、1つに決める */
export function resolve(kind, s, text) {
  const list = choicesOf(kind, s), t = norm(text);
  return list.find((x) => x.id === text) ?? list.find((x) => norm(x.label).replace(/^\S+\s/, '') === t) ?? list.find((x) => norm(x.label).includes(t) || norm(x.hay).includes(t)) ?? null;
}

function shopEmbed(s, g, u, id) {
  const it = shopItems(s).find((x) => x.id === id), own = allItems(g, u)[id] ?? 0, now = Date.now(), act = activeStatuses(g, u, now).find((x) => x.item === id);
  return new EmbedBuilder().setColor(0xb8860b).setTitle(`${it.emoji} ${it.name}`).setDescription(it.desc || null)
    .addFields({ name: '値段', value: money(s, it.price), inline: true }, { name: '効果の時間', value: `${it.minutes}分`, inline: true }, { name: '枠', value: `${SLOTS[it.slot]}(同じ枠の品は、同時に1つだけ効く)`, inline: true },
      { name: '効果', value: itemText(it) || '(効果なし)' }, { name: 'あなた', value: `持っている数 **${own}個**${act ? ` ・ 効果中(あと ${dur(act.until - now)})` : ''}`, inline: true }, { name: '使い方', value: '`/shop buy` で買って、`/use` で使います(お店パネルがあれば、ボタンから)', inline: true });
}
function marketEmbed(s, g, u, id) {
  const it = MARKET_ITEMS.find((x) => x.id === id), mc = marketCfg(s), rate = marketRate(g, it.id, undefined, mc.range), price = priceOf(g, itemOf(s, it), undefined, mc.range), own = allItems(g, u)[id] ?? 0;
  const use = it.kind === 'crime' ? `犯罪「${CRIMES[it.key]?.name}」` : `大型犯罪「${HEISTS[it.key]?.name}」`;
  return new EmbedBuilder().setColor(0x2b2d31).setTitle(`${it.emoji} ${it.name}(闇市)`).setDescription(it.desc)
    .addFields({ name: '今日の値段', value: `**${money(s, price)}** ${rate < 0.95 ? '📉 安い' : rate > 1.15 ? '📈 高い' : ''}`, inline: true }, { name: '基本の値段', value: money(s, itemOf(s, it).price), inline: true }, { name: '相場', value: `${Math.round(rate * 100)}%(毎日変わる)`, inline: true },
      { name: '使う場面', value: `${use}に、1回の挑戦で、1つ使う(成功でも失敗でも)` }, { name: 'あなた', value: `持っている数 **${own}個**(最大 ${mc.maxStack}個)` });
}
function estateEmbed(s, g, u, id) {
  const p = estateOf(s).find((x) => x.id === id), cfg = estateCfg(s), net = hourlyNet([{ count: 1, rent: p.rent, upkeep: p.upkeep }]), own = estateCount(g, u, id).count;
  const yieldDay = (net * 24 / p.price) * 100;
  return new EmbedBuilder().setColor(0x16a085).setTitle(`${p.emoji} ${p.name}`).setDescription(p.desc || null)
    .addFields({ name: '値段', value: money(s, p.price), inline: true }, { name: '家賃(1時間)', value: money(s, p.rent), inline: true }, { name: '維持費(1時間)', value: money(s, p.upkeep), inline: true },
      { name: '手取り(1時間)', value: `**${money(s, net)}**`, inline: true }, { name: '1日の利回り', value: `${yieldDay.toFixed(1)}%`, inline: true }, { name: '元を取るまで', value: net > 0 ? `約 ${(p.price / (net * 24)).toFixed(1)}日` : '(手取りなし)', inline: true },
      { name: '持てる数', value: `最大 ${p.maxOwn}件`, inline: true }, { name: 'ペット枠', value: p.petSlots && s.petsEnabled ? `1件につき +${p.petSlots}匹` : 'なし', inline: true }, { name: '売るとき', value: `買った値段の ${Math.round(cfg.sellPct * 100)}%`, inline: true }, { name: 'あなた', value: `持っている件数 **${own}件**`, inline: true });
}
function petEmbed(s, g, u, id) {
  const sp = petList(s).find((x) => x.id === id), pc = petCfg(s), mine = getPets(g, u).filter((p) => p.species === id).length;
  const lv = (n) => `Lv ${n}: ${bonusLabel(sp, pc.power, n)}`;
  return new EmbedBuilder().setColor(0xe67e22).setTitle(`${sp.emoji} ${sp.name}${sp.enabled ? '' : '(いま、新しくは飼えません)'}`)
    .addFields({ name: '飼う値段', value: money(s, sp.price), inline: true }, { name: '餌', value: `${sp.foodEmoji} ${sp.foodName}(${money(s, sp.feedCost)} ・ 満腹度 +${sp.feedHunger})`, inline: true }, { name: 'あなたが飼っている数', value: `${mine}匹`, inline: true },
      { name: 'ボーナス(レベルが上がるほど増える)', value: [1, 3, 5, MAX_LEVEL].map(lv).join('\n') }, { name: '育て方', value: `餌と遊びで、なつき度が上がる(Lv2=${LEVEL_XP[1]} / Lv5=${LEVEL_XP[4]} / Lv10=${LEVEL_XP[9]})。おなかがすく(満腹度 ${pc.minHunger} 未満)と、ボーナスは出ない` });
}
function stockEmbed(s, g, u, id) {
  const m = marketNow(s, g).find((x) => x.company.id === id), c = companyOf(s, m.company), px = unitPrice(m.price), cfg = stockCfg(s), mine = holding(g, u, id);
  const rows = stockHoldersAll(g).filter((r) => r.company === id), total = rows.reduce((a, r) => a + r.shares, 0), news = recentNews(g, id, 3);
  return new EmbedBuilder().setColor(0x2ecc71).setTitle(`${c.emoji} ${c.ticker} ${c.name}`).setDescription(m.company.blurb ?? null)
    .addFields({ name: '株価', value: `**${money(s, px)}** ${m.change > 0.0005 ? '🔺' : m.change < -0.0005 ? '🔻' : '➖'} ${(m.change * 100).toFixed(1)}%(24時間)`, inline: true }, { name: '24時間の高値・安値', value: `${unitPrice(m.hi).toLocaleString()} / ${unitPrice(m.lo).toLocaleString()}`, inline: true }, { name: '値動きの大きさ', value: `Lv ${m.level}(${VOL_LABELS[m.level - 1]})`, inline: true },
      { name: 'みんなの持ち株', value: `株主 ${rows.length}人 ・ 合計 ${total.toLocaleString()}株(時価 ${money(s, total * px)})`, inline: false }, { name: 'あなたの持ち株', value: mine.shares ? `**${mine.shares.toLocaleString()}株**(評価額 ${money(s, mine.shares * px)} ・ 取得 ${money(s, mine.cost)}${total ? ` ・ 割合 ${((mine.shares / total) * 100).toFixed(1)}%` : ''})` : '持っていません', inline: false },
      { name: '最近のニュース', value: news.length ? news.map((r) => `${r.up ? '📈' : '📉'} ${r.text}(<t:${r.tick * 60}:R>)`).join('\n') : 'まだ、ありません', inline: false }, { name: '売買', value: `手数料 ${(cfg.fee * 100).toFixed(1)}% ・ 最大 ${cfg.maxShares.toLocaleString()}株まで持てる`, inline: false });
}
function crimeEmbed(s, g, u, id) {
  const [k, key] = id.split(':');
  if (k === 'h') {
    const T = heistOf(s, key), tool = s.blackMarket ? toolFor('heist', key) : null;
    return new EmbedBuilder().setColor(0xe74c3c).setTitle(`${T.emoji} ${T.name}`).setDescription(`${T.blurb ?? ''}\n制限時間内に、すべての問題を解けば成功(ミニゲーム)`)
      .addFields({ name: '報酬', value: `${money(s, T.win[0])} 〜 ${money(s, T.win[1])}(速く解くと、最大 +${Math.round(T.speedBonus * 100)}%)`, inline: true }, { name: '問題の数', value: `${T.steps}問 ・ ${Math.round(T.timeMs / 1000)}秒`, inline: true }, { name: '間違えてよい回数', value: `${T.maxMistakes}回`, inline: true },
        { name: '失敗したとき', value: `罰金 ${money(s, T.fine[0])} 〜 ${money(s, T.fine[1])} ・ 留置場 ${Math.round(T.jail / 60000)}分`, inline: true }, { name: '待ち時間', value: dur(T.cd), inline: true }, { name: '必要な道具', value: tool ? `${tool.emoji} ${tool.name}(闇市)` : 'なし', inline: true });
  }
  const c = crimeOf(s, key), tool = s.blackMarket ? toolFor('crime', key) : null;
  return new EmbedBuilder().setColor(0xe74c3c).setTitle(`${c.emoji} ${c.name}`).setDescription('成功すると報酬、失敗すると罰金と留置場')
    .addFields({ name: '成功率', value: `${Math.round(c.chance * 100)}%(指名手配の星が多いと下がる)`, inline: true }, { name: '報酬', value: `${money(s, c.win[0])} 〜 ${money(s, c.win[1])}`, inline: true }, { name: '待ち時間', value: dur(c.cd), inline: true },
      { name: '失敗したとき', value: `罰金 ${money(s, c.fine[0])} 〜 ${money(s, c.fine[1])} ・ 留置場 ${Math.round(c.jail / 60000)}分`, inline: true }, { name: '必要な道具', value: tool ? `${tool.emoji} ${tool.name}(闇市)` : 'なし', inline: true });
}
function jobEmbed(s, g, u, id) {
  const j = jobOf(s, id);
  const e = new EmbedBuilder().setColor(0x3498db).setTitle(`${j.emoji} ${j.name}`).setDescription('`/work` で、バイトをして、給料をもらいます')
    .addFields({ name: '給料', value: `${money(s, j.pay[0])} 〜 ${money(s, j.pay[1])}`, inline: true }, { name: '待ち時間', value: dur(j.cd), inline: true });
  if (j.bonus) e.addFields({ name: 'ボーナス', value: `${Math.round(j.bonus.chance * 100)}%で、+ ${money(s, j.bonus.amount[0])} 〜 ${money(s, j.bonus.amount[1])}(${j.bonus.text})` });
  return e;
}
const BUILD = { shop: shopEmbed, market: marketEmbed, estate: estateEmbed, pet: petEmbed, stock: stockEmbed, crime: crimeEmbed, job: jobEmbed };

export const detailCommand = {
  data: new SlashCommandBuilder().setName('detail').setDescription('品・道具・不動産・ペット・株・犯罪などの、1つについての、くわしい説明を見ます').setDMPermission(false)
    .addStringOption((o) => o.setName('kind').setDescription('何を調べるか').setRequired(true).addChoices(...Object.entries(KINDS).map(([value, name]) => ({ name, value }))))
    .addStringOption((o) => o.setName('name').setDescription('名前(入力すると、候補が出ます。名前の一部でもOK)').setRequired(true).setAutocomplete(true))
    .addBooleanOption((o) => o.setName('public').setDescription('全員に表示する(省略すると自分だけ)')),
  /** 名前の入力中に、候補を出す(選んだ種類の中から、入力した文字を含むものを25個まで) */
  async autocomplete(i) {
    const s = getSettings(i.guildId), kind = i.options.getString('kind'), q = norm(i.options.getFocused());
    const list = s.enabled && kind ? choicesOf(kind, s).filter((x) => !q || norm(x.label).includes(q) || norm(x.hay).includes(q)) : [];
    await i.respond(list.slice(0, 25).map((x) => ({ name: x.label.slice(0, 100), value: x.id })));
  },
  async execute(i) {
    const s = getSettings(i.guildId), eph = i.options.getBoolean('public') ? {} : { flags: MessageFlags.Ephemeral };
    if (!s.enabled) return i.reply({ content: 'このサーバーでは、通貨は、オフです。', flags: MessageFlags.Ephemeral });
    const kind = i.options.getString('kind', true), text = i.options.getString('name', true);
    if (!choicesOf(kind, s).length && kind !== 'crime' && kind !== 'job') return i.reply({ content: `このサーバーでは、${KINDS[kind]}は、オフです。`, flags: MessageFlags.Ephemeral });
    const hit = resolve(kind, s, text);
    if (!hit) return i.reply({ content: `「${text}」は、見つかりませんでした。(${KINDS[kind]}の名前を、入力すると、候補が出ます)`, flags: MessageFlags.Ephemeral });
    const e = BUILD[kind](s, i.guildId, i.user.id, hit.id);
    return i.reply({ embeds: [e], ...eph });
  },
};
