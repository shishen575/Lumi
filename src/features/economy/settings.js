import { getKV, setKV } from '../../core/db.js';
import { DEFAULT_RANKS, sanitizeRanks } from './ranks.js';
import { sanitizeBalance } from './balance.js';
import { DEFAULT_NAMES, sanitizeNames, DEFAULT_LEVELS, sanitizeLevels, DEFAULT_EVENTS, sanitizeEvents, sanitizeCustomStocks } from './stocks.js';
import { DEFAULT_PETS, sanitizePets } from './pets.js';
import { DEFAULT_SHOP, sanitizeShopItems } from './shop.js';
import { DEFAULT_LOTTERY, sanitizeLotteries } from './lottery.js';
import { DEFAULT_ESTATE, sanitizeEstate } from './estate.js';

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
  arrestPick: 'either',    // /arrest で、逮捕する人の決め方: either = 選ばなくても、一覧から選んでもよい / auto = 選ばない(いつも、いちばん手配度の高い人) / list = 手配中の一覧から選ぶ(選ばないとできない)
  arrestMinShifts: 5,      // /arrest を使うのに必要な、警察のバイトの出勤回数
  balance: {},             // ゲームバランスの上書き({ キー: 数値 })。ダッシュボードの「ゲームバランス」で変える。なければ初期値
  stocksEnabled: false,    // 株。オンのとき、/stock が使える
  stockLevels: DEFAULT_LEVELS, // 会社ごとの変動の大きさ(1〜10の10段階)
  stockNames: DEFAULT_NAMES, // 会社の名前・ティッカー・絵文字(サーバーごとに変えられる)
  estateEnabled: false,    // 不動産。オンのとき、/estate が使える
  estate: DEFAULT_ESTATE,  // 物件の一覧(名前・値段・家賃・維持費などを、サーバーごとに変えられる)
  lotteryEnabled: false,   // 宝くじ。オンのとき、/lottery が使え、決まった時刻に、自動で抽選する
  lotteries: [DEFAULT_LOTTERY], // くじの一覧(サーバーごとに、自由に、最大6つ。名前・値段・間隔・桁数・賞金などを変えられる)
  newsEvents: DEFAULT_EVENTS, // 株のニュース(出来事): 文・上がる/下がる割合・会社・起きやすさ
  customStocks: [],        // サーバーで作った会社(名前・ティッカー・基準の株価・値動きの大きさ)
  scandalEnabled: false,   // お金を払って、会社の不祥事を起こせる(/scandal)
  newsEvery: 10,           // 新しいニュースが起きる間隔(分)。0 = ランダム(1日に1〜2回ほど)
  newsPower: 25,           // ニュースで動く強さ(%。100 = 出来事に書いた割合のまま)
  newsChannelId: null,     // 新聞チャンネル(株のニュースを出す)
  priceChannelId: null,    // 値段表(ペット・不動産・闇市)を出すチャンネル
  priceBoardMin: 30,       // 値段表を出す間隔(分)
  priceBoardReplace: true, // true: いつも一番下に最新の1つだけ(前のは書き換え/削除) / false: 毎回、新しく出す
  stockChannelId: null,    // 株価のグラフを出すチャンネル
  stockBoardMin: 5,        // グラフを出す間隔(分)
  stockBoardEdit: true,    // true: 1つのメッセージを更新 / false: 毎回、新しく出す
  lotteryMention: true,    // 抽選の発表で、くじを買った人にメンションする
  lotteryChannelId: null,  // 抽選の結果を発表するチャンネル(くじごとに、別のチャンネルも選べる)
  petSpecies: DEFAULT_PETS, // ペットの種類(名前・値段・餌・ボーナス・有効/無効)
  petsEnabled: false,      // ペット。オンのとき、/pet が使え、育てるとボーナスがつく
  shopItems: DEFAULT_SHOP, // お店の品(名前・値段・効果などを、サーバーごとに変えられる)
  shopEnabled: false,      // お店(タバコ・お酒)。オンのとき、/shop と /use が使える
  allowDebt: true,       // 借金を許可するか。許可すると、罰金などで、所持金が0より下になる(0以下の間は、犯罪ができない)
};
const clamp = (v, lo, hi, def) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };

export const getSettings = (guildId) => {
  const s = { ...DEFAULTS, ...getKV(guildId, 'economy', {}) };
  if (Array.isArray(s.estate)) s.estate = s.estate.map((p) => ({ petSlots: 1, ...p })); // あとから増えた項目(ペット枠)は、初期値で補う
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
    petSpecies: s.petSpecies === undefined ? cur.petSpecies : sanitizePets(s.petSpecies, cur.petSpecies),
    petsEnabled: s.petsEnabled === undefined ? cur.petsEnabled : !!s.petsEnabled,
    estateEnabled: s.estateEnabled === undefined ? cur.estateEnabled : !!s.estateEnabled,
    estate: s.estate === undefined ? cur.estate : sanitizeEstate(s.estate, cur.estate),
    lotteryEnabled: s.lotteryEnabled === undefined ? cur.lotteryEnabled : !!s.lotteryEnabled,
    lotteries: s.lotteries === undefined ? cur.lotteries : sanitizeLotteries(s.lotteries, cur.lotteries),
    lotteryMention: s.lotteryMention === undefined ? cur.lotteryMention : !!s.lotteryMention,
    lotteryChannelId: s.lotteryChannelId === undefined ? cur.lotteryChannelId : (/^\d{15,25}$/.test(String(s.lotteryChannelId ?? '')) ? String(s.lotteryChannelId) : null),
    stocksEnabled: s.stocksEnabled === undefined ? cur.stocksEnabled : !!s.stocksEnabled,
    stockNames: s.stockNames === undefined ? cur.stockNames : sanitizeNames(s.stockNames, cur.stockNames),
    newsEvents: s.newsEvents === undefined ? cur.newsEvents : sanitizeEvents(s.newsEvents, cur.newsEvents),
    customStocks: s.customStocks === undefined ? cur.customStocks : sanitizeCustomStocks(s.customStocks, cur.customStocks),
    scandalEnabled: s.scandalEnabled === undefined ? cur.scandalEnabled : !!s.scandalEnabled,
    newsEvery: s.newsEvery === undefined ? cur.newsEvery : clamp(s.newsEvery, 0, 1440, DEFAULTS.newsEvery),
    newsPower: s.newsPower === undefined ? cur.newsPower : clamp(s.newsPower, 0, 500, DEFAULTS.newsPower),
    newsChannelId: s.newsChannelId === undefined ? cur.newsChannelId : (/^\d{15,25}$/.test(String(s.newsChannelId ?? '')) ? String(s.newsChannelId) : null),
    priceChannelId: s.priceChannelId === undefined ? cur.priceChannelId : (/^\d{15,25}$/.test(String(s.priceChannelId ?? '')) ? String(s.priceChannelId) : null),
    priceBoardMin: s.priceBoardMin === undefined ? cur.priceBoardMin : clamp(s.priceBoardMin, 5, 1440, DEFAULTS.priceBoardMin),
    priceBoardReplace: s.priceBoardReplace === undefined ? cur.priceBoardReplace : !!s.priceBoardReplace,
    stockChannelId: s.stockChannelId === undefined ? cur.stockChannelId : (/^\d{15,25}$/.test(String(s.stockChannelId ?? '')) ? String(s.stockChannelId) : null),
    stockBoardMin: s.stockBoardMin === undefined ? cur.stockBoardMin : clamp(s.stockBoardMin, 5, 1440, DEFAULTS.stockBoardMin),
    stockBoardEdit: s.stockBoardEdit === undefined ? cur.stockBoardEdit : !!s.stockBoardEdit,
    stockLevels: s.stockLevels === undefined ? cur.stockLevels : sanitizeLevels(s.stockLevels, cur.stockLevels),
    blackMarket: s.blackMarket === undefined ? cur.blackMarket : !!s.blackMarket,
    balance: s.balance === undefined ? cur.balance : sanitizeBalance(s.balance, cur.balance),
    promotionEnabled: s.promotionEnabled === undefined ? cur.promotionEnabled : !!s.promotionEnabled,
    jobRanks: s.jobRanks === undefined ? cur.jobRanks : sanitizeRanks(s.jobRanks, cur.jobRanks),
    wantedEnabled: s.wantedEnabled === undefined ? cur.wantedEnabled : !!s.wantedEnabled,
    wantedDecayMin: s.wantedDecayMin === undefined ? cur.wantedDecayMin : clamp(s.wantedDecayMin, 1, 1440, DEFAULTS.wantedDecayMin),
    bountyPerStar: s.bountyPerStar === undefined ? cur.bountyPerStar : clamp(s.bountyPerStar, 0, 1_000_000, DEFAULTS.bountyPerStar),
    policeBonusPerWanted: s.policeBonusPerWanted === undefined ? cur.policeBonusPerWanted : clamp(s.policeBonusPerWanted, 0, 50, DEFAULTS.policeBonusPerWanted),
    arrestPick: s.arrestPick === undefined ? cur.arrestPick : (['either', 'auto', 'list'].includes(s.arrestPick) ? s.arrestPick : DEFAULTS.arrestPick),
    arrestMinShifts: s.arrestMinShifts === undefined ? cur.arrestMinShifts : clamp(s.arrestMinShifts, 0, 1000, DEFAULTS.arrestMinShifts),
  };
  setKV(guildId, 'economy', next);
  return next;
}
export const money = (s, n) => `${s.currencyEmoji} ${Number(n).toLocaleString()}`;
