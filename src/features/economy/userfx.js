import { activeStatuses, getPets } from './db.js';
import { shopById, itemFx } from './shop.js';
import { emptyFx, addFx } from './effects.js';
import { petFx, speciesOf } from './pets.js';
import { petCfg } from './balance.js';

/** そのユーザーに、いま効いている効果の合計(お店の品 + ペット)。オフの機能は、何も足さない */
export function userFx(s, g, u, now = Date.now()) {
  let fx = emptyFx();
  if (s.shopEnabled) for (const st of activeStatuses(g, u, now)) { const it = shopById(s, st.item); if (it) fx = addFx(fx, itemFx(it)); } // 品が削除されていたら、効かない
  if (s.petsEnabled) for (const pet of getPets(g, u)) fx = addFx(fx, petFx(pet, petCfg(s), speciesOf(s, pet.species), now)); // ペットのボーナス(何匹いても、全部足す。おなかがすいていると、なし)
  return fx;
}
