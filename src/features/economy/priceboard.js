import { EmbedBuilder } from 'discord.js';
import { getSettings, money } from './settings.js';
import { postBoard as post, boardDue, updatedLine } from './board.js';
import { petsOpen, bonusLabel } from './pets.js';
import { estateOf, hourlyNet } from './estate.js';
import { ITEMS, marketRate, priceOf } from './market.js';
import { itemOf, marketCfg, petCfg } from './balance.js';

export const PRICE_INTERVALS = [5, 10, 30, 60, 180, 360, 720, 1440];
const cut = (t, n = 4000) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** 値段表: ペット・不動産・闇市の、いまの値段(オンになっているものだけ) */
export function priceEmbeds(s, g, now = Date.now()) {
  const out = [], m = (n) => money(s, n);
  if (s.petsEnabled) {
    const pc = petCfg(s), list = petsOpen(s);
    if (list.length) out.push(new EmbedBuilder().setColor(0xe67e22).setTitle('🐾 ペット').setDescription(cut(list.map((x) => `${x.emoji} **${x.name}** ${m(x.price)} ・ 餌 ${x.foodEmoji}${x.foodName} ${m(x.feedCost)}\n-# ${bonusLabel(x, pc.power)} / レベル`).join('\n')))
      .setFooter({ text: `最初から ${pc.baseSlots}匹まで。不動産を買うと、飼える数が増えます` }));
  }
  if (s.estateEnabled) {
    const list = estateOf(s);
    if (list.length) out.push(new EmbedBuilder().setColor(0x16a085).setTitle('🏢 不動産').setDescription(cut(list.map((p) => `${p.emoji} **${p.name}** ${m(p.price)} ・ 家賃 ${m(p.rent)}/時 − 維持費 ${m(p.upkeep)} = **${m(hourlyNet([{ count: 1, rent: p.rent, upkeep: p.upkeep }]))}/時**${p.petSlots && s.petsEnabled ? ` ・ 🐾+${p.petSlots}` : ''}\n-# 最大 ${p.maxOwn}件`).join('\n'))));
  }
  if (s.blackMarket) {
    const mc = marketCfg(s), line = (x) => { const r = marketRate(g, x.id, undefined, mc.range); return `${x.emoji} **${x.name}** ${m(priceOf(g, itemOf(s, x), undefined, mc.range))} ${r < 0.95 ? '📉' : r > 1.15 ? '📈' : ''}`; };
    out.push(new EmbedBuilder().setColor(0x2b2d31).setTitle('🕶️ 闇市(今日の相場)').setDescription(`**犯罪**\n${ITEMS.filter((x) => x.kind === 'crime').map(line).join('\n')}\n\n**大型犯罪**\n${ITEMS.filter((x) => x.kind === 'heist').map(line).join('\n')}`).setFooter({ text: '値段は、毎日少し変わります(📉 安い / 📈 高い)' }));
  }
  if (out.length) out[0].setDescription(`${updatedLine(now)}\n${out[0].data.description}`);
  return out;
}

export async function postPriceBoard(client, g, now = Date.now()) {
  const s = getSettings(g); if (!s.priceChannelId) return false;
  const embeds = priceEmbeds(s, g, now); if (!embeds.length) return false;
  return post(client, g, 'price', s.priceChannelId, { embeds }, { replace: s.priceBoardReplace, now });
}
export async function priceTick(client, now = Date.now()) {
  for (const g of client.guilds.cache.keys()) {
    try { const s = getSettings(g); if (!s.priceChannelId || !boardDue(g, 'price', s.priceBoardMin, now)) continue; await postPriceBoard(client, g, now); }
    catch (e) { console.error(`[priceboard] 失敗 (${g}):`, e.message); }
  }
}

export async function repostPrice(client, g) { const s = getSettings(g); if (!s.priceBoardReplace) return false; return postPriceBoard(client, g); }
