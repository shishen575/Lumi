import { EmbedBuilder } from 'discord.js';
import { getKV, setKV } from '../../core/db.js';
import { getSettings } from './settings.js';
import { marketNow } from './stockmarket.js';
import { companyOf } from './stocks.js';

const COLORS = ['#f1c40f', '#e67e22', '#2ecc71', '#3498db', '#9b59b6', '#e74c3c', '#1abc9c', '#95a5a6'];
export const BOARD_INTERVALS = [10, 30, 60, 180, 360, 720, 1440]; // 分

/** 24時間の株価を、折れ線グラフにする画像のURL(Discordが、画像を取りに行く)。会社ごとに値段が違うので、24時間前を100とした指数にする */
export function chartUrl(s, rows) {
  const idx = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 23]; // 1時間ごとの24点から、13点だけ使う(URLを短くするため。Discordの上限は2048文字)
  const labels = idx.map((k) => (k === 23 ? 'now' : `-${23 - k}h`));
  const datasets = rows.map((r, i) => { const c = companyOf(s, r.company), base = r.spark[0] || 1; return { label: c.ticker, data: idx.map((k) => Math.round((r.spark[k] / base) * 100)), borderColor: COLORS[i % COLORS.length], fill: false, pointRadius: 0 }; });
  const cfg = { type: 'line', data: { labels, datasets } };
  return `https://quickchart.io/chart?bkg=%23ffffff&w=700&h=350&c=${encodeURIComponent(JSON.stringify(cfg))}`;
}

export function boardEmbed(s, g, now = Date.now()) {
  const rows = marketNow(s, g, now);
  const e = new EmbedBuilder().setColor(0x3498db).setTitle('📈 株価ボード').setTimestamp(now).setImage(chartUrl(s, rows))
    .setDescription(rows.map((r) => { const c = companyOf(s, r.company), pct = r.change * 100; return `${c.emoji} **${c.ticker}** ${c.name} — **${Math.max(1, Math.round(r.price)).toLocaleString()}** ${s.currencyEmoji} (${pct >= 0 ? '▲' : '▼'}${Math.abs(pct).toFixed(1)}%)`; }).join('\n'))
    .setFooter({ text: '24時間の値動き ・ 売買は /stock' });
  return e;
}

/** ボードを、決めたチャンネルに出す。「1つのメッセージを更新」なら、前のメッセージを書き換える */
export async function postBoard(client, g, now = Date.now()) {
  const s = getSettings(g); if (!s.stocksEnabled || !s.stockChannelId) return false;
  const ch = client.channels.cache.get(s.stockChannelId); if (!ch?.isTextBased?.() || ch.guildId !== g) return false;
  const st = getKV(g, 'stockboard', {}), embeds = [boardEmbed(s, g, now)];
  try {
    if (s.stockBoardEdit && st.msg && st.ch === ch.id) { try { const m = await ch.messages.fetch(st.msg); await m.edit({ embeds }); setKV(g, 'stockboard', { ...st, at: now }); return true; } catch { /* 消されていたら、新しく出す */ } }
    const m = await ch.send({ embeds, allowedMentions: { parse: [] } });
    setKV(g, 'stockboard', { ch: ch.id, msg: m.id, at: now }); return true;
  } catch (e) { console.warn(`[stockboard] 送れませんでした (${g}): ${e.message}`); return false; }
}

/** 1分ごとに呼ぶ。出す間隔(分)がたったサーバーのボードを出す */
export async function boardTick(client, now = Date.now()) {
  for (const g of client.guilds.cache.keys()) {
    try {
      const s = getSettings(g); if (!s.stocksEnabled || !s.stockChannelId) continue;
      const st = getKV(g, 'stockboard', {});
      if (st.at && now - st.at < s.stockBoardMin * 60_000 - 5_000) continue;
      await postBoard(client, g, now);
    } catch (e) { console.error(`[stockboard] 失敗 (${g}):`, e.message); }
  }
}
