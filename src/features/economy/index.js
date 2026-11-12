import { commands, blackjackButton } from './commands.js';
import { mountApi } from './api.js';

/** 通貨: 犯罪・バイト・乞食・ギャンブル(チンチロ・スロット・ブラックジャック)。既定はオフ(ダッシュボードで有効にする) */
export default {
  name: 'economy',
  title: '通貨',
  ui: '/dashboard/features/economy.js',
  commands,
  components: [blackjackButton],
  help: [
    '管理者が有効にしたサーバーで使えます。`/balance` で残高、`/deposit` `/withdraw` で銀行、`/richest` でランキング。',
    '稼ぐ: `/work`(バイト: コンビニ・警察・ファーストフード)、`/beg`(乞食)、`/crime`(犯罪: コンビニ・ATM・銀行・宝石・海賊。失敗すると罰金と留置場。`/bail` で保釈)。',
    '遊ぶ: `/chinchiro` `/slot` `/blackjack`。',
  ].join('\n'),
  register({ router }) { mountApi(router); },
};
