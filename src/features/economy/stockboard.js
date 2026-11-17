import { EmbedBuilder } from 'discord.js';
import { getKV } from '../../core/db.js';
import { postBoard as post, boardDue, updatedLine } from './board.js';
import { getSettings } from './settings.js';
import { marketNow } from './stockmarket.js';
import { companyOf, trendArrow } from './stocks.js';

export const BOARD_INTERVALS = [5, 10, 30, 60, 180, 360, 720, 1440]; // 分

/** 会社ひとつの、24時間の株価を、折れ線グラフにする画像のURL(Discordが、画像を取りに行く)。上がっていれば緑、下がっていれば赤。実際の株価で、縦軸は動きが大きく見えるように、最安〜最高に合わせる */
export function chartUrl(c, r) {
  const labels = r.spark.map((_, k) => (k === 23 ? 'now' : k % 6 === 0 ? `-${23 - k}h` : ''));
  const data = r.spark.map((v) => Math.max(1, Math.round(v))), up = r.change >= 0, col = up ? '#2ecc71' : '#e74c3c';
  const lo = Math.min(...data), hi = Math.max(...data), pad = Math.max(1, Math.round((hi - lo) * 0.15));
  const cfg = { type: 'line', data: { labels, datasets: [{ label: c.ticker, data, borderColor: col, backgroundColor: up ? 'rgba(46,204,113,0.15)' : 'rgba(231,76,60,0.15)', fill: true, pointRadius: 0, lineTension: 0.2 }] }, options: { legend: { display: false }, title: { display: true, text: `${c.ticker} ${c.name}` }, scales: { yAxes: [{ ticks: { min: Math.max(0, lo - pad), max: hi + pad } }] } } };
  return `https://quickchart.io/chart?bkg=%23ffffff&w=600&h=260&c=${encodeURIComponent(JSON.stringify(cfg))}`;
}

/** 株ごとのグラフ(会社ごとに、ひとつずつ。Discordの1通は、10個まで。会社が多いときは、最後の1つに、残りの値段だけを書く) */
export function boardEmbeds(s, g, now = Date.now()) {
  const rows = marketNow(s, g, now), cur = (x) => Math.max(1, Math.round(x)).toLocaleString();
  const line = (r) => { const c = companyOf(s, r.company), pct = r.change * 100; return `${c.emoji} **${c.ticker}** ${c.name} — **${cur(r.price)}** ${s.currencyEmoji} ${trendArrow(r.change)} ${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`; };
  const shown = rows.length > 10 ? rows.slice(0, 9) : rows, rest = rows.slice(shown.length);
  const embeds = shown.map((r, i) => {
    const c = companyOf(s, r.company), pct = r.change * 100;
    const e = new EmbedBuilder().setColor(r.change >= 0 ? 0x2ecc71 : 0xe74c3c).setImage(chartUrl(c, r))
      .setDescription(`${i === 0 ? updatedLine(now) + '\n\n' : ''}${line(r)}\n最高 **${cur(r.hi)}** ・ 最安 **${cur(r.lo)}**`);
    if (i === 0) e.setTitle('📈 株価ボード');
    if (i === shown.length - 1 && !rest.length) e.setFooter({ text: '24時間の値動き ・ 売買は /stock' });
    return e;
  });
  if (rest.length) embeds.push(new EmbedBuilder().setColor(0x3498db).setDescription(rest.map(line).join('\n')).setFooter({ text: '24時間の値動き ・ 売買は /stock' }));
  return embeds;
}

/** ボードを、決めたチャンネルの、一番下に出す。「最新だけ残す」なら、前のメッセージは書き換えるか、消す */
export async function postBoard(client, g, now = Date.now()) {
  const s = getSettings(g); if (!s.stocksEnabled || !s.stockChannelId) return false;
  return post(client, g, 'stock', s.stockChannelId, { embeds: boardEmbeds(s, g, now) }, { replace: s.stockBoardEdit, now });
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

/** 「一番下に出す」の対象(状態: board:stock)。出し直すのは、一番下になければ、消して出し直す */
export const stockStickItem = (client) => ({ kind: 'stock', prio: 20, state: (g) => (getSettings(g).stockBoardEdit ? getKV(g, 'board:stock', {}) : null), run: (g) => repostStock(client, g) });
/** チャンネルで誰かが話したあとの、出し直し(「一番下に出す」がオンのときだけ) */
export async function repostStock(client, g) { const s = getSettings(g); if (!s.stockBoardEdit) return false; return postBoard(client, g); }
