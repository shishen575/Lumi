import { chanOf } from '../../core/channels.js';
import { EmbedBuilder } from 'discord.js';
import { getSettings, money } from './settings.js';
import { marketNow } from './stockmarket.js';
import { takeNews } from './db.js';
import { companiesOf, companyOf } from './stocks.js';

const MIN = 60_000;
/** ニュース1件の記事(埋め込み): 会社・見出し・株価の変化 */
export function newsEmbed(s, n) {
  const c0 = companiesOf(s).find((x) => x.id === n.company), c = c0 ? companyOf(s, c0) : { name: n.company, ticker: '', emoji: '📰' };
  const pct = (n.after_px / n.before_px - 1) * 100, up = !!n.up, px = (v) => Math.max(1, Math.round(v)).toLocaleString();
  return new EmbedBuilder().setColor(up ? 0x2ecc71 : 0xe74c3c).setTitle(`${up ? '📈' : '📉'} ${c.emoji} ${c.name}${c.ticker ? `(${c.ticker})` : ''}`)
    .setDescription(`**${n.text}**\n株価 ${s.currencyEmoji} ${px(n.before_px)} → **${px(n.after_px)}** ${up ? '🔺' : '🔻'} ${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`)
    .setTimestamp(n.tick * MIN);
}
/** 新聞チャンネルに、株のニュースを出す(1分ごと)。止まっていた間の古いニュース(3時間より前)は、出さない */
export async function newspaperTick(client, now = Date.now()) {
  for (const g of client.guilds.cache.keys()) {
    try {
      const s = getSettings(g); if (!s.stocksEnabled || !s.newsChannelId) continue;
      marketNow(s, g, now); // 株価を、いままで進める(その間に起きたニュースが記録される)
      const rows = takeNews(g, Math.floor(now / MIN) - 180); if (!rows.length) continue;
      const ch = (await chanOf(client, s.newsChannelId)); if (!ch?.isTextBased?.() || ch.guildId !== g) continue;
      for (let i = 0; i < rows.length; i += 10) await ch.send({ content: i === 0 ? '📰 **ルミ新聞 号外**' : undefined, embeds: rows.slice(i, i + 10).map((r) => newsEmbed(s, r)), allowedMentions: { parse: [] } }).catch((e) => console.warn(`[newspaper] 送れませんでした (${g}): ${e.message}`));
    } catch (e) { console.error(`[newspaper] 失敗 (${g}):`, e.message); }
  }
}
