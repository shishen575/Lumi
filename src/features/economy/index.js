import { Events } from 'discord.js';
import { commands, blackjackButton, heistButton, resolveExpiredHeists, holdHeistSweep } from './commands.js';
import { mountApi } from './api.js';

/** 通貨: 犯罪・バイト・乞食・ギャンブル(チンチロ・スロット・ブラックジャック)。既定はオフ(ダッシュボードで有効にする) */
export default {
  name: 'economy',
  title: '通貨',
  ui: '/dashboard/features/economy.js',
  commands,
  components: [blackjackButton, heistButton],
  help: [
    '管理者が有効にしたサーバーで使えます。`/balance` で残高、`/deposit` `/withdraw` で銀行、`/richest` でランキング。',
    '稼ぐ: `/work`(バイト: コンビニ・警察・ファーストフード)、`/beg`(乞食)、`/crime`(犯罪: コンビニ・ATM・銀行・宝石・海賊。失敗すると罰金と留置場。`/bail` で保釈)。',
    '遊ぶ: `/chinchiro` `/slot` `/blackjack`。\n大型銀行: `/heist`(ミニゲーム。制限時間内に5つの問題を解けば成功。大金を狙えますが、失敗すると重い罰金と留置場です)。',
  ].join('\n'),
  register({ client, router }) {
    mountApi(router);
    // 制限時間を過ぎて放置された大型銀行強盗を、15秒ごとに失敗として精算する(放置で罰を逃れられないように)
    // 起動した直後の30秒は、保留する(BOTが止まっていた間に、制限時間が過ぎた強盗を、すぐ失敗にしない)
    client.once(Events.ClientReady, () => { holdHeistSweep(30_000); setInterval(() => resolveExpiredHeists(client), 15_000).unref?.(); });
  },
};
