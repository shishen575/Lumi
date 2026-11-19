import { allHoldings } from './db.js';
import { marketNow, unitPrice } from './stockmarket.js';
import { speciesOf } from './pets.js';
import { estateById } from './estate.js';

/**
 * 総資産ランキング: 現金(手持ち + 銀行)+ 株(いまの株価 × 株数)+ ペット(その動物の、いまの値段)+ 不動産(物件の、いまの値段 × 数)。
 * 戻り値: [{ user_id, cash, stocks, pets, estate, total }](多い順。0 の人は、除く)
 */
export function assetRanking(s, g, now = Date.now()) {
  const h = allHoldings(g, now), rows = new Map();
  const row = (u) => rows.get(u) ?? rows.set(u, { user_id: u, cash: 0, stocks: 0, pets: 0, estate: 0, total: 0 }).get(u);
  for (const a of h.accounts) row(a.user_id).cash += a.wallet + a.bank;
  if (s.stocksEnabled && h.stocks.length) {
    const price = new Map(marketNow(s, g, now).map((m) => [m.company.id, unitPrice(m.price)]));
    for (const x of h.stocks) row(x.user_id).stocks += (price.get(x.company) ?? 0) * x.shares;
  }
  if (s.petsEnabled) for (const p of h.pets) row(p.user_id).pets += speciesOf(s, p.species).price;
  if (s.estateEnabled) for (const e of h.estate) row(e.user_id).estate += (estateById(s, e.property)?.price ?? 0) * e.count;
  return [...rows.values()].map((r) => ({ ...r, total: r.cash + r.stocks + r.pets + r.estate })).filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
}
