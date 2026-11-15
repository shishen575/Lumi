/**
 * 不動産: 物件を買って、家賃(収入)を受け取る。家賃は、時間とともに溜まり、`/estate collect` で受け取る(溜まる上限あり)。
 * 物件の名前・絵文字・値段・家賃・維持費は、サーバーごとに、自由に変えられる(追加・削除もできる)。
 * 売るときは、買った値段の何割かで引き取られる(既定80%)
 */
export const MAX_PROPERTIES = 10;
export const MAX_OWNED = 20; // 1つの物件を持てる数の上限(既定)
// 家賃・維持費は「1時間あたり」。1日の利回り(家賃 − 維持費)は、どれも 6% 前後(元を取るまで、約2週間)
export const DEFAULT_ESTATE = [
  { id: 'est_room', name: 'ワンルーム', emoji: '🏠', price: 20000, rent: 60, upkeep: 10, maxOwn: 10, desc: '手ごろな一人暮らし向け' },
  { id: 'est_apt', name: 'アパート', emoji: '🏘️', price: 80000, rent: 250, upkeep: 40, maxOwn: 5, desc: '何部屋かの、小さな賃貸' },
  { id: 'est_shop', name: '商店街の店舗', emoji: '🏪', price: 200000, rent: 650, upkeep: 120, maxOwn: 3, desc: '人通りの多い、お店向きの物件' },
  { id: 'est_mansion', name: 'マンション', emoji: '🏢', price: 600000, rent: 2000, upkeep: 400, maxOwn: 2, desc: '家賃が高い、人気の物件' },
  { id: 'est_building', name: 'オフィスビル', emoji: '🏙️', price: 2000000, rent: 7000, upkeep: 1800, maxOwn: 1, desc: '街のシンボル。大きな収入' },
];
const clean = (x, n) => String(x ?? '').replace(/[\r\n<>@`*_~|]/g, '').trim().slice(0, n);
const int = (v, lo, hi, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
/** 物件のリストを、正しい形に直す(最大10件)。空のリストや不正な入力は、いまのまま */
export function sanitizeEstate(input, current = DEFAULT_ESTATE) {
  if (!Array.isArray(input)) return current;
  const out = [], used = new Set();
  for (const raw of input.filter((x) => clean(x?.name, 12)).slice(0, MAX_PROPERTIES)) {
    let id = /^est_[a-z0-9]{1,12}$/.test(String(raw?.id ?? '')) ? raw.id : null;
    if (!id || used.has(id)) { let n = 1; while (used.has(`est_n${n}`)) n++; id = `est_n${n}`; }
    used.add(id);
    out.push({ id, name: clean(raw.name, 12), emoji: [...clean(raw?.emoji, 8)].slice(0, 2).join('') || '🏠', price: int(raw?.price, 1, 1e10, 10000), rent: int(raw?.rent, 0, 1e9, 100), upkeep: int(raw?.upkeep, 0, 1e9, 0), maxOwn: int(raw?.maxOwn, 1, MAX_OWNED, 5), desc: clean(raw?.desc, 60) });
  }
  return out.length ? out : current;
}
export const estateOf = (s) => s.estate ?? DEFAULT_ESTATE;
export const estateById = (s, id) => estateOf(s).find((x) => x.id === id) ?? null;
/** 1時間あたりの、手取りの家賃(物件ごとに、家賃 − 維持費。マイナスにはしない)。items: [{ count, rent, upkeep }] */
export const hourlyNet = (items) => items.reduce((a, it) => a + Math.max(0, it.count * (it.rent - it.upkeep)), 0);
/** 溜まった家賃: 前回(lastAt)から now までの時間(上限 capHours)ぶん */
export function accrued(items, lastAt, now, capHours) {
  const hours = Math.max(0, Math.min(capHours, (now - lastAt) / 3600_000));
  return Math.floor(hourlyNet(items) * hours);
}
