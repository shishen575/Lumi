import { getSettings, money } from './settings.js';
import { CRIMES, JOBS } from './jobs.js';
import { POLICE_BONUS_CAP } from './wanted.js';
import { RAMEN, GRADES } from './ramen.js';
import { toolCfg, timeoutCfg, ramenCfg, crimeOf, jobOf, heistOf, itemOf, marketCfg, wantedCfg, bailPerMin } from './balance.js';
import { HEISTS } from './heist.js';
import { ITEMS, toolFor, priceOf, marketRate } from './market.js';

const dur = (ms) => { const m = Math.round(ms / 60_000); return m >= 60 ? (m % 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${Math.floor(m / 60)}時間`) : `${m}分`; };
const range = (s, [a, b]) => `${money(s, a)}〜${money(s, b)}`;

/** /help topic:犯罪 の中身。数字は、ゲームの設定から作るので、いつも実際の値と合う。各欄は1024字以内 */
export function crimeHelp({ guildId }) {
  const s = getSettings(guildId), mk = s.blackMarket, wc = wantedCfg(s), mc = marketCfg(s); // 数字は、サーバーの設定(ゲームバランス)を反映
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

  sections.push({ name: '🚨 犯罪 `/crime`(運で決まります)', value: Object.keys(CRIMES).map((k) => [k, crimeOf(s, k)]).map(([k, c]) =>
    `${c.emoji} **${c.name}** — 成功率 **${Math.round(c.chance * 100)}%**\n　成功 ${range(s, c.win)} ・ 失敗 罰金 ${range(s, c.fine)}・留置場 ${dur(c.jail)} ・ 待ち時間 ${dur(c.cd)}${toolNote('crime', k)}`).join('\n') });

  sections.push({ name: '🏦 大型犯罪 `/heist target:場所`(腕で決まります)', value: [
    '制限時間内に、ボタンで問題(計算・数列・仲間はずれ・配線・暗証番号・監視カメラの数え上げ)に答えます。全部解ければ成功。間違えられる回数を超えるか、時間切れで失敗です。早く終えるほど、報酬は**最大+25%**。待ち時間は、場所ごとです。',
    (() => { const tc = timeoutCfg(s); return `⏰ 時間切れ(放置も同じ): ${tc.finePct === 1 && tc.jailPct === 1 ? '失敗と同じ扱い(重い罰金と留置場)' : tc.finePct === 0 && tc.jailPct === 0 ? '罰のない撤退(報酬はなし)' : `罰が軽くなります(罰金 ${Math.round(tc.finePct * 100)}% ・ 留置場 ${Math.round(tc.jailPct * 100)}%)`}`; })(),
    '',
    ...Object.keys(HEISTS).map((id) => heistOf(s, id)).map((T) =>
      `${T.emoji} **${T.short}** — ${T.steps}問・${T.timeMs / 1000}秒・間違いは${T.maxMistakes}回まで\n　成功 ${range(s, T.win)} ・ 失敗 罰金 ${range(s, T.fine)}・留置場 ${dur(T.jail)} ・ 待ち時間 ${dur(T.cd)}${toolNote('heist', T.id)}`),
  ].join('\n') });

  if (mk) {
    sections.push({ name: '🕶️ 闇マーケット `/market`(今日の相場)', value: [
      '`/market list` で相場と所持数、`/market buy` で購入。値段は毎日少し変わります(基本の' + mc.range[0] + '〜' + mc.range[1] + '倍)。1種類につき、最大' + mc.maxStack + '個まで。',
      '',
      (() => { const k = toolCfg(s); return `使った道具は、結果によって、持ち帰れることがあります(成功 ${Math.round(k.success * 100)}% ・ 失敗 ${Math.round(k.fail * 100)}% ・ 大型犯罪の時間切れ/撤退 ${Math.round(k.timeout * 100)}%)`; })(),
      ...ITEMS.map((x) => { const r = marketRate(guildId, x.id, undefined, mc.range); return `${x.emoji} **${x.name}** ${money(s, priceOf(guildId, itemOf(s, x), undefined, mc.range))}${r < 0.95 ? ' 📉' : r > 1.15 ? ' 📈' : ''} — ${x.desc}`; }),
    ].join('\n') });
  } else {
    sections.push({ name: '🕶️ 闇マーケット', value: 'このサーバーでは、**オフ**です。管理者が、ダッシュボードの「通貨」でオンにすると、犯罪に道具が必要になり、`/market` で買えるようになります。' });
  }

  if (s.wantedEnabled) sections.push({ name: '🚨 指名手配', value: `犯罪・大型犯罪に成功すると、手配度が溜まり、星(⭐)が付きます。星1つにつき、犯罪の成功率が ${Math.round(wc.penalty * 100)}% 下がります。警察のバイトを重ねた人に、\`/arrest\` で逮捕されると、留置場に入り、懸賞金を取られます(手配書は \`/wanted\`)。捕まる(失敗する)と、手配は解除されます。詳しくは \`/help topic:職業\`` });
  sections.push({ name: '🔓 留置場と保釈', value: [
    '犯罪に失敗すると、留置場に入ります。入っている間は、犯罪ができません。',
    '・`/bail` — 保釈金を払って出ます(残り**1分につき ' + money(s, bailPerMin(s)) + '**)',
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

/** /help topic:職業 の中身(バイト・昇進・指名手配) */
export function jobHelp({ guildId }) {
  const s = getSettings(guildId), wc = wantedCfg(s), sections = [];
  sections.push({ name: '💼 バイト `/work`', value: [
    '安全に稼げます(失敗はありません)。種類ごとに、待ち時間があります。`/job` で、自分の階級と出勤回数を見られます。',
    '',
    ...Object.keys(JOBS).map((k) => jobOf(s, k)).map((j) => `${j.emoji} **${j.name}** — 給料 ${range(s, j.pay)} ・ 待ち時間 ${dur(j.cd)}${j.bonus ? ` ・ ボーナス ${Math.round(j.bonus.chance * 100)}%(+${range(s, j.bonus.amount)})` : ''}`),
  ].join('\n') });
  { const rc = ramenCfg(s); sections.push({ name: '🍜 ラーメン屋(ミニゲーム)', value: [
    `\`/work job:ラーメン屋\` は、**ラーメンを作るミニゲーム**です。お客さんの注文(スープ・麺の茹で時間・トッピング)に、ボタンで答えて作ります。制限時間は **${rc.timeMs / 1000}秒**。出来栄えで、給料が変わります。`,
    `**大成功**(全問正解)×${GRADES.perfect.mult}(さらに +${rc.perfectBonus}%)/ **成功** ×${GRADES.good.mult} / **まあまあ** ×${GRADES.soso.mult} / **失敗** ×${GRADES.bad.mult}`,
    '',
    '**ラーメンごとの、ギミック**',
    ...Object.values(RAMEN).map((r) => `${r.emoji} **${r.name}** — ${r.gimmick}: ${r.gimmickText}`),
  ].join('\n') }); }
  if (s.promotionEnabled) {
    sections.push({ name: '📈 昇進', value: ['出勤を重ねると昇進して、給料(ボーナスも)の倍率が上がります。', '',
      ...Object.entries(JOBS).map(([k, j]) => `${j.emoji} **${j.name}**: ${s.jobRanks[k].map((r) => `${r.name}${r.shifts ? `(${r.shifts}回〜)` : ''} ×${r.pct / 100}`).join(' → ')}`)].join('\n') });
  } else {
    sections.push({ name: '📈 昇進', value: 'このサーバーでは、**オフ**です。管理者が、ダッシュボードの「通貨 → 職業の昇進」でオンにすると、出勤回数に応じて、階級が上がり、給料が増えます。' });
  }
  if (s.wantedEnabled) {
    sections.push({ name: '🚨 指名手配', value: [
      `犯罪・大型犯罪に**成功**すると、**手配度**が溜まります。手配度が ${wc.heatPerStar} 増えるごとに、星(⭐)が1つ(最大5つ)。星1つにつき、犯罪の成功率が **${Math.round(wc.penalty * 100)}%** 下がります。手配度は、**${s.wantedDecayMin}分ごとに1** 下がります。捕まる(失敗する)と、手配は解除されます。`,
      '・`/wanted` — 手配書(手配中の人と、懸賞金)。`user` で、1人を調べられます',
      `・\`/arrest\` — 指名手配中の人を逮捕。**警察のバイトを ${s.arrestMinShifts}回 以上**した人だけ。成功率 ${Math.round(wc.arrestChance * 100)}%、待ち時間 ${dur(wc.arrestCd)}。成功すると、**懸賞金**(星1つ ${money(s, s.bountyPerStar)})がもらえて、相手は留置場に入ります`,
      `・**警察のバイトのボーナス**は、手配中の人が1人増えるごとに **+${s.policeBonusPerWanted}%**(基本 ${Math.round(jobOf(s, 'police').bonus.chance * 100)}% → 上限 ${Math.round(POLICE_BONUS_CAP * 100)}%)`,
      '',
      '手配度の上がり方: ' + [...Object.entries(CRIMES).map(([k, c]) => `${c.emoji}+${wc.heatCrime(k)}`), ...Object.values(HEISTS).map((T) => `${T.emoji}+${wc.heatHeist(T.id)}`)].join(' '),
    ].join('\n') });
  } else {
    sections.push({ name: '🚨 指名手配', value: 'このサーバーでは、**オフ**です。管理者が、ダッシュボードの「通貨 → 指名手配」でオンにすると、犯罪で手配度が溜まり、警察のバイトを重ねた人が `/arrest` で逮捕して、懸賞金をもらえます。' });
  }
  sections.push({ name: '📋 関連コマンド', value: '`/work` `/job` — バイトと階級\n`/wanted` `/arrest` — 指名手配と逮捕\n`/crime` `/heist` — 犯罪(`/help topic:犯罪`)' });
  return sections;
}
