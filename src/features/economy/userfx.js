import { activeStatuses } from './db.js';
import { shopById, itemFx } from './shop.js';
import { shopItemOf } from './balance.js';
import { emptyFx, addFx } from './effects.js';

/** そのユーザーに、いま効いている効果の合計(お店の消耗品。ペットは、あとで足す)。オフの機能は、何も足さない */
export function userFx(s, g, u, now = Date.now()) {
  let fx = emptyFx();
  if (s.shopEnabled) for (const st of activeStatuses(g, u, now)) { const it = shopById(st.item); if (it) fx = addFx(fx, itemFx(shopItemOf(s, it))); }
  return fx;
}
