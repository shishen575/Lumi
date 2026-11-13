import { CRIMES } from './jobs.js';
import { HEISTS } from './heist.js';

/**
 * 闇マーケット: 犯罪・大型犯罪に必要な道具。1回の挑戦(成功でも失敗でも)で1つ消費する。
 * price は基本の値段。実際の値段は、日替わりの「闇相場」(0.8〜1.3倍)で少し変わる
 */
export const MAX_STACK = 99;
const TOOL = (id, kind, key, name, emoji, price, desc) => ({ id, kind, key, name, emoji, price, desc });
export const ITEMS = [
  TOOL('tool_convenience', 'crime', 'convenience', '手袋と覆面', '🧤', 50, 'コンビニ強盗に使う'),
  TOOL('tool_atm', 'crime', 'atm', '工具セット', '🔧', 100, 'ATM襲撃に使う'),
  TOOL('tool_jewel', 'crime', 'jewel', 'ガラスカッター', '🔦', 150, '宝石強盗に使う'),
  TOOL('tool_pirate', 'crime', 'pirate', '宝の地図', '🗺️', 150, '海賊に使う'),
  TOOL('tool_bank', 'crime', 'bank', '爆破キット', '💣', 200, '銀行強盗に使う'),
  TOOL('heist_armored', 'heist', 'armored', '偽の検問セット', '🚧', 800, '現金輸送車の襲撃に使う'),
  TOOL('heist_bank', 'heist', 'bank', '銀行の見取り図', '📋', 1500, '大型銀行強盗に使う'),
  TOOL('heist_museum', 'heist', 'museum', '忍び装束', '🥷', 2000, '美術館の名画に使う'),
  TOOL('heist_casino', 'heist', 'casino', '偽造IDとVIPパス', '🃏', 2500, 'カジノの金庫に使う'),
  TOOL('heist_vault', 'heist', 'vault', 'ハイテク装備', '🛰️', 6000, '国立宝物庫に使う'),
];
export const itemById = (id) => ITEMS.find((x) => x.id === id) ?? null;
/** その犯罪・強盗に必要な道具(なければ null) */
export const toolFor = (kind, key) => ITEMS.find((x) => x.kind === kind && x.key === key) ?? null;
// 道具と、犯罪・強盗の対応が、抜けていないか(開発時の確認用)
export const missingTools = () => [
  ...Object.keys(CRIMES).filter((k) => !toolFor('crime', k)).map((k) => `crime:${k}`),
  ...Object.keys(HEISTS).filter((k) => !toolFor('heist', k)).map((k) => `heist:${k}`),
];

/** 闇相場: サーバー・日・道具ごとに決まる倍率(0.8〜1.3)。同じ日は、同じ値段 */
export function marketRate(guildId, itemId, day = Math.floor(Date.now() / 86400000)) {
  let h = 2166136261;
  for (const ch of `${guildId}:${itemId}:${day}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return 0.8 + (h % 51) / 100; // 0.80 〜 1.30
}
export const priceOf = (guildId, item, day) => Math.max(1, Math.round(item.price * marketRate(guildId, item.id, day)));
