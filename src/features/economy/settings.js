import { getKV, setKV } from '../../core/db.js';
import { DEFAULT_RANKS, sanitizeRanks } from './ranks.js';
import { sanitizeBalance } from './balance.js';
import { DEFAULT_NAMES, sanitizeNames, DEFAULT_LEVELS, sanitizeLevels } from './stocks.js';
import { DEFAULT_SHOP, sanitizeShopItems } from './shop.js';
import { DEFAULT_LOTTERY, sanitizeLotteries } from './lottery.js';

// サーバーごとの設定。既定はオフ(管理者がダッシュボードでオンにする)
export const DEFAULTS = {
  enabled: false, currencyName: 'コイン', currencyEmoji: '🪙', startBalance: 1000, maxBet: 100000,
  payoutRate: 95,        // ギャンブルの還元率(%)。賭け金に対して、平均でどれだけ戻るか(50〜150)
  budgetEnabled: false,  // サーバーの予算を使うか。オンのとき、報酬・配当は予算から支払われ、罰金・負けは予算に入る
  blackMarket: false,    // 闇マーケット。オンのとき、犯罪・大型犯罪に「道具」が必要になり、/market で買える(オフなら、道具なしでできる)
  promotionEnabled: false, // 職業の昇進。オンのとき、出勤回数に応じて階級が上がり、給料が増える
  jobRanks: DEFAULT_RANKS, // 職業ごとの階級(名前・必要な出勤回数・給料の倍率%)
  wantedEnabled: false,    // 指名手配。オンのとき、犯罪で手配度が溜まり、警察が逮捕できる
  wantedDecayMin: 30,      // 手配度が1下がるまでの時間(分)
  bountyPerStar: 1000,     // 星1つぶんの懸賞金
  policeBonusPerWanted: 5, // 指名手配中の人が1人いるごとに、警察のバイトのボーナス確率が上がる量(%)
  arrestMinShifts: 5,      // /arrest を使うのに必要な、警察のバイトの出勤回数
  balance: {},             // ゲームバランスの上書き({ キー: 数値 })。ダッシュボードの「ゲームバランス」で変える。なければ初期値
  stocksEnabled: false,    // 株。オンのとき、/stock が使える
  stockLevels: DEFAULT_LEVELS, // 会社ごとの変動の大きさ(1〜10の10段階)
  stockNames: DEFAULT_NAMES, // 会社の名前・ティッカー・絵文字(サーバーごとに変えられる)
  lotteryEnabled: false,   // 宝くじ。オンのとき、/lottery が使え、決まった時刻に、自動で抽選する
  lotteries: [DEFAULT_LOTTERY], // くじの一覧(サーバーごとに、自由に、最大6つ。名前・値段・間隔・桁数・賞金などを変えられる)
  lotteryChannelId: null,  // 抽選の結果を発表するチャンネル(くじごとに、別のチャンネルも選べる)
  petsEnabled: false,      // ペット。オンのとき、/pet が使え、育てるとボーナスがつく
  shopItems: DEFAULT_SHOP, // お店の品(名前・値段・効果などを、サーバーごとに変えられる)
  shopEnabled: false,      // お店(タバコ・お酒)。オンのとき、/shop と /use が使える
  allowDebt: true,       // 借金を許可するか。許可すると、罰金などで、所持金が0より下になる(0以下の間は、犯罪ができない)
};
const clamp = (v, lo, hi, def) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };

export const getSettings = (guildId) => {
  const s = { ...DEFAULTS, ...getKV(guildId, 'economy', {}) };
  s.stockNames = { ...DEFAULT_NAMES, ...s.stockNames };
  s.stockLevels = { ...DEFAULT_LEVELS, ...s.stockLevels };
  s.jobRanks = { ...DEFAULT_RANKS, ...s.jobRanks }; // あとから増えた職業(ラーメン屋など)の階級は、初期値で補う
  return s;
};
export function saveSettings(guildId, s) {
  const cur = getSettings(guildId);
  const next = {
    enabled: s.enabled === undefined ? cur.enabled : !!s.enabled,
    currencyName: s.currencyName === undefined ? cur.currencyName : (String(s.currencyName).trim().slice(0, 10) || DEFAULTS.currencyName),
    currencyEmoji: s.currencyEmoji === undefined ? cur.currencyEmoji : (String(s.currencyEmoji).trim().slice(0, 40) || DEFAULTS.currencyEmoji),
    startBalance: s.startBalance === undefined ? cur.startBalance : clamp(s.startBalance, 0, 1_000_000, DEFAULTS.startBalance),
    maxBet: s.maxBet === undefined ? cur.maxBet : clamp(s.maxBet, 10, 1_000_000_000, DEFAULTS.maxBet),
    payoutRate: s.payoutRate === undefined ? cur.payoutRate : clamp(s.payoutRate, 50, 150, DEFAULTS.payoutRate),
    budgetEnabled: s.budgetEnabled === undefined ? cur.budgetEnabled : !!s.budgetEnabled,
    allowDebt: s.allowDebt === undefined ? cur.allowDebt : !!s.allowDebt,
    shopEnabled: s.shopEnabled === undefined ? cur.shopEnabled : !!s.shopEnabled,
    shopItems: s.shopItems === undefined ? cur.shopItems : sanitizeShopItems(s.shopItems, cur.shopItems),
    petsEnabled: s.petsEnabled === undefined ? cur.petsEnabled : !!s.petsEnabled,
    lotteryEnabled: s.lotteryEnabled === undefined ? cur.lotteryEnabled : !!s.lotteryEnabled,
    lotteries: s.lotteries === undefined ? cur.lotteries : sanitizeLotteries(s.lotteries, cur.lotteries),
    lotteryChannelId: s.lotteryChannelId === undefined ? cur.lotteryChannelId : (/^\d{15,25}$/.test(String(s.lotteryChannelId ?? '')) ? String(s.lotteryChannelId) : null),
    stocksEnabled: s.stocksEnabled === undefined ? cur.stocksEnabled : !!s.stocksEnabled,
    stockNames: s.stockNames === undefined ? cur.stockNames : sanitizeNames(s.stockNames, cur.stockNames),
    stockLevels: s.stockLevels === undefined ? cur.stockLevels : sanitizeLevels(s.stockLevels, cur.stockLevels),
    blackMarket: s.blackMarket === undefined ? cur.blackMarket : !!s.blackMarket,
    balance: s.balance === undefined ? cur.balance : sanitizeBalance(s.balance, cur.balance),
    promotionEnabled: s.promotionEnabled === undefined ? cur.promotionEnabled : !!s.promotionEnabled,
    jobRanks: s.jobRanks === undefined ? cur.jobRanks : sanitizeRanks(s.jobRanks, cur.jobRanks),
    wantedEnabled: s.wantedEnabled === undefined ? cur.wantedEnabled : !!s.wantedEnabled,
    wantedDecayMin: s.wantedDecayMin === undefined ? cur.wantedDecayMin : clamp(s.wantedDecayMin, 1, 1440, DEFAULTS.wantedDecayMin),
    bountyPerStar: s.bountyPerStar === undefined ? cur.bountyPerStar : clamp(s.bountyPerStar, 0, 1_000_000, DEFAULTS.bountyPerStar),
    policeBonusPerWanted: s.policeBonusPerWanted === undefined ? cur.policeBonusPerWanted : clamp(s.policeBonusPerWanted, 0, 50, DEFAULTS.policeBonusPerWanted),
    arrestMinShifts: s.arrestMinShifts === undefined ? cur.arrestMinShifts : clamp(s.arrestMinShifts, 0, 1000, DEFAULTS.arrestMinShifts),
  };
  setKV(guildId, 'economy', next);
  return next;
}
export const money = (s, n) => `${s.currencyEmoji} ${Number(n).toLocaleString()}`;
