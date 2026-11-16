import { Events } from 'discord.js';
import { commands, richestButton, blackjackButton, heistButton, ramenButton, resolveExpiredHeists, holdHeistSweep } from './commands.js';
import { mountApi } from './api.js';
import { panelComponent, panelStickItems } from './panels.js';
import { customComponent, customStickItems } from './custompanels.js';
import { hubComponent, catStickItems, migrateCatPanels } from './hub.js';
import { decorateReply } from './decorate.js';
import { registerReplyDecorator } from '../../core/commands.js';

registerReplyDecorator(decorateReply); // 通貨の返事に、実行者の名前と残高を足す
import { crimeHelp, jobHelp, lifeHelp } from './help.js';
import { settleAll } from './lotteryengine.js';
import { boardTick, stockStickItem } from './stockboard.js';
import { stickChannels } from './board.js';
import { newspaperTick } from './newspaper.js';
import { priceTick, priceStickItem } from './priceboard.js';
import { pauseHeists, resumeHeists } from './db.js';
import { onShutdownCleanup } from '../../core/shutdown.js';

/** 通貨: 犯罪・バイト・乞食・ギャンブル(チンチロ・スロット・ブラックジャック)。既定はオフ(ダッシュボードで有効にする) */
export default {
  name: 'economy',
  title: '通貨',
  ui: '/dashboard/features/economy.js',
  commands,
  // メニューパネルで、コマンドを分ける(カテゴリー)
  categories: [
    { id: 'crime', title: '犯罪', emoji: '🚨', commands: ['crime', 'heist', 'arrest', 'wanted', 'bail'] },
    { id: 'work', title: 'バイト・職業', emoji: '💼', commands: ['work', 'beg', 'job'] },
    { id: 'money', title: 'お金', emoji: '🪙', commands: ['balance', 'deposit', 'withdraw', 'richest', 'pay', 'cooldowns'] },
    { id: 'shop', title: 'お店・不動産・闇市', emoji: '🏪', commands: ['shop', 'use', 'give', 'market', 'estate', 'detail'] },
    { id: 'pet', title: 'ペット', emoji: '🐾', commands: ['pet'] },
    { id: 'stock', title: '株', emoji: '📈', commands: ['stock', 'news', 'scandal'] },
    { id: 'lottery', title: '宝くじ', emoji: '🎟️', commands: ['lottery'] },
    { id: 'gamble', title: 'ギャンブル', emoji: '🎲', commands: ['chinchiro', 'slot', 'blackjack'] },
    { id: 'admin', title: '管理者向け', emoji: '🛠️', commands: ['balance-edit', 'cooldown-reset', 'release', 'blackjack-end'] },
  ],
  components: [blackjackButton, heistButton, ramenButton, richestButton, panelComponent, customComponent, hubComponent],
  helpTopics: [{ id: 'crime', label: '犯罪(犯罪・大型犯罪・闇マーケット)', sections: crimeHelp }, { id: 'job', label: '職業(バイト・昇進・指名手配)', sections: jobHelp }, { id: 'life', label: '暮らし(お店・ペット・株・宝くじ・不動産)', sections: lifeHelp }], // /help topic:犯罪 で、犯罪系の説明を全部表示
  help: [
    '管理者が有効にしたサーバーで使えます。`/balance` で残高、`/cooldowns` で待ち時間の一覧、`/deposit` `/withdraw` で銀行、`/richest` でランキング。',
    '稼ぐ: `/work`(バイト: コンビニ・警察・ファーストフード)、`/beg`(乞食)、`/crime`(犯罪: コンビニ・ATM・銀行・宝石・海賊。失敗すると罰金と留置場。`/bail` で保釈)。',
    '遊ぶ: `/chinchiro` `/slot` `/blackjack`。\n大型犯罪: `/heist`(ミニゲーム。現金輸送車・大型銀行・美術館・カジノ・宝物庫から選び、制限時間内に問題を解けば成功。大金を狙えますが、失敗すると重い罰金と留置場です)。\n闇マーケット: 管理者がオンにしたサーバーでは、犯罪に道具が必要です。`/market list` `/market buy` で買えます。\nパネル: ダッシュボードの「パネル」で、犯罪・バイト・お店のボタンを、チャンネルに置けます(置いたサーバーでは、元のコマンドを廃止できます)。\n株のニュース: `/news`(会社ごとに、最近のニュースを見る)。`/stock holders`(みんなの持ち株と、株の割合)。`/scandal`(お金を払って、不祥事を起こす。管理者がオンにしたサーバーで)。\nくわしい説明: `/detail`(品・闇市の道具・不動産・ペット・株・犯罪・バイトの、1つについての説明。名前は、入力すると、候補が出ます)。\n暮らし: `/shop` `/give`(持っている品を、ほかの人にあげる) `/pet` `/stock` `/lottery` `/estate`(管理者がオンにしたサーバーで使えます。`/help topic:暮らし` で詳しく)。\n昇進・指名手配: `/job`(階級)、`/wanted`(手配書)、`/arrest`(逮捕。警察のバイトを重ねた人)。管理者がオンにしたサーバーで使えます。',
  ].join('\n'),
  register({ client, router }) {
    mountApi(router, client);
    // 再起動をまたぐ大型銀行強盗: 止まる直前に残り時間を記録し、起動したときに、その残り時間から数え直す
    const resumed = resumeHeists();
    if (resumed) console.log(`[economy] 再起動前の大型銀行強盗 ${resumed}件の制限時間を、数え直しました`);
    onShutdownCleanup(() => { const n = pauseHeists(); if (n) console.log(`[economy] 進行中の大型銀行強盗 ${n}件の残り時間を記録しました`); });
    // 制限時間を過ぎて放置された大型銀行強盗を、15秒ごとに失敗として精算する(放置で罰を逃れられないように)
    // 起動した直後の30秒は、保留する(BOTが止まっていた間に、制限時間が過ぎた強盗を、すぐ失敗にしない)
    // 株価グラフ・値段表のチャンネルで、誰かが話したら、ボードを一番下に出し直す
    client.on(Events.MessageCreate, stickChannels(client, (g) => [priceStickItem(client), stockStickItem(client), ...panelStickItems(client), ...catStickItems(client, g), ...customStickItems(client, g)]));
    client.once(Events.ClientReady, () => {
      setTimeout(() => migrateCatPanels(client), 15_000).unref?.(); // コマンドの登録が、おちついてから
      holdHeistSweep(30_000); setInterval(() => resolveExpiredHeists(client), 15_000).unref?.();
      // 宝くじ: 1分ごとに、抽選の時刻を過ぎた回を、抽選して、発表する(起動直後にも1回。止まっていた間の分)
      settleAll(client); setInterval(() => settleAll(client), 60_000).unref?.();
      setInterval(() => boardTick(client), 60_000).unref?.(); setInterval(() => priceTick(client), 60_000).unref?.(); setInterval(() => newspaperTick(client), 60_000).unref?.();
    });
  },
};
