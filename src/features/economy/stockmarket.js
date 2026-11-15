import { COMPANIES, MAX_TICK_STEPS, KEEP_MINUTES, BASE_STEP, nextPrice, prevPrice, eventAt, DEFAULT_LEVELS } from './stocks.js';
import { addNews, lastStockRow, firstStockRow, stockPriceAt, stockRange, insertStockPrices } from './db.js';
import { stockCfg } from './balance.js';

const MIN = 60_000, BARS = '▁▂▃▄▅▆▇█';
/** 24時間の値動きを、1時間ごとの24個の点で、文字のグラフにする */
export const sparkline = (values) => { const lo = Math.min(...values), hi = Math.max(...values); return values.map((v) => BARS[hi === lo ? 3 : Math.round(((v - lo) / (hi - lo)) * 7)]).join(''); };

/**
 * いまの株価を、全部の会社ぶん返す。前回から時間がたっていれば、その間の株価を、順に計算して保存する(タイマー不要)。
 * 時刻は「分」で数える。株価が動く間隔(tickMin。既定5分)ごとに、1回動く。変動の大きさは、会社ごとの10段階(stockLevels)
 * 戻り値: [{ company, level, price, change(24時間前と比べた割合), hi, lo(24時間の最高・最安), spark(24時間のグラフ), news }]
 */
export function marketNow(s, g, now = Date.now()) {
  const cfg = stockCfg(s), step = Math.max(1, Math.round(cfg.tickMs / MIN)), nowMin = Math.floor(now / MIN), factor = step / BASE_STEP;
  const newsCfg = { rate: cfg.newsRate, events: s.newsEvents, every: s.newsEvery, step, power: s.newsPower / 100 }; // ニュースの設定(間隔・強さ)
  return COMPANIES.map((c) => {
    const level = s.stockLevels?.[c.id] ?? DEFAULT_LEVELS[c.id];
    let last = lastStockRow(g, c.id);
    if (!last) { last = { tick: nowMin, price: c.base }; insertStockPrices(g, c.id, [last], nowMin - KEEP_MINUTES); }
    let n = Math.floor((nowMin - last.tick) / step);
    if (n > 0) {
      const rows = []; let price = last.price, m = last.tick;
      if (n > MAX_TICK_STEPS) { m = last.tick + (n - MAX_TICK_STEPS) * step; n = MAX_TICK_STEPS; } // 長く見ていなかったときは、直近の分だけ計算する
      for (let j = 0; j < n; j++) {
        m += step; const before = price; price = nextPrice(g, c, m, price, { level, volScale: cfg.volScale, stepFactor: factor, news: newsCfg }); rows.push({ tick: m, price });
        const ev = eventAt(g, c.id, m, factor, newsCfg); if (ev && s.newsChannelId) addNews(g, c.id, m, ev.up, ev.text, before, price); // 新聞に出す、ニュースの記録
      }
      insertStockPrices(g, c.id, rows, nowMin - KEEP_MINUTES);
      last = rows.at(-1);
    }
    // 履歴が24時間に足りないとき(はじめて見たときなど)は、過去のぶんを、さかのぼって作る(グラフが、平らにならないように)
    const first = firstStockRow(g, c.id), target = nowMin - 1440;
    if (first && first.tick > target + step) {
      const rows = []; let price = first.price, m = first.tick;
      while (m - step >= target) { price = prevPrice(g, c, m, price, { level, volScale: cfg.volScale, stepFactor: factor, news: newsCfg }); m -= step; rows.push({ tick: m, price }); }
      insertStockPrices(g, c.id, rows, nowMin - KEEP_MINUTES);
    }
    const day = stockPriceAt(g, c.id, nowMin - 1440) ?? last.price; // 24時間前の株価(なければ、いまの値)
    const range = stockRange(g, c.id, nowMin - 1440);
    const spark = Array.from({ length: 24 }, (_, k) => stockPriceAt(g, c.id, nowMin - (23 - k) * 60) ?? last.price);
    const news = [];
    for (let j = 0; j < Math.ceil(30 / step); j++) { const m = last.tick - j * step, ev = eventAt(g, c.id, m, factor, newsCfg); if (ev) news.push({ ...ev, minutesAgo: Math.max(0, nowMin - m) }); } // 直近30分のニュース
    return { company: c, level, price: last.price, change: last.price / day - 1, hi: Math.max(range.hi ?? last.price, last.price), lo: Math.min(range.lo ?? last.price, last.price), spark, news };
  });
}
export const unitPrice = (price) => Math.max(1, Math.round(price));
