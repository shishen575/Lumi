import { getSettings, money } from './settings.js';
import { CRIMES } from './jobs.js';
import { HEISTS } from './heist.js';
import { ITEMS, MAX_STACK, toolFor, priceOf, marketRate } from './market.js';

const dur = (ms) => { const m = Math.round(ms / 60_000); return m >= 60 ? (m % 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${Math.floor(m / 60)}時間`) : `${m}分`; };
const range = (s, [a, b]) => `${money(s, a)}〜${money(s, b)}`;

/** /help topic:犯罪 の中身。数字は、ゲームの設定から作るので、いつも実際の値と合う。各欄は1024字以内 */
export function crimeHelp({ guildId }) {
  const s = getSettings(guildId), mk = s.blackMarket;
  const toolNote = (kind, key) => { const t = toolFor(kind, key); return mk && t ? ` ・ 必要な道具: ${t.emoji} ${t.name}` : ''; };
  const sections = [];

  sections.push({ name: '🎯 犯罪とは', value: [
    '成功すると**大金**、失敗すると**罰金と留置場**のハイリスク・ハイリターンな稼ぎ方です。',
    '・**所持金が0以下のとき**と、**留置場にいる間**は、犯罪ができません(バイト `/work`・乞食 `/beg` で稼げます)',
    '・種類ごとに**待ち時間**があります。失敗しても成功しても、待ち時間は付きます',
    '・失敗の罰金は、**手持ちのお金**から引かれます。`/deposit` で銀行に預けたお金は、罰金の対象外です',
    s.allowDebt ? '・罰金が手持ちを超えると、所持金が**マイナス(借金)**になります。借金の間は、犯罪ができません' : '・罰金は、持っているお金までしか引かれません(借金はありません)',
    mk ? '・このサーバーでは**闇マーケット**がオンです。犯罪には、専用の**道具**が必要です(1回の挑戦で1つ使います)' : '・このサーバーでは、道具なしで挑戦できます(管理者が闇マーケットをオンにすると、道具が必要になります)',
  ].join('\n') });

  sections.push({ name: '🚨 犯罪 `/crime`(運で決まります)', value: Object.entries(CRIMES).map(([k, c]) =>
    `${c.emoji} **${c.name}** — 成功率 **${Math.round(c.chance * 100)}%**\n　成功 ${range(s, c.win)} ・ 失敗 罰金 ${range(s, c.fine)}・留置場 ${dur(c.jail)} ・ 待ち時間 ${dur(c.cd)}${toolNote('crime', k)}`).join('\n') });

  sections.push({ name: '🏦 大型犯罪 `/heist target:場所`(腕で決まります)', value: [
    '制限時間内に、ボタンで問題(計算・数列・仲間はずれ・配線・暗証番号・監視カメラの数え上げ)に答えます。全部解ければ成功。間違えられる回数を超えるか、時間切れで失敗です。早く終えるほど、報酬は**最大+25%**。待ち時間は、場所ごとです。',
    '',
    ...Object.values(HEISTS).map((T) =>
      `${T.emoji} **${T.short}** — ${T.steps}問・${T.timeMs / 1000}秒・間違いは${T.maxMistakes}回まで\n　成功 ${range(s, T.win)} ・ 失敗 罰金 ${range(s, T.fine)}・留置場 ${dur(T.jail)} ・ 待ち時間 ${dur(T.cd)}${toolNote('heist', T.id)}`),
  ].join('\n') });

  if (mk) {
    sections.push({ name: '🕶️ 闇マーケット `/market`(今日の相場)', value: [
      '`/market list` で相場と所持数、`/market buy` で購入。値段は毎日少し変わります(基本の0.8〜1.3倍)。1種類につき、最大' + MAX_STACK + '個まで。',
      '',
      ...ITEMS.map((x) => { const r = marketRate(guildId, x.id); return `${x.emoji} **${x.name}** ${money(s, priceOf(guildId, x))}${r < 0.95 ? ' 📉' : r > 1.15 ? ' 📈' : ''} — ${x.desc}`; }),
    ].join('\n') });
  } else {
    sections.push({ name: '🕶️ 闇マーケット', value: 'このサーバーでは、**オフ**です。管理者が、ダッシュボードの「通貨」でオンにすると、犯罪に道具が必要になり、`/market` で買えるようになります。' });
  }

  sections.push({ name: '🔓 留置場と保釈', value: [
    '犯罪に失敗すると、留置場に入ります。入っている間は、犯罪ができません。',
    '・`/bail` — 保釈金を払って出ます(残り**1分につき ' + money(s, 100) + '**)',
    '・管理者は、`/release` や、ダッシュボードの「留置場」から、釈放できます',
    '・罰金は、管理者が、ダッシュボードの「残高の調整」から、1つの罰金につき1回だけ返金できます',
  ].join('\n') });

  sections.push({ name: '📋 関連コマンド', value: [
    '`/crime` `/heist` `/market` `/bail` — 犯罪',
    '`/work` `/beg` — 安全に稼ぐ',
    '`/balance` `/deposit` `/withdraw` `/pay` `/richest` — お金の管理',
  ].join('\n') });
  return sections;
}
