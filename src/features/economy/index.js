import { Events } from 'discord.js';
import { commands, blackjackButton, heistButton, resolveExpiredHeists, holdHeistSweep } from './commands.js';
import { mountApi } from './api.js';
import { pauseHeists, resumeHeists } from './db.js';
import { onShutdownCleanup } from '../../core/shutdown.js';

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
    '遊ぶ: `/chinchiro` `/slot` `/blackjack`。\n大型犯罪: `/heist`(ミニゲーム。現金輸送車・大型銀行・美術館・カジノ・宝物庫から選び、制限時間内に問題を解けば成功。大金を狙えますが、失敗すると重い罰金と留置場です)。\n闇マーケット: 管理者がオンにしたサーバーでは、犯罪に道具が必要です。`/market list` `/market buy` で買えます。',
  ].join('\n'),
  register({ client, router }) {
    mountApi(router);
    // 再起動をまたぐ大型銀行強盗: 止まる直前に残り時間を記録し、起動したときに、その残り時間から数え直す
    const resumed = resumeHeists();
    if (resumed) console.log(`[economy] 再起動前の大型銀行強盗 ${resumed}件の制限時間を、数え直しました`);
    onShutdownCleanup(() => { const n = pauseHeists(); if (n) console.log(`[economy] 進行中の大型銀行強盗 ${n}件の残り時間を記録しました`); });
    // 制限時間を過ぎて放置された大型銀行強盗を、15秒ごとに失敗として精算する(放置で罰を逃れられないように)
    // 起動した直後の30秒は、保留する(BOTが止まっていた間に、制限時間が過ぎた強盗を、すぐ失敗にしない)
    client.once(Events.ClientReady, () => { holdHeistSweep(30_000); setInterval(() => resolveExpiredHeists(client), 15_000).unref?.(); });
  },
};
