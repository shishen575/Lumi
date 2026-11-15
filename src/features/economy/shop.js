import { emptyFx, addFx, describeFx } from './effects.js';

/**
 * お店(タバコ・アルコール): 買って `/use` で使うと、しばらくの間、効果(良いことと、代償)がつく。
 * タバコとお酒は、別の枠(同時に効く)。同じ枠をもう一度使うと、上書きになる
 */
export const SHOP = [
  { id: 'shop_tobacco', slot: 'tobacco', name: 'タバコ', emoji: '🚬', price: 80, minutes: 15, power: 100,
    buff: { crimeChance: 0.03, ramenTime: 0.2 }, debuff: { workPay: -0.1 }, desc: '一服して集中。ヤニで、バイトの給料が少し下がる' },
  { id: 'shop_beer', slot: 'alcohol', name: 'ビール', emoji: '🍺', price: 120, minutes: 20, power: 100,
    buff: { crimeChance: 0.05 }, debuff: { heistTime: -0.1 }, desc: 'ほろ酔いで、気が大きくなる。判断が鈍って、大型犯罪の時間が短く感じる' },
  { id: 'shop_wine', slot: 'alcohol', name: 'ワイン', emoji: '🍷', price: 300, minutes: 30, power: 100,
    buff: { begAmount: 0.3 }, debuff: { crimeChance: -0.02 }, desc: '上機嫌で、愛想が良くなる。ただし、悪事は、少し苦手になる' },
  { id: 'shop_whisky', slot: 'alcohol', name: 'ウイスキー', emoji: '🥃', price: 500, minutes: 30, power: 100,
    buff: { crimeChance: 0.1 }, debuff: { fineMult: 0.5, heistMistakes: -1 }, desc: '泥酔で、怖いものなし。失敗すると、罰金が重く、大型犯罪では、ミスが許されない' },
];
export const shopById = (id) => SHOP.find((x) => x.id === id) ?? null;
export const SHOP_MAX_STACK = 99;
/** その品の、効果(良いことと代償を合わせたもの)。power(%)で、強さを変えられる */
export const itemFx = (item) => addFx(addFx(emptyFx(), item.buff, item.power / 100), item.debuff, item.power / 100);
export const itemText = (item) => `${describeFx(item.buff && addFx(emptyFx(), item.buff, item.power / 100))}${item.debuff ? ` ／ 代償: ${describeFx(addFx(emptyFx(), item.debuff, item.power / 100))}` : ''}`;
