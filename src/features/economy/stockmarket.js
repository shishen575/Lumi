import { COMPANIES, MAX_TICK_STEPS, KEEP_TICKS, nextPrice, eventAt } from './stocks.js';
import { lastStockRow, stockPriceAt, insertStockPrices } from './db.js';
import { stockCfg } from './balance.js';

const MIN = 60_000;
/**
 * いまの株価を、全部の会社ぶん返す。前回から時間がたっていれば、その間の株価を、順に計算して保存する(タイマー不要)。
 * 時刻は「分」で数える。株価が動く間隔(tickMin)ごとに、1回動く
 * 戻り値: [{ company, price, change(24時間前と比べた割合), news: [{ up, text, minutesAgo }] }]
 */
export function marketNow(s, g, now = Date.now()) {
  const cfg = stockCfg(s), step = Math.max(1, Math.round(cfg.tickMs / MIN)), nowMin = Math.floor(now / MIN);
  return COMPANIES.map((c) => {
    let last = lastStockRow(g, c.id);
    if (!last) { last = { tick: nowMin, price: c.base }; insertStockPrices(g, c.id, [last], nowMin - KEEP_TICKS * step); }
    let n = Math.floor((nowMin - last.tick) / step);
    if (n > 0) {
      const rows = []; let price = last.price, m = last.tick;
      if (n > MAX_TICK_STEPS) { m = last.tick + (n - MAX_TICK_STEPS) * step; n = MAX_TICK_STEPS; } // 長く見ていなかったときは、直近の分だけ計算する
      for (let j = 0; j < n; j++) { m += step; price = nextPrice(g, c, m, price, cfg.volScale); rows.push({ tick: m, price }); }
      insertStockPrices(g, c.id, rows, nowMin - KEEP_TICKS * step);
      last = rows.at(-1);
    }
    const day = stockPriceAt(g, c.id, nowMin - 1440) ?? last.price; // 24時間前の株価(なければ、いまの値)
    const news = [];
    for (let j = 0; j < 8; j++) { const m = last.tick - j * step, ev = eventAt(g, c.id, m); if (ev) news.push({ ...ev, minutesAgo: Math.max(0, nowMin - m) }); }
    return { company: c, price: last.price, change: last.price / day - 1, news };
  });
}
export const unitPrice = (price) => Math.max(1, Math.round(price));
