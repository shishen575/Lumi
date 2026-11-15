import { activeStatuses, getPet } from './db.js';
import { shopById, itemFx } from './shop.js';
import { emptyFx, addFx } from './effects.js';
import { petFx } from './pets.js';
import { petCfg } from './balance.js';

/** そのユーザーに、いま効いている効果の合計(お店の品 + ペット)。オフの機能は、何も足さない */
export function userFx(s, g, u, now = Date.now()) {
  let fx = emptyFx();
  if (s.shopEnabled) for (const st of activeStatuses(g, u, now)) { const it = shopById(s, st.item); if (it) fx = addFx(fx, itemFx(it)); } // 品が削除されていたら、効かない
  if (s.petsEnabled) fx = addFx(fx, petFx(getPet(g, u), petCfg(s), now)); // ペットのボーナス(おなかがすいていると、なし)
  return fx;
}
