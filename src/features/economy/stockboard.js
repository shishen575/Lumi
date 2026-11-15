import { EmbedBuilder } from 'discord.js';
import { postBoard as post, boardDue } from './board.js';
import { getSettings } from './settings.js';
import { marketNow } from './stockmarket.js';
import { companyOf, trendArrow } from './stocks.js';

const COLORS = ['#f1c40f', '#e67e22', '#2ecc71', '#3498db', '#9b59b6', '#e74c3c', '#1abc9c', '#95a5a6'];
export const BOARD_INTERVALS = [5, 10, 30, 60, 180, 360, 720, 1440]; // 分

/** 24時間の株価を、折れ線グラフにする画像のURL(Discordが、画像を取りに行く)。会社ごとに値段が違うので、24時間前を100とした指数にする */
export function chartUrl(s, rows) {
  const idx = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 23]; // 1時間ごとの24点から、13点だけ使う(URLを短くするため。Discordの上限は2048文字)
  const labels = idx.map((k) => (k === 23 ? 'now' : `-${23 - k}h`));
  const datasets = rows.map((r, i) => { const c = companyOf(s, r.company), base = r.spark[0] || 1; return { label: c.ticker, data: idx.map((k) => Math.round((r.spark[k] / base) * 100)), borderColor: COLORS[i % COLORS.length], fill: false, pointRadius: 0 }; });
  const all = datasets.flatMap((d) => d.data), lo = Math.floor(Math.min(...all) / 5) * 5 - 5, hi = Math.ceil(Math.max(...all) / 5) * 5 + 5; // 0 から始めず、動きが大きく見えるように
  const cfg = { type: 'line', data: { labels, datasets }, options: { scales: { yAxes: [{ ticks: { min: lo, max: hi } }] } } };
  return `https://quickchart.io/chart?bkg=%23ffffff&w=700&h=350&c=${encodeURIComponent(JSON.stringify(cfg))}`;
}

export function boardEmbed(s, g, now = Date.now()) {
  const rows = marketNow(s, g, now);
  const e = new EmbedBuilder().setColor(0x3498db).setTitle('📈 株価ボード').setTimestamp(now).setImage(chartUrl(s, rows))
    .setDescription(rows.map((r) => { const c = companyOf(s, r.company), pct = r.change * 100; return `${c.emoji} **${c.ticker}** ${c.name} — **${Math.max(1, Math.round(r.price)).toLocaleString()}** ${s.currencyEmoji} ${trendArrow(r.change)} ${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`; }).join('\n'))
    .setFooter({ text: '24時間の値動き ・ 売買は /stock' });
  return e;
}

/** ボードを、決めたチャンネルの、一番下に出す。「最新だけ残す」なら、前のメッセージは書き換えるか、消す */
export async function postBoard(client, g, now = Date.now()) {
  const s = getSettings(g); if (!s.stocksEnabled || !s.stockChannelId) return false;
  return post(client, g, 'stock', s.stockChannelId, { embeds: [boardEmbed(s, g, now)] }, { replace: s.stockBoardEdit, now });
}

/** 1分ごとに呼ぶ。出す間隔(分)がたったサーバーのボードを出す */
export async function boardTick(client, now = Date.now()) {
  for (const g of client.guilds.cache.keys()) {
    try {
      const s = getSettings(g); if (!s.stocksEnabled || !s.stockChannelId || !boardDue(g, 'stock', s.stockBoardMin, now)) continue;
      await postBoard(client, g, now);
    } catch (e) { console.error(`[stockboard] 失敗 (${g}):`, e.message); }
  }
}
