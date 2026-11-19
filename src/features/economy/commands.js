import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getSettings, money } from './settings.js';
import { detailCommand } from './details.js';
import { stockHoldersAll, shockStock, lastStockRow, addNews, recentNews, transferItem, estateHoldings, estateCount, addEstate, takeEstate, rentAt, setRentAt, addTicket, userTickets, userTicketCount, roundSales, lotteryJackpot, lastDraw, holdings, holding, addHolding, takeHolding, getPets, adoptPet, renamePet, releasePet, updatePet, setStatus, activeStatuses, shiftsOf, allShifts, addShift, getHeat, addHeat, clearHeat, topWanted, itemQty, allItems, addItem, useItem, transfer, adjustBalance, clearCooldowns, audit, peek, deposit, withdraw, cooldownLeft, setCooldown, jailLeft, jail, release, richestPage, getBj, saveBj, deleteBj, allBj, claimBj, getRamen, saveRamen, claimRamen, getHeist, saveHeist, claimHeist, expiredHeists, setHeistDeadline, releaseAll } from './db.js';
import { ensureAccount, pay, collect, fine, treasury } from './ledger.js';
import { hasAccessSync, isOperator } from '../../core/access.js';
import { PermissionFlagsBits } from 'discord.js';
import {
  rnd, roundProb, chinchiroPlay, chinchiroCompare, chinchiroScale, slotSpin, slotPayout, slotMultiplier,
  bjDeal, bjHit, bjStand, bjDouble, handValue, cardText, bjScale,
} from './games.js';
import { rankFor, scalePay } from './ranks.js';
import { RAMEN, makeOrder, gradeRamen, GRADES } from './ramen.js';
import { SHIFT_GAMES, isShiftGame, makeShift, variantOf, gradeShift, SHIFT_GRADES } from './shiftjobs.js';
import { POLICE_BONUS_CAP } from './wanted.js';
import { userFx } from './userfx.js';
import { marketNow, unitPrice, sparkline } from './stockmarket.js';
import { VOL_LABELS, MAX_COMPANIES, companiesOf, companyOf, trendArrow } from './stocks.js';
import { MAX_PROPERTIES, estateOf, estateById, hourlyNet, accrued } from './estate.js';
import { MAX_LOTTERIES, lotteriesOf, estimateRtp, roundOf, drawTimeOf, pad, drawNumber } from './lottery.js';
import { settleGuild, announce, drawEmbed } from './lotteryengine.js';
import { MAX_PETS, petsOpen, speciesOf, bonusLabel, levelOf, nextXp, MAX_LEVEL, hungerNow, hungerBar, petFx } from './pets.js';
import { SLOTS, MAX_SHOP_ITEMS, SHOP_MAX_STACK, shopItems, shopById, itemText } from './shop.js';
import { describeFx } from './effects.js';
import { estateCfg, stockCfg, petCfg, toolCfg, timeoutCfg, ramenCfg, shiftCfg, crimeOf, jobOf, begOf, heistOf, itemOf, marketCfg, wantedCfg, bailPerMin } from './balance.js';
import { starsOf, stars as starText, bountyOf, chanceDelta } from './wanted.js';
import { ITEMS, itemById, toolFor, priceOf, marketRate } from './market.js';
import { CRIMES, JOBS, resolveCrime, resolveWork, resolveBeg } from './jobs.js';
import { HEISTS, heistKey, makeSteps, heistReward, heistBase, heistFine } from './heist.js';

const EPH = { flags: MessageFlags.Ephemeral };
/** 一覧系の返事: ふつうは自分だけに見える。`public` をオンにすると、全員に見える */
const vis = (i) => (i.options.getBoolean('public') ? {} : EPH);
/** 一覧の絞り込み: `search` に入れた言葉(名前などの一部。大文字・小文字・全角半角は区別しない)を含むものだけを出す */
const normQ = (v) => String(v ?? '').normalize('NFKC').toLowerCase().trim();
const matcher = (i) => { const k = normQ(i.options.getString('search')); return (...texts) => !k || texts.some((t) => normQ(t).includes(k)); };
const noMatch = (i) => refuse(i, `「${i.options.getString('search')}」に合うものは、ありませんでした。`);
const searchOpt = (o) => o.setName('search').setDescription('名前などの一部で、絞り込む(例: ビール)').setMaxLength(30);
const NO_MENTIONS = { parse: [] };
const GREEN = 0x57f287, RED = 0xed4245, GOLD = 0xf1c40f, BLUE = 0x5865f2, GRAY = 0x99aab5;
const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const BJ_TTL = 10 * 60_000;
const SWEEP_GRACE = 20_000;   // 制限時間を過ぎても、20秒は、遅れて届くボタンを待つ
const CLICK_GRACE = 2_000;    // ボタンを押した時刻の判定の、誤差の許容
const LAG_COMPENSATION_MAX = 20_000; // ボタンが遅れて届いたとき、その遅れの分だけ制限時間を延ばす(1回につき最大20秒)
let holdSweepUntil = 0;       // この時刻までは、放置の精算をしない(BOTの再起動や停止のあと)
export const holdHeistSweep = (ms, now = Date.now()) => { holdSweepUntil = Math.max(holdSweepUntil, now + ms); };
const heistAbandoned = (h, now = Date.now()) => now >= holdSweepUntil && now > h.deadline + SWEEP_GRACE;

const dur = (ms) => { const t = Math.ceil(ms / 1000), m = Math.floor(t / 60), r = t % 60; return m ? `${m}分${r ? `${r}秒` : ''}` : `${r}秒`; };
const wallet = (i) => peek(i.guildId, i.user.id).wallet;
const card = (i, s, color, title, desc) => {
  const e = new EmbedBuilder().setColor(color).setTitle(title)
    .setAuthor({ name: i.member?.displayName ?? i.user.username, iconURL: i.user.displayAvatarURL?.() })
    .setFooter({ text: `所持金 ${money(s, wallet(i))}` });
  return desc ? e.setDescription(desc) : e; // Discordの埋め込みは、空の説明文を受け付けない
};
const guildOnly = (b) => b.setDMPermission(false);

/** ボタンへの応答(画面の更新)。BOTの処理が遅れて、3秒の応答期限を過ぎていても、メッセージを直接書き換えて、画面を進める */
async function safeUpdate(i, payload) {
  try { await i.update(payload); }
  catch (e) { try { await i.message?.edit?.(payload); } catch { /* 画面を更新できなくても、ゲームの状態は保存済み */ } }
}

/** 共通の入口: オフのサーバーでは断る。口座を用意して、時間切れのブラックジャックを精算する */
async function open(i) {
  const s = getSettings(i.guildId);
  if (!s.enabled) { await i.reply({ content: 'このサーバーでは、通貨機能がオフです。管理者が、ダッシュボードの「通貨」でオンにできます。', ...EPH }); return null; }
  ensureAccount(i.guildId, i.user.id, s);
  const b = getBj(i.guildId, i.user.id);
  if (b && Date.now() - b.started_at > BJ_TTL) deleteBj(i.guildId, i.user.id); // 時間切れ: 賭け金は戻らない
  const h = getHeist(i.guildId, i.user.id);
  if (h && heistAbandoned(h)) settleHeistFailure(i.guildId, i.user.id, s, 'timeout'); // 放置された大型銀行強盗は、失敗として精算
  return s;
}
const refuse = (i, text) => i.reply({ content: text, ...EPH });
const budgetEmpty = (s, g) => s.budgetEnabled && treasury(g) <= 0;
const BUDGET_EMPTY = 'いま、サーバーの予算が空です。管理者が予算を追加するまで、報酬はもらえません。';
const debtNote = (i, s) => { const w = wallet(i); return w < 0 ? `\n-# 💸 借金が ${money(s, -w)} 残っています` : ''; };
const shortNote = (s, r) => (r.short > 0 ? `\n-# 予算が足りなかったため、${money(s, r.short)} が減額されました` : '');

/** 賭け金の確認。問題があれば、理由を返信して null */
async function takeBet(i, s) {
  const bet = i.options.getInteger('bet', true);
  if (bet < 10) { await refuse(i, '賭けられるのは、10以上です。'); return null; }
  const limit = Math.round(s.maxBet * Math.max(0, 1 + userFx(s, i.guildId, i.user.id).betLimit)); // お店の品・ペットの効果で、上限が増減する
  if (bet > limit) { await refuse(i, `賭けられるのは、最大 ${money(s, limit)} までです。${limit > s.maxBet ? '(お店の品・ペットの効果で、増えています)' : ''}`); return null; }
  if (wallet(i) < bet) { await refuse(i, `手持ちが足りません。(所持金 ${money(s, wallet(i))})`); return null; }
  return bet;
}

/* ================= 残高・銀行 ================= */
export const balanceCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('balance').setDescription('所持金と銀行の残高を見ます')
    .addUserOption((o) => o.setName('user').setDescription('見たい相手(省略すると自分)'))),
  async execute(i) {
    const s = await open(i); if (!s) return;
    const u = i.options.getUser('user') ?? i.user; const a = peek(i.guildId, u.id);
    const jl = jailLeft(i.guildId, u.id);
    await i.reply({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle(`${s.currencyEmoji} 残高`).setAuthor({ name: u.displayName ?? u.username, iconURL: u.displayAvatarURL?.() })
      .addFields({ name: a.wallet < 0 ? '手持ち(借金)' : '手持ち', value: money(s, a.wallet), inline: true }, { name: '銀行', value: money(s, a.bank), inline: true }, { name: '合計', value: money(s, a.wallet + a.bank), inline: true })
      .setDescription([jl ? `🚔 留置場にいます(あと ${dur(jl)})` : '', a.wallet < 0 ? `💸 **借金があります。** バイト(/work)や乞食(/beg)で返しましょう。返すまで、犯罪はできません。` : jl ? '' : '手持ちは、犯罪で捕まったときの罰金の対象です。銀行に預けると安全です。'].filter(Boolean).join('\n'))], allowedMentions: NO_MENTIONS });
  },
};
const moveCommand = (name, desc, fn, verb) => ({
  data: guildOnly(new SlashCommandBuilder().setName(name).setDescription(desc)
    .addIntegerOption((o) => o.setName('amount').setDescription('金額').setMinValue(1))
    .addBooleanOption((o) => o.setName('all').setDescription('全額'))),
  async execute(i) {
    const s = await open(i); if (!s) return;
    const a = peek(i.guildId, i.user.id); const have = name === 'deposit' ? a.wallet : a.bank;
    const amount = i.options.getBoolean('all') ? have : i.options.getInteger('amount');
    if (!amount || amount < 1) return refuse(i, `金額を入力するか、all を選んでください。(${name === 'deposit' ? '手持ち' : '銀行'}: ${money(s, have)})`);
    if (!fn(i.guildId, i.user.id, amount)) return refuse(i, `${name === 'deposit' ? '手持ち' : '銀行の残高'}が足りません。(${money(s, have)})`);
    const b = peek(i.guildId, i.user.id);
    await i.reply({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle(`🏦 ${verb}ました`).setDescription(`${money(s, amount)} を${verb}ました。\n手持ち ${money(s, b.wallet)} / 銀行 ${money(s, b.bank)}`)] });
  },
});
export const depositCommand = moveCommand('deposit', '手持ちを、銀行に預けます(罰金の対象から外れます)', deposit, '預け');
export const withdrawCommand = moveCommand('withdraw', '銀行から、手持ちに引き出します', withdraw, '引き出し');

const RICH_PER = 10;
const richPage = (s, g, page) => {
  const { rows, count } = richestPage(g, page * RICH_PER, RICH_PER), pages = Math.max(1, Math.ceil(count / RICH_PER)), M = ['🥇', '🥈', '🥉'];
  const body = rows.length ? rows.map((r, n) => { const rank = page * RICH_PER + n; return `${M[rank] ?? `${rank + 1}.`} <@${r.user_id}>  ${money(s, r.total)}`; }).join('\n') : 'まだ、お金を持っている人がいません。';
  // ボタンの識別番号(custom_id)は、1つのメッセージの中で、重複できない。動作の名前を、末尾に付けて、必ず別にする
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rich:0:first').setEmoji('⏮').setLabel('1位').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`rich:${Math.max(0, page - 1)}:prev`).setLabel('前').setStyle(ButtonStyle.Primary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`rich:${Math.min(pages - 1, page + 1)}:next`).setLabel('次').setStyle(ButtonStyle.Primary).setDisabled(page >= pages - 1),
  );
  return { content: `${s.currencyEmoji} **みんなのお金(お金持ちランキング)**\n-# 手持ち + 銀行 ・ ${count}人 ・ ${page + 1} / ${pages} ページ\n\n${body}`, components: pages > 1 ? [row] : [], allowedMentions: NO_MENTIONS };
};
export const richestCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('richest').setDescription('みんなのお金のランキング(手持ち + 銀行。全員に見えます)')
    .addIntegerOption((o) => o.setName('page').setDescription('ページ(省略すると1ページ目)').setMinValue(1))),
  async execute(i) {
    const s = await open(i); if (!s) return;
    const { count } = richestPage(i.guildId, 0, 1); if (!count) return refuse(i, 'まだ、お金を持っている人がいません。');
    const pages = Math.max(1, Math.ceil(count / RICH_PER));
    await i.reply(richPage(s, i.guildId, Math.min(pages - 1, (i.options.getInteger('page') ?? 1) - 1)));
  },
};
export const richestButton = {
  id: 'rich',
  async execute(i) {
    const s = getSettings(i.guildId); if (!s.enabled) return i.update({ content: 'このサーバーでは、通貨はオフです。', embeds: [], components: [] });
    const { count } = richestPage(i.guildId, 0, 1), pages = Math.max(1, Math.ceil(count / RICH_PER));
    await i.update(richPage(s, i.guildId, Math.min(pages - 1, Math.max(0, Number(i.customId.split(':')[1]) || 0)))); // だれが押しても、全員に見える(みんなで見るランキング)
  },
};

/* ================= 犯罪・バイト・乞食 ================= */
const crimeChoices = Object.entries(CRIMES).map(([value, c]) => ({ name: `${c.emoji} ${c.name}`, value }));
const jobChoices = Object.entries(JOBS).map(([value, j]) => ({ name: `${j.emoji} ${j.name}`, value }));

/** 犯罪・強盗に成功したとき: 手配度を上げて、指名手配の案内の文を返す(オフのサーバーでは、空) */
function wantedLine(s, g, u, gain) {
  if (!s.wantedEnabled) return '';
  const wc = wantedCfg(s), heat = addHeat(g, u, gain, s.wantedDecayMin, wc.maxHeat), n = starsOf(heat, wc.heatPerStar);
  return n ? `\n\n${starText(n)} **指名手配 Lv${n}**(懸賞金 ${money(s, bountyOf(heat, s.bountyPerStar, wc.heatPerStar))})\n-# 警察に逮捕されると、手配は解除されます。星が多いほど、犯罪は失敗しやすくなります` : `\n-# 🔎 警察に目をつけられはじめた…(手配度 ${heat})`;
}
/** 闇マーケットがオンのとき、犯罪に必要な道具を1つ使う。使えたら tool を、オフなら null を、道具がなくて断ったら false を返す */
/** 使った道具を、確率で持ち帰る(戻ってくる)。outcome: success / fail / timeout。戻ったら、その道具を返す */
function keepTool(s, tool, outcome, g, u, rng = rnd, bonus = 0) {
  if (!tool || !(rng() < Math.min(1, toolCfg(s)[outcome] + bonus))) return null; // bonus: 効果(ペットなど)による上乗せ
  addItem(g, u, tool.id, 1);
  return tool;
}
const toolLine = (tool) => (tool ? `\n🧰 ${tool.emoji} **${tool.name}** は、持ち帰りました(消費しませんでした)` : '');
function takeTool(i, s, kind, key) {
  if (!s.blackMarket) return null;
  const tool = toolFor(kind, key); if (!tool) return null;
  if (useItem(i.guildId, i.user.id, tool.id)) return tool;
  refuse(i, `🎒 ${tool.emoji} **${tool.name}** が必要です。\`/market\` の闇マーケットで買えます。(${tool.desc})`);
  return false;
}
export const crimeCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('crime').setDescription('犯罪に挑戦します(成功すると大金。失敗すると罰金と留置場)')
    .addStringOption((o) => o.setName('type').setDescription('何をするか').setRequired(true).addChoices(...crimeChoices))),
  async execute(i, rng = rnd) {
    const s = await open(i); if (!s) return;
    const key = i.options.getString('type', true); const c = crimeOf(s, key); // サーバーの設定(ダッシュボードの「ゲームバランス」)を反映した値
    const jl = jailLeft(i.guildId, i.user.id); if (jl) return refuse(i, `🚔 留置場にいる間は、犯罪はできません。(あと ${dur(jl)}。/bail で保釈できます)`);
    const w = wallet(i); if (w <= 0) return refuse(i, `💸 所持金が0以下のときは、犯罪はできません。(いまの所持金 ${money(s, w)})\nバイト(/work)や乞食(/beg)で、お金を稼ぎましょう。`);
    const cd = cooldownLeft(i.guildId, i.user.id, `crime:${key}`); if (cd) return refuse(i, `${c.emoji} ${c.name}は、まだ警戒が厳しいです。あと ${dur(cd)}。`);
    if (budgetEmpty(s, i.guildId)) return refuse(i, BUDGET_EMPTY);
    const toolUsed = takeTool(i, s, 'crime', key); if (toolUsed === false) return; // 闇マーケットがオンのとき、道具が必要(1回で1つ使う)
    const g = i.guildId, u = i.user.id;
    const wc = wantedCfg(s), fx = userFx(s, g, u); // fx: お店の消耗品・ペットの効果
    const starsNow = s.wantedEnabled ? starsOf(getHeat(g, u, s.wantedDecayMin), wc.heatPerStar) : 0; // 指名手配の星が多いほど、成功しにくい
    const r = resolveCrime(c, rng, chanceDelta(starsNow, wc.penalty) + fx.crimeChance);
    if (r.success) {
      const p = pay(g, u, Math.round(r.amount * Math.max(0, 1 + fx.crimeReward)), s); // お店の品・ペットの効果で、報酬が増減
      if (p.paid > 0) setCooldown(g, u, `crime:${key}`, c.cd);
      return i.reply({ embeds: [card(i, s, GREEN, `${c.emoji} ${c.name} 成功!`, `${r.text}\n\n**+ ${money(s, p.paid)}**${shortNote(s, p)}${wantedLine(s, g, u, wc.heatCrime(key))}${toolLine(keepTool(s, toolUsed, 'success', g, u, rng, fx.toolKeep))}`)] });
    }
    if (s.wantedEnabled) clearHeat(g, u); // 捕まったので、手配は解除
    const took = fine(i.guildId, i.user.id, Math.round(r.amount * (1 + fx.fineMult)), s, 'crime');
    jail(i.guildId, i.user.id, c.jail); setCooldown(i.guildId, i.user.id, `crime:${key}`, c.cd);
    await i.reply({ embeds: [card(i, s, RED, `${c.emoji} ${c.name} 失敗…`, `${r.text}\n\n罰金 **- ${money(s, took)}**${debtNote(i, s)}\n🚔 留置場に ${dur(c.jail)} 入ります。(/bail で、保釈金を払って出られます)${starsNow ? '\n-# 捕まったので、指名手配は解除されました' : ''}${toolLine(keepTool(s, toolUsed, 'fail', g, u, rng, fx.toolKeep))}`)] });
  },
};
export const workCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('work').setDescription('バイトをして、給料をもらいます')
    .addStringOption((o) => o.setName('job').setDescription('どのバイトか').setRequired(true).addChoices(...jobChoices))),
  async execute(i, rng = rnd) {
    const s = await open(i); if (!s) return;
    const key = i.options.getString('job', true); const j = jobOf(s, key);
    const jl = jailLeft(i.guildId, i.user.id); if (jl) return refuse(i, `🚔 留置場にいる間は、バイトはできません。(あと ${dur(jl)})`);
    const cd = cooldownLeft(i.guildId, i.user.id, `work:${key}`); if (cd) return refuse(i, `${j.emoji} ${j.name}のシフトは、あと ${dur(cd)} 後です。`);
    if (budgetEmpty(s, i.guildId)) return refuse(i, BUDGET_EMPTY);
    if (j.game) return startRamen(i, s, key, j, rng); // ラーメン屋・配達員・レジ・ケーキ屋・バリスタは、ミニゲーム(給料は、出来栄えで決まる)
    // 警察のバイト: 指名手配中の人が多いほど、ボーナス(犯人逮捕の特別手当)が出やすい
    const wantedCount = key === 'police' && s.wantedEnabled ? topWanted(i.guildId, s.wantedDecayMin, 5, 1000).length : 0;
    const policeBase = jobOf(s, 'police').bonus.chance;
    const boost = Math.max(0, Math.min(POLICE_BONUS_CAP - policeBase, wantedCount * s.policeBonusPerWanted / 100));
    const r = resolveWork(j, rng, boost);
    // 昇進: 階級に応じて、給料の倍率が変わる(オンのサーバーのみ)
    const g = i.guildId, u = i.user.id;
    const before = s.promotionEnabled ? rankFor(s.jobRanks[key], shiftsOf(g, u, key)) : null;
    const pct = before?.rank.pct ?? 100;
    const wmul = 1 + userFx(s, g, u).workPay; // お店の消耗品・ペットの効果
    const salary = Math.round(scalePay(r.pay, pct) * wmul), bonus = r.bonus ? Math.round(scalePay(r.bonus.amount, pct) * wmul) : 0;
    const p = pay(g, u, salary + bonus, s);
    let extra = '';
    if (p.paid > 0) {
      setCooldown(g, u, `work:${key}`, j.cd);
      const n = addShift(g, u, key); // 出勤は、昇進がオフでも数える(あとでオンにしても、積み上がっている)
      if (s.promotionEnabled) {
        const after = rankFor(s.jobRanks[key], n);
        extra = after.index > before.index
          ? `\n\n🎉 **昇進!** 「${after.rank.name}」になりました!(給料 ×${after.rank.pct / 100})`
          : `\n-# ${j.emoji} ${after.rank.name} ・ 出勤 ${n}回${after.next ? `(「${after.next.name}」まで あと ${after.left}回)` : '(最高の階級です)'}`;
      }
    }
    await i.reply({ embeds: [card(i, s, GREEN, `${j.emoji} ${j.name}のバイト`, `${r.text}\n\n給料 **+ ${money(s, salary)}**${pct !== 100 ? ` (階級ボーナス ×${pct / 100})` : ''}${r.bonus ? `\n${r.bonus.text} **+ ${money(s, bonus)}**` : ''}${wantedCount ? `\n-# 🚨 指名手配中が ${wantedCount}人 いて、ボーナスが出る確率は ${Math.round((policeBase + boost) * 100)}% です` : ''}${shortNote(s, p)}${debtNote(i, s)}${extra}`)] });
  },
};
export const jobCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('job').setDescription('バイトの階級と、出勤回数を見ます')),
  async execute(i) {
    const s = await open(i); if (!s) return;
    const shifts = allShifts(i.guildId, i.user.id);
    const fields = Object.entries(JOBS).map(([key, j]) => {
      const n = shifts[key] ?? 0;
      if (!s.promotionEnabled) return { name: `${j.emoji} ${j.name}`, value: `出勤 **${n}回**`, inline: true };
      const ranks = s.jobRanks[key], r = rankFor(ranks, n);
      return { name: `${j.emoji} ${j.name}`, value: `**${r.rank.name}**(給料 ×${r.rank.pct / 100})\n出勤 ${n}回 ${r.next ? `\n次: ${r.next.name}(あと ${r.left}回)` : '\n最高の階級です'}\n-# ${ranks.map((x) => `${x.name}${x.shifts ? ` ${x.shifts}回` : ''}`).join(' → ')}`, inline: true };
    });
    const e = new EmbedBuilder().setColor(0x6d5dfc).setTitle('💼 バイトの階級').addFields(fields)
      .setFooter({ text: s.promotionEnabled ? '出勤を重ねると、昇進して、給料が増えます' : 'このサーバーでは、昇進はオフです(出勤回数は、記録されています)' });
    await i.reply({ embeds: [e], ...EPH });
  },
};
export const begCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('beg').setDescription('道ばたで、お金をめぐんでもらいます')),
  async execute(i, rng = rnd) {
    const s = await open(i); if (!s) return;
    const cd = cooldownLeft(i.guildId, i.user.id, 'beg'); if (cd) return refuse(i, `今日はもう、人通りが少ないようです。あと ${dur(cd)}。`);
    if (budgetEmpty(s, i.guildId)) return refuse(i, BUDGET_EMPTY);
    const bc = begOf(s), r = resolveBeg(rng, bc); setCooldown(i.guildId, i.user.id, 'beg', bc.cd);
    if (!r.amount) return i.reply({ embeds: [card(i, s, GRAY, '🙏 乞食', `${r.text}`)] });
    const begAmount = Math.round(r.amount * (1 + userFx(s, i.guildId, i.user.id).begAmount));
    const p = pay(i.guildId, i.user.id, begAmount, s);
    await i.reply({ embeds: [card(i, s, GREEN, '🙏 乞食', `${r.text}\n\n**+ ${money(s, p.paid)}**${shortNote(s, p)}${debtNote(i, s)}`)] });
  },
};
export const bailCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('bail').setDescription('保釈金を払って、留置場から出ます(残り時間に応じた金額)')),
  async execute(i) {
    const s = await open(i); if (!s) return;
    const jl = jailLeft(i.guildId, i.user.id); if (!jl) return refuse(i, '留置場には、入っていません。');
    const cost = Math.ceil(jl / 60_000) * bailPerMin(s);
    if (!collect(i.guildId, i.user.id, cost, s)) return refuse(i, `保釈金が足りません。(必要 ${money(s, cost)} / 手持ち ${money(s, wallet(i))})`);
    release(i.guildId, i.user.id);
    await i.reply({ embeds: [card(i, s, BLUE, '🔓 保釈', `保釈金 **- ${money(s, cost)}** を払って、留置場から出ました。`)] });
  },
};

/** 管理者が、留置場の人を釈放する(サーバー側の操作)。ダッシュボードを操作できる人(オーナー・管理者・管理ロール・運営)だけ */
export const releaseCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('release').setDescription('【管理者向け】留置場にいる人を釈放します')
    .addUserOption((o) => o.setName('user').setDescription('釈放する人'))
    .addBooleanOption((o) => o.setName('all').setDescription('留置場にいる全員を釈放する'))),
  async execute(i) {
    const s = await open(i); if (!s) return;
    if (!hasAccessSync(i.guild, i.member, i.user.id)) return refuse(i, '釈放できるのは、サーバーの管理者(または管理ロールを持つ人)だけです。');
    if (i.options.getBoolean('all')) {
      const n = releaseAll(i.guildId); audit(i.guildId, { id: i.user.id, name: i.member?.displayName ?? i.user.username }, null, '全員を釈放', null, `${n}人 / /release`);
      return i.reply({ content: n ? `🔓 留置場にいた ${n}人 を、全員釈放しました。` : '留置場には、だれもいません。', allowedMentions: NO_MENTIONS, ...(n ? {} : EPH) });
    }
    const u = i.options.getUser('user');
    if (!u) return refuse(i, '釈放する人(user)を選ぶか、all を選んでください。');
    if (!jailLeft(i.guildId, u.id)) return refuse(i, `${u.displayName ?? u.username} さんは、留置場にいません。`);
    release(i.guildId, u.id); audit(i.guildId, { id: i.user.id, name: i.member?.displayName ?? i.user.username }, u.id, '釈放', null, '/release');
    await i.reply({ content: `🔓 <@${u.id}> を釈放しました。`, allowedMentions: NO_MENTIONS });
  },
};

/* ================= ギャンブル ================= */
export const chinchiroCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('chinchiro').setDescription('チンチロ(親との勝負)')
    .addIntegerOption((o) => o.setName('bet').setDescription('賭け金').setRequired(true).setMinValue(10))),
  async execute(i, rng = rnd) {
    const s = await open(i); if (!s) return;
    const bet = await takeBet(i, s); if (!bet) return;
    collect(i.guildId, i.user.id, bet, s); // 先に賭け金を預ける
    const P = chinchiroPlay(rng), D = chinchiroPlay(rng); const r = chinchiroCompare(P, D);
    const show = (x) => `${x.throws.map((t) => t.map((d) => DICE[d - 1]).join(' ')).join('  →  ')}\n**${x.role.label}**`;
    let title, color, line;
    if (r.result === 'draw') { pay(i.guildId, i.user.id, bet, s); title = '🎲 引き分け'; color = GRAY; line = '賭け金は、そのまま戻ります。'; }
    else if (r.result === 'win') {
      const profit = roundProb(bet * r.mult * chinchiroScale(s.payoutRate), rng); const p = pay(i.guildId, i.user.id, bet + profit, s);
      title = '🎲 勝ち!'; color = GREEN; line = `配当 **+ ${money(s, p.paid - bet)}**(×${r.mult})${shortNote(s, p)}`;
    } else {
      const extra = fine(i.guildId, i.user.id, bet * (r.mult - 1), s, 'gamble'); // 倍払いのぶん(借金を許可していなければ、持っている範囲まで)。返金の対象外
      title = '🎲 負け…'; color = RED; line = `**- ${money(s, bet + extra)}**(×${r.mult})${debtNote(i, s)}`;
    }
    await i.reply({ embeds: [card(i, s, color, title, `**あなた**\n${show(P)}\n\n**親**\n${show(D)}\n\n${line}`)] });
  },
};
export const slotCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('slot').setDescription('スロット(3つ揃うと大当たり)')
    .addIntegerOption((o) => o.setName('bet').setDescription('賭け金').setRequired(true).setMinValue(10))),
  async execute(i, rng = rnd) {
    const s = await open(i); if (!s) return;
    const bet = await takeBet(i, s); if (!bet) return;
    collect(i.guildId, i.user.id, bet, s);
    const reels = slotSpin(rng); const total = slotPayout(reels, bet, s.payoutRate, rng);
    const p = pay(i.guildId, i.user.id, total, s); const net = p.paid - bet;
    const m = slotMultiplier(reels);
    const head = `🎰 ┃ ${reels.join(' ┃ ')} ┃ 🎰`;
    const desc = p.paid === 0 ? `${head}\n\nはずれ… **- ${money(s, bet)}**`
      : net >= 0 ? `${head}\n\n${m >= 5 ? '🎉 **大当たり!** ' : ''}**+ ${money(s, net)}**${net === 0 ? '(賭け金が戻りました)' : ''}${shortNote(s, p)}`
        : `${head}\n\nおしい!半分ほど戻りました。 **- ${money(s, -net)}**${shortNote(s, p)}`;
    await i.reply({ embeds: [card(i, s, p.paid === 0 ? RED : net > 0 ? GOLD : GRAY, '🎰 スロット', desc)] });
  },
};

/* ---------- ブラックジャック ---------- */
const hand = (cards) => cards.map(cardText).join(' ');
function bjEmbed(i, s, st, final) {
  const pv = handValue(st.player).total, dv = handValue(st.dealer).total;
  const e = card(i, s, GREEN, '🃏 ブラックジャック', '');
  e.addFields({ name: `あなた (${pv})`, value: hand(st.player) }, { name: final ? `ディーラー (${dv})` : 'ディーラー', value: final ? hand(st.dealer) : `${cardText(st.dealer[0])} 🂠` });
  return e;
}
const OUTCOME = { blackjack: ['🃏 ブラックジャック!', GOLD], win: ['🃏 勝ち!', GREEN], push: ['🃏 引き分け', GRAY], lose: ['🃏 負け…', RED], bust: ['🃏 バースト…', RED] };
function bjButtons(i, st, s) {
  const id = (a) => `eco:bj:${a}:${i.user.id}`;
  const canDouble = st.player.length === 2 && !st.doubled && wallet(i) >= st.bet;
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id('hit')).setLabel('ヒット').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(id('stand')).setLabel('スタンド').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(id('double')).setLabel('ダブルダウン').setStyle(ButtonStyle.Success).setDisabled(!canDouble))];
}
/** 決着: 配当を払って、ゲームを消す */
function bjFinish(i, s, st) {
  // 還元率の設定: 勝った儲けの部分だけを、係数倍にする(負け・引き分けは、そのまま)
  const payout = st.payout > st.bet ? st.bet + roundProb((st.payout - st.bet) * bjScale(s.payoutRate)) : st.payout;
  const p = pay(i.guildId, i.user.id, payout, s); deleteBj(i.guildId, i.user.id);
  const [title, color] = OUTCOME[st.outcome]; const net = p.paid - st.bet;
  const e = bjEmbed(i, s, st, true).setTitle(title).setColor(color)
    .setDescription(`${net > 0 ? `**+ ${money(s, net)}**` : net === 0 ? '賭け金が戻りました。' : `**- ${money(s, -net)}**`}${st.doubled ? '(ダブルダウン)' : ''}${shortNote(s, p)}`);
  return { embeds: [e], components: [] };
}
export const blackjackCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('blackjack').setDescription('ブラックジャック(ヒット・スタンド・ダブルダウン)')
    .addIntegerOption((o) => o.setName('bet').setDescription('賭け金').setRequired(true).setMinValue(10))),
  async execute(i, rng = rnd) {
    const s = await open(i); if (!s) return;
    if (getBj(i.guildId, i.user.id)) return refuse(i, '進行中のブラックジャックがあります。先に、そちらを終わらせてください。');
    const bet = await takeBet(i, s); if (!bet) return;
    collect(i.guildId, i.user.id, bet, s);
    const st = bjDeal(bet, rng);
    if (st.done) return i.reply(bjFinish(i, s, st)); // 最初の2枚で、決着(ナチュラルブラックジャック)
    saveBj(i.guildId, i.user.id, null, st);          // 先に保存してから返信する(ボタンが先に押されても大丈夫)
    await i.reply({ embeds: [bjEmbed(i, s, st, false)], components: bjButtons(i, st, s) });
    const msg = await i.fetchReply().catch(() => null); if (msg) saveBj(i.guildId, i.user.id, msg.id, st);
  },
};
export const blackjackButton = {
  id: 'eco:bj',
  async execute(i) {
    const [, , action, uid] = i.customId.split(':');
    if (i.user.id !== uid) return i.reply({ content: 'これは、あなたのゲームではありません。`/blackjack` で、自分のゲームを始められます。', ...EPH });
    const s = getSettings(i.guildId);
    const g = getBj(i.guildId, uid);
    if (!g) return safeUpdate(i, { content: 'このゲームは、すでに終了しています。', embeds: [], components: [] });
    if (Date.now() - g.started_at > BJ_TTL) { deleteBj(i.guildId, uid); return safeUpdate(i, { content: '時間切れで、ゲームが終了しました。(賭け金は戻りません)', embeds: [], components: [] }); }
    let st = g.state;
    if (action === 'double') {
      if (st.player.length !== 2 || st.doubled) return i.reply({ content: 'ダブルダウンは、最初の2枚のときだけです。', ...EPH });
      if (!collect(i.guildId, uid, st.bet, s)) return i.reply({ content: `ダブルダウンの賭け金が足りません。(必要 ${money(s, st.bet)})`, ...EPH });
      st = bjDouble(st);
    } else if (action === 'hit') st = bjHit(st);
    else if (action === 'stand') st = bjStand(st);
    else return;
    if (st.done) return safeUpdate(i, bjFinish(i, s, st));
    saveBj(i.guildId, uid, g.msg_id, st);
    await safeUpdate(i, { embeds: [bjEmbed(i, s, st, false)], components: bjButtons(i, st, s) });
  },
};

/* ================= ラーメン屋のバイト(ミニゲーム) ================= */
const STEP_LABEL = { soup: 'スープ', noodle: '麺の茹で時間', topping: 'トッピング', fire: '火加減', spice: '辛さ', address: '宛名', load: '積み込み', change: 'お釣り', wrap: '包み方', stairs: '階段', ice: '氷・保冷剤', sum: '合計', coupon: 'クーポン', tax: '税込み', points: 'ポイント', flavor: 'スポンジ', candles: 'ろうそく', berries: 'いちご', plate: 'プレート', cut: '切り分け', drink: 'レシピ', ratio: 'ミルク', steam: 'スチーム', syrup: 'シロップ' };
const stepLabel = (s) => (s.bonus ? (s.kind === 'noodle' ? '替え玉' : 'おまけ') : STEP_LABEL[s.kind] ?? s.kind);
/** そのバイトの、注文の種類(ラーメンの種類・お仕事の種類)と、タイトル */
const gameInfo = (order) => (order.game ? { T: variantOf(order.game, order.type), title: `${SHIFT_GAMES[order.game].emoji} ${SHIFT_GAMES[order.game].title}`, label: (v) => `${v.emoji} ${v.name}` } : { T: RAMEN[order.type], title: '🍜 ラーメン屋のバイト', label: (v) => `${v.emoji} ${v.name}` });
const rmColor = { gold: GOLD, green: GREEN, gray: GRAY, red: RED };
function rmBody(st, deadline, uid, note = '') {
  const { T, title } = gameInfo(st.order), step = st.order.steps[st.idx], total = st.order.steps.length;
  const done = st.results.map((ok, n) => `${ok ? '✅' : '❌'} ${stepLabel(st.order.steps[n])}`).join('  ');
  const e = new EmbedBuilder().setColor(BLUE).setTitle(`${title} — ${T.emoji} ${T.name}`).setAuthor({ name: st.name, iconURL: st.avatar })
    .setDescription(`**${T.gimmick}**: ${T.gimmickText}\n制限時間: <t:${Math.floor(deadline / 1000)}:R> まで ・ 工程 **${st.idx + 1} / ${total}**${done ? `\n${done}` : ''}${note ? `\n${note}` : ''}\n\n${step.prompt}`);
  const row = new ActionRowBuilder().addComponents(step.options.map((label, k) => new ButtonBuilder().setCustomId(`eco:rm:${uid}:${st.idx}:${k}`).setLabel(label).setStyle(ButtonStyle.Secondary)));
  return { embeds: [e], components: [row] };
}
async function startRamen(i, s, key, j, rng) {
  const g = i.guildId, u = i.user.id, shift = isShiftGame(key), rc = shift ? shiftCfg(s) : ramenCfg(s), fx = userFx(s, g, u);
  const old = getRamen(g, u);
  if (old) { if (Date.now() <= old.deadline + 30_000) return refuse(i, '進行中のバイトがあります。先に、そちらを仕上げてください。'); claimRamen(g, u); } // 放置されたものは、給料なしで片付ける
  const st = { job: key, order: shift ? makeShift(key, rng) : makeOrder(rng), idx: 0, results: [], base: Math.round((j.pay[0] + Math.floor(rng() * (j.pay[1] - j.pay[0] + 1))) * (1 + fx.workPay)), name: i.member?.displayName ?? i.user.username, avatar: i.user.displayAvatarURL?.() };
  const deadline = (i.createdTimestamp ?? Date.now()) + Math.round(rc.timeMs * (1 + fx.ramenTime)); // コマンドを打った時刻から数える(BOTの処理の遅れで、短くならない)
  setCooldown(g, u, `work:${key}`, j.cd);
  saveRamen(g, u, st, deadline); // 先に保存してから返信する
  try { await i.reply(rmBody(st, deadline, u)); }
  catch (e) { claimRamen(g, u); setCooldown(g, u, `work:${key}`, 0); throw e; } // 画面を出せなかったときは、働いていないので、待ち時間もなし
}
export const ramenButton = {
  id: 'eco:rm',
  async execute(i) {
    const [, , uid, idxS, kS] = i.customId.split(':');
    if (i.user.id !== uid) return i.reply({ content: 'これは、あなたの注文ではありません。`/work` で、自分のバイトを始められます。', ...EPH });
    const g = i.guildId, s = getSettings(g);
    const game = getRamen(g, uid);
    if (!game) return safeUpdate(i, { content: 'このバイトは、すでに終了しています。', embeds: [], components: [] });
    const st = game.state, jobKey = st.job ?? 'ramen', now = i.createdTimestamp ?? Date.now();
    const expired = now > game.deadline + CLICK_GRACE; // 制限時間を過ぎてから押された → いまの出来で、仕上げる
    let note = '';
    if (!expired) {
      if (Number(idxS) !== st.idx) return i.reply({ content: 'その工程は、すでに終わっています。', ...EPH });
      const step = st.order.steps[st.idx], ok = Number(kS) === step.answer;
      st.results[st.idx] = ok; if (!ok) st.wrongs = [...(st.wrongs ?? []), { n: st.idx, answer: step.options[step.answer] }];
      note = ok ? '✅ 正解!' : `❌ 違った… 正解は **${step.options[step.answer]}**`;
      st.idx++;
    }
    if (expired || st.idx >= st.order.steps.length) {
      const claimed = claimRamen(g, uid); // 取れたときだけ精算する(二重に給料が出ない)
      if (!claimed) return safeUpdate(i, { content: 'このバイトは、すでに終了しています。', embeds: [], components: [] });
      const j = jobOf(s, jobKey), { T } = gameInfo(st.order), shift = isShiftGame(jobKey);
      const res = shift ? gradeShift(st.order, st.results, st.base, Math.max(0, game.deadline - now), shiftCfg(s)) : gradeRamen(st.order, st.results, st.base, Math.max(0, game.deadline - now), ramenCfg(s)), grade = (shift ? SHIFT_GRADES : GRADES)[res.grade];
      const before = s.promotionEnabled ? rankFor(s.jobRanks[jobKey], shiftsOf(g, uid, jobKey)) : null, pct = before?.rank.pct ?? 100;
      const amount = scalePay(res.amount, pct), p = pay(g, uid, amount, s);
      let extra = '';
      if (p.paid > 0) {
        const n = addShift(g, uid, jobKey);
        if (s.promotionEnabled) {
          const after = rankFor(s.jobRanks[jobKey], n);
          extra = after.index > before.index ? `\n\n🎉 **昇進!** 「${after.rank.name}」になりました!(給料 ×${after.rank.pct / 100})` : `\n-# ${j.emoji} ${after.rank.name} ・ 出勤 ${n}回${after.next ? `(「${after.next.name}」まで あと ${after.left}回)` : '(最高の階級です)'}`;
        }
      }
      const lines = st.order.steps.map((s2, n) => `${st.results[n] ? '✅' : '❌'} ${stepLabel(s2)}${!st.results[n] && s2.options ? `(正解: ${s2.options[s2.answer]})` : ''}`).join('\n');
      const e = new EmbedBuilder().setColor(rmColor[grade.color]).setTitle(`${T.emoji} ${T.name} — ${grade.label}`).setAuthor({ name: st.name, iconURL: st.avatar })
        .setDescription(`${expired ? '⏰ 時間切れ! 答えていない工程は、不正解です。\n\n' : ''}${lines}\n\n給料 **+ ${money(s, amount)}**${pct !== 100 ? ` (階級ボーナス ×${pct / 100})` : ''}${res.notes.length ? `\n${res.notes.map((x) => `✨ ${x}`).join('\n')}` : ''}${shortNote(s, p)}${extra}`)
        .setFooter({ text: `所持金 ${money(s, peek(g, uid).wallet)}` });
      return safeUpdate(i, { embeds: [e], components: [] });
    }
    saveRamen(g, uid, st, game.deadline);
    await safeUpdate(i, rmBody(st, game.deadline, uid, note));
  },
};

/* ================= 大型銀行強盗(ミニゲーム) ================= */
/** 失敗の精算(罰金と留置場)。claim できたときだけ精算するので、二重に罰金が引かれない。精算したら、そのゲームを返す */
function settleHeistFailure(g, u, s, reason, rng = rnd) {
  const game = claimHeist(g, u); if (!game) return null;
  const T = heistOf(s, game.state?.target);
  // 時間切れ(制限時間を過ぎた・放置した)は、設定の割合(初期値 100% = 失敗と同じ)で、罰を軽くできる。0% なら、罰なしの撤退
  const tc = reason === 'timeout' ? timeoutCfg(s) : { finePct: 1, jailPct: 1 };
  const limit = game.state?.limit ?? T.maxMistakes;
  const fineAmount = Math.round(heistFine(rng, T) * tc.finePct * (1 + (game.state?.fineMult ?? 0))), jailMs = Math.round(T.jail * tc.jailPct);
  const took = fineAmount > 0 ? fine(g, u, fineAmount, s, 'heist') : 0;
  if (jailMs > 0) jail(g, u, jailMs);
  clearHeat(g, u); // 捕まった(撤退した)ので、手配は解除
  const toolBack = keepTool(s, game.state?.tool ? itemById(game.state.tool) : null, reason === 'timeout' ? 'timeout' : 'fail', g, u, rng, game.state?.toolKeep ?? 0); // 使った道具を、持ち帰れることがある
  return { game, took, reason, T, jailMs, toolBack, limit };
}
const reasonText = (T, reason, limit = T.maxMistakes) => (reason === 'timeout' ? `⏰ 時間切れ! ${T.caught}` : `🚨 ${limit + 1}回間違えて、警報が鳴り響いた!`);
const failEmbed = (s, name, r) => new EmbedBuilder().setColor(RED).setTitle(`${r.T.emoji} ${r.T.name} ${r.took || r.jailMs ? '失敗…' : '撤退'}`)
  .setDescription(`${reasonText(r.T, r.reason, r.limit)}\n\n${r.took || r.jailMs ? `罰金 **- ${money(s, r.took)}**${r.jailMs ? `\n🚔 留置場に ${dur(r.jailMs)} 入ります。(/bail で、保釈金を払って出られます)` : ''}` : '報酬は、ありません。(罰金も、留置場も、ありません)'}${toolLine(r.toolBack)}`).setAuthor({ name });
const hsStatus = (st, deadline, T) => {
  const left = (st.limit ?? T.maxMistakes) - st.mistakes;
  return `制限時間: <t:${Math.floor(deadline / 1000)}:R> まで ・ ステップ **${st.idx + 1} / ${st.steps.length}** ・ 間違えられるのは あと **${left}回**`;
};
function hsBody(st, deadline, uid, T, warn = '') {
  const step = st.steps[st.idx];
  const e = new EmbedBuilder().setColor(BLUE).setTitle(`${T.emoji} ${T.name}`).setAuthor({ name: st.name, iconURL: st.avatar })
    .setDescription(`${hsStatus(st, deadline, T)}\n\n${warn ? `${warn}\n\n` : ''}${step.prompt}`);
  const row = new ActionRowBuilder().addComponents(step.options.map((label, k) =>
    new ButtonBuilder().setCustomId(`eco:hs:${uid}:${st.idx}:${k}`).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(st.wrong.includes(k))));
  return { embeds: [e], components: [row] };
}
export const heistCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('heist').setDescription('大型犯罪(ミニゲーム。制限時間内に、すべての問題を解けば成功)')
    .addStringOption((o) => o.setName('target').setDescription('狙う場所(省略すると大型銀行)')
      .addChoices(...Object.values(HEISTS).map((T) => ({ name: `${T.emoji} ${T.name}(${T.blurb})`, value: T.id }))))),
  async execute(i, rng = rnd) {
    const s = await open(i); if (!s) return;
    const g = i.guildId, u = i.user.id;
    const T = heistOf(s, i.options.getString?.('target') ?? 'bank'), key = heistKey(T.id);
    const jl = jailLeft(g, u); if (jl) return refuse(i, `🚔 留置場にいる間は、犯罪はできません。(あと ${dur(jl)})`);
    const w = wallet(i); if (w <= 0) return refuse(i, `💸 所持金が0以下のときは、犯罪はできません。(いまの所持金 ${money(s, w)})`);
    if (getHeist(g, u)) return refuse(i, '進行中の強盗があります。先に、そちらを終わらせてください。');
    const cd = cooldownLeft(g, u, key); if (cd) return refuse(i, `${T.emoji} ${T.short}は、まだ警備が厳重です。あと ${dur(cd)}。`);
    if (budgetEmpty(s, g)) return refuse(i, BUDGET_EMPTY);
    const toolUsed = takeTool(i, s, 'heist', T.id); if (toolUsed === false) return; // 闇マーケットがオンのとき、道具が必要
    const fx = userFx(s, g, u); // お店の消耗品・ペットの効果(時間・ミスの許容・罰金・道具の持ち帰り)
    const st = { target: T.id, tool: toolUsed?.id ?? null, limit: Math.max(0, T.maxMistakes + fx.heistMistakes), fineMult: fx.fineMult, toolKeep: fx.toolKeep, steps: makeSteps(rng, T.steps, T.makers), idx: 0, mistakes: 0, wrong: [], reward: Math.round(heistBase(rng, T) * Math.max(0, 1 + fx.heistReward)), name: i.member?.displayName ?? i.user.username, avatar: i.user.displayAvatarURL?.() };
    const deadline = (i.createdTimestamp ?? Date.now()) + Math.max(10_000, Math.round(T.timeMs * (1 + fx.heistTime))); // コマンドを打った時刻から数える(BOTの処理の遅れで、短くならない)
    setCooldown(g, u, key, T.cd);
    saveHeist(g, u, { channelId: i.channelId, state: st, deadline });  // 先に保存してから返信する
    try { await i.reply(hsBody(st, deadline, u, T)); }
    catch (e) { claimHeist(g, u); setCooldown(g, u, key, 0); if (toolUsed) addItem(g, u, toolUsed.id, 1); throw e; } // 画面を出せなかったときは、遊んでいないので、罰を受けない
    const msg = await i.fetchReply().catch(() => null);
    if (msg) saveHeist(g, u, { channelId: i.channelId, msgId: msg.id, state: st, deadline });
  },
};
export const heistButton = {
  id: 'eco:hs',
  async execute(i) {
    const [, , uid, idxS, kS] = i.customId.split(':');
    if (i.user.id !== uid) return i.reply({ content: 'これは、あなたの強盗ではありません。`/heist` で、自分で挑戦できます。', ...EPH });
    const g = i.guildId, s = getSettings(g);
    const game = getHeist(g, uid);
    if (!game) return safeUpdate(i, { content: 'この強盗は、すでに終了しています。', embeds: [], components: [] });
    const st = game.state, T = heistOf(s, st.target);
    const now = i.createdTimestamp ?? Date.now(); // ボタンを押した時刻(Discordの記録)。BOTの処理が遅れても、押した時刻で判定する
    if (now > game.deadline + CLICK_GRACE) { // 制限時間を過ぎてから、押された
      const r = settleHeistFailure(g, uid, s, 'timeout');
      return safeUpdate(i, r ? { embeds: [failEmbed(s, st.name, r)], components: [] } : { content: 'この強盗は、すでに終了しています。', embeds: [], components: [] });
    }
    if (Number(idxS) !== st.idx) return i.reply({ content: 'その問題は、すでに終わっています。', ...EPH });
    // 押してから届くまでの遅れ(BOT側のネットワークの遅れ)の分だけ、制限時間を延ばす。画面の更新も遅れるので、そうしないと、プレイヤーが不利になる
    const lag = Math.max(0, Date.now() - now);
    if (lag > 1500) { game.deadline += Math.min(lag, LAG_COMPENSATION_MAX); setHeistDeadline(g, uid, game.deadline); }
    const step = st.steps[st.idx], k = Number(kS);
    if (k === step.answer) {
      st.idx++; st.wrong = [];
      if (st.idx >= st.steps.length) { // 全ステップ突破 → 成功
        if (!claimHeist(g, uid)) return safeUpdate(i, { content: 'この強盗は、すでに終了しています。', embeds: [], components: [] });
        const left = Math.max(0, game.deadline - now), amount = heistReward(st.reward, left, T);
        const p = pay(g, uid, amount, s);
        return safeUpdate(i, { embeds: [new EmbedBuilder().setColor(GOLD).setTitle(`${T.emoji} ${T.name} 成功!`).setAuthor({ name: st.name, iconURL: st.avatar })
          .setDescription(`${T.success}\n残り ${dur(left)} でクリア(スピードボーナス +${Math.round((amount / st.reward - 1) * 100)}%)\n\n**+ ${money(s, p.paid)}**${shortNote(s, p)}${wantedLine(s, g, uid, wantedCfg(s).heatHeist(T.id))}${toolLine(keepTool(s, st.tool ? itemById(st.tool) : null, 'success', g, uid, rnd, st.toolKeep ?? 0))}`)], components: [] });
      }
      saveHeist(g, uid, { state: st, deadline: game.deadline });
      return safeUpdate(i, hsBody(st, game.deadline, uid, T));
    }
    st.mistakes++; st.wrong.push(k);
    if (st.mistakes > (st.limit ?? T.maxMistakes)) { // 警報
      const r = settleHeistFailure(g, uid, s, 'alarm');
      return safeUpdate(i, r ? { embeds: [failEmbed(s, st.name, r)], components: [] } : { content: 'この強盗は、すでに終了しています。', embeds: [], components: [] });
    }
    saveHeist(g, uid, { state: st, deadline: game.deadline });
    await safeUpdate(i, hsBody(st, game.deadline, uid, T, '⚠️ 違う! 警報が鳴りかけた…'));
  },
};
/** 制限時間を過ぎたまま放置された強盗を、失敗にする(罰金・留置場)。画面も、できれば更新する */
let lastSweep = Date.now();
export async function resolveExpiredHeists(client, now = Date.now()) {
  const drift = now - lastSweep - 15_000; lastSweep = now;       // 巡回が、予定より大きく遅れた = BOTが止まっていた
  if (drift > 5_000) holdHeistSweep(SWEEP_GRACE, now);           // 止まっていた直後は、遅れて届くボタンを待つ
  if (now < holdSweepUntil) return;
  for (const row of expiredHeists(now - SWEEP_GRACE)) {
    try {
      const s = getSettings(row.guild_id);
      const before = getHeist(row.guild_id, row.user_id);
      const r = settleHeistFailure(row.guild_id, row.user_id, s, 'timeout');
      if (!r) continue;
      console.log(`[economy] 放置された大型銀行強盗を、失敗にしました (${row.guild_id})`);
      if (before?.channel_id && before?.msg_id) {
        const ch = await client.channels.fetch(before.channel_id).catch(() => null);
        await ch?.messages?.edit?.(before.msg_id, { embeds: [failEmbed(s, before.state.name, r)], components: [] }).catch(() => {});
      }
    } catch (e) { console.warn('[economy] 強盗の精算に失敗:', e.message); }
  }
}

/** 残高の編集は、ダッシュボードと同じく、オーナー・管理者・運営だけ(管理ロールは不可) */
const canEditBalance = (i) => isOperator(i.user.id) || i.guild?.ownerId === i.user.id || !!i.member?.permissions?.has?.(PermissionFlagsBits.Administrator);
const MODE_LABEL = { add: '増やす', subtract: '減らす', set: '指定額にする' };
export const balanceEditCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('balance-edit').setDescription('【管理者向け】メンバーの残高を編集します')
    .addUserOption((o) => o.setName('user').setDescription('対象の人').setRequired(true))
    .addStringOption((o) => o.setName('mode').setDescription('操作').setRequired(true).addChoices({ name: '増やす', value: 'add' }, { name: '減らす', value: 'subtract' }, { name: '指定額にする', value: 'set' }))
    .addIntegerOption((o) => o.setName('amount').setDescription('金額(0以上)').setRequired(true).setMinValue(0).setMaxValue(1_000_000_000))
    .addStringOption((o) => o.setName('target').setDescription('対象の残高(省略すると手持ち)').addChoices({ name: '手持ち', value: 'wallet' }, { name: '銀行', value: 'bank' }))
    .addStringOption((o) => o.setName('note').setDescription('メモ(操作履歴に残ります)').setMaxLength(100))),
  async execute(i) {
    const s = getSettings(i.guildId);
    if (!canEditBalance(i)) return refuse(i, '残高を編集できるのは、サーバーのオーナー・管理者だけです。');
    const u = i.options.getUser('user');
    if (u.bot) return refuse(i, 'BOTの残高は編集できません。');
    const mode = i.options.getString('mode'), target = i.options.getString('target') ?? 'wallet', amount = i.options.getInteger('amount'), note = i.options.getString('note');
    const col = target === 'bank' ? 'bank' : 'wallet';
    const before = peek(i.guildId, u.id);
    const after = adjustBalance(i.guildId, u.id, { target, mode, amount, allowDebt: s.allowDebt });
    audit(i.guildId, { id: i.user.id, name: i.member?.displayName ?? i.user.username }, u.id, `${target === 'bank' ? '銀行' : '手持ち'}を${MODE_LABEL[mode]}`, amount, `${before[col]} → ${after[col]}${note ? ` / ${note}` : ''} / /balance-edit`);
    await i.reply({ content: `✅ <@${u.id}> の${target === 'bank' ? '銀行' : '手持ち'}を${MODE_LABEL[mode]}(${Number(amount).toLocaleString()})\n${money(s, before[col])} → **${money(s, after[col])}**`, allowedMentions: NO_MENTIONS, ...EPH });
  },
};

const CD_LABEL = { all: 'すべて', crime: '犯罪', work: 'バイト', beg: '乞食', heist: '大型犯罪' };
export const cooldownResetCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('cooldown-reset').setDescription('【管理者向け】メンバーのクールダウンを解除します')
    .addUserOption((o) => o.setName('user').setDescription('対象の人').setRequired(true))
    .addStringOption((o) => o.setName('kind').setDescription('解除するもの(省略するとすべて)').addChoices(...Object.entries(CD_LABEL).map(([value, name]) => ({ name, value }))))),
  async execute(i) {
    if (!canEditBalance(i)) return refuse(i, 'クールダウンを解除できるのは、サーバーのオーナー・管理者だけです。');
    const u = i.options.getUser('user'), kind = i.options.getString('kind') ?? 'all';
    const n = clearCooldowns(i.guildId, u.id, kind);
    audit(i.guildId, { id: i.user.id, name: i.member?.displayName ?? i.user.username }, u.id, `クールダウン解除(${CD_LABEL[kind]})`, null, `${n}件 / /cooldown-reset`);
    await i.reply({ content: n ? `✅ <@${u.id}> のクールダウン(${CD_LABEL[kind]})を、${n}件 解除しました。` : `<@${u.id}> には、解除するクールダウンがありません。`, allowedMentions: NO_MENTIONS, ...EPH });
  },
};

export const payCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('pay').setDescription('手持ちのお金を、他のメンバーに送金します')
    .addUserOption((o) => o.setName('user').setDescription('送る相手').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('金額').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000))),
  async execute(i) {
    const s = await open(i); if (!s) return;
    const to = i.options.getUser('user'), amount = i.options.getInteger('amount');
    if (to.bot) return refuse(i, 'BOTには送金できません。');
    if (to.id === i.user.id) return refuse(i, '自分自身には送金できません。');
    if (jailLeft(i.guildId, i.user.id)) return refuse(i, '留置場にいる間は、送金できません。');
    const w = wallet(i);
    if (w < amount) return refuse(i, `手持ちが足りません。(手持ち ${money(s, Math.max(0, w))})\n-# 銀行にあるお金は、/withdraw で引き出せます`);
    if (!transfer(i.guildId, i.user.id, to.id, amount)) return refuse(i, '手持ちが足りません。');
    audit(i.guildId, { id: i.user.id, name: i.member?.displayName ?? i.user.username }, to.id, '送金', amount, '/pay');
    await i.reply({ content: `💸 <@${i.user.id}> が <@${to.id}> に **${money(s, amount)}** を送金しました。\n-# あなたの手持ち: ${money(s, wallet(i))}`, allowedMentions: { users: [to.id] } });
  },
};

/* ================= 闇マーケット ================= */
export const marketCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('market').setDescription('闇マーケット(犯罪・大型犯罪に使う道具を買います)')
    .addSubcommand((c) => c.setName('list').setDescription('今日の相場と、持っている道具を見ます').addStringOption(searchOpt).addBooleanOption((o) => o.setName('public').setDescription('全員に表示する(省略すると自分だけ)')))
    .addSubcommand((c) => c.setName('buy').setDescription('道具を買います')
      .addStringOption((o) => o.setName('item').setDescription('買う道具').setRequired(true).addChoices(...ITEMS.map((x) => ({ name: `${x.emoji} ${x.name}(${x.desc})`, value: x.id }))))
      .addIntegerOption((o) => o.setName('amount').setDescription('個数(省略すると1)').setMinValue(1).setMaxValue(9999)))),
  async execute(i) {
    const s = await open(i); if (!s) return;
    if (!s.blackMarket) return refuse(i, 'このサーバーでは、闇マーケットはオフです。管理者が、ダッシュボードの「通貨」でオンにできます。');
    const g = i.guildId, u = i.user.id;
    if (i.options.getSubcommand() === 'list') {
      const own = allItems(g, u);
      const mc = marketCfg(s);
      const field = (x) => { const r = marketRate(g, x.id, undefined, mc.range); return { name: `${x.emoji} ${x.name}`, value: `**${money(s, priceOf(g, itemOf(s, x), undefined, mc.range))}** ${r < 0.95 ? '📉 安い' : r > 1.15 ? '📈 高い' : ''}\n${x.desc} ・ 所持 **${own[x.id] ?? 0}**`, inline: true }; };
      const match = matcher(i), pick = (kind, label) => ITEMS.filter((x) => x.kind === kind && match(x.name, x.desc, label));
      const crimes = pick('crime', '犯罪'), heists = pick('heist', '大型犯罪');
      if (!crimes.length && !heists.length) return noMatch(i);
      const e = new EmbedBuilder().setColor(0x2b2d31).setTitle('🕶️ 闇マーケット')
        .setDescription(`犯罪・大型犯罪には、それぞれ専用の道具が必要です。**1回の挑戦で、1つ使います**(成功でも失敗でも)。\n\`/market buy\` で買えます。値段は、毎日少し変わります(闇相場)。`)
        .addFields(...(crimes.length ? [{ name: '犯罪', value: '\u200b' }, ...crimes.map(field)] : []), ...(heists.length ? [{ name: '大型犯罪(/heist)', value: '\u200b' }, ...heists.map(field)] : []))
        .setFooter({ text: `手持ち: ${wallet(i).toLocaleString()} ・ 1種類につき、最大${mc.maxStack}個まで` });
      return i.reply({ embeds: [e], ...vis(i) });
    }
    const item = itemById(i.options.getString('item', true)), n = i.options.getInteger('amount') ?? 1;
    if (!item) return refuse(i, 'その道具は、売っていません。');
    const mc = marketCfg(s), have = itemQty(g, u, item.id);
    if (have + n > mc.maxStack) return refuse(i, `${item.emoji} ${item.name}は、最大${mc.maxStack}個までしか持てません。(いま ${have}個)`);
    const price = priceOf(g, itemOf(s, item), undefined, mc.range), total = price * n;
    if (!collect(g, u, total, s)) return refuse(i, `お金が足りません。(必要 ${money(s, total)} / 手持ち ${money(s, Math.max(0, wallet(i)))})`);
    addItem(g, u, item.id, n);
    await i.reply({ embeds: [card(i, s, 0x2b2d31, '🕶️ 闇マーケット', `${item.emoji} **${item.name}** を **${n}個** 買いました。\n**- ${money(s, total)}**(1個 ${money(s, price)})\n所持: **${have + n}個**`)], ...EPH });
  },
};

/** 【管理者向け】進行中のブラックジャックを、強制的に終わらせる(止まったゲームの後始末)。既定は、賭け金を返す */
export const blackjackEndCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('blackjack-end').setDescription('【管理者向け】進行中のブラックジャックを、強制的に終了します')
    .addUserOption((o) => o.setName('user').setDescription('終了させる人'))
    .addBooleanOption((o) => o.setName('all').setDescription('進行中のゲームを、このサーバーの全員ぶん終了する'))
    .addBooleanOption((o) => o.setName('refund').setDescription('賭け金を返す(省略すると返す。オフなら、負け扱いで返さない)'))),
  async execute(i) {
    const s = getSettings(i.guildId);
    if (!canEditBalance(i)) return refuse(i, '強制終了できるのは、サーバーのオーナー・管理者だけです。');
    const user = i.options.getUser('user'), all = i.options.getBoolean('all'), refund = i.options.getBoolean('refund') ?? true;
    if (!user && !all) return refuse(i, '終了させる人(user)を選ぶか、all を選んでください。');
    const g = i.guildId, targets = all ? allBj(g).map((r) => r.user_id) : [user.id];
    let ended = 0, returned = 0;
    for (const uid of targets) {
      const game = claimBj(g, uid); if (!game) continue; // 取れたときだけ精算するので、二重に返金されない
      ended++;
      if (refund && game.state.bet > 0) { returned += pay(g, uid, game.state.bet, s).paid; } // 予算がオンなら、予算から返す(足りなければ、ある分だけ)
    }
    if (!ended) return refuse(i, all ? '進行中のブラックジャックは、ありません。' : `<@${user.id}> には、進行中のブラックジャックがありません。`);
    audit(g, { id: i.user.id, name: i.member?.displayName ?? i.user.username }, all ? null : user.id, 'ブラックジャックを強制終了', returned || null, `${ended}件 / ${refund ? '賭け金を返金' : '返金なし'} / /blackjack-end`);
    await i.reply({ content: `🛑 ブラックジャックを強制終了しました。(${ended}件${refund ? ` / 賭け金 ${money(s, returned)} を返金` : ' / 返金なし'})`, allowedMentions: NO_MENTIONS, ...EPH });
  },
};

/* ================= クールダウン一覧 ================= */
export const cooldownsCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('cooldowns').setDescription('犯罪・バイト・乞食・大型犯罪などの、待ち時間の一覧を見ます')
    .addBooleanOption((o) => o.setName('public').setDescription('全員に表示する(省略すると自分だけ)'))),
  async execute(i) {
    const s = await open(i); if (!s) return;
    const g = i.guildId, u = i.user.id, now = Date.now();
    // いまできる: ✅ / あと何分: ⏳ + その時刻(Discordの相対表示)
    const line = (label, left) => (left > 0 ? `⏳ ${label} — あと **${dur(left)}**(<t:${Math.floor((now + left) / 1000)}:R>)` : `✅ ${label}`);
    const jl = jailLeft(g, u);
    const fields = [
      { name: '🚨 犯罪', value: Object.entries(CRIMES).map(([k, c]) => line(`${c.emoji} ${c.name}`, cooldownLeft(g, u, `crime:${k}`))).join('\n') },
      { name: '💼 バイト', value: Object.entries(JOBS).map(([k, j]) => line(`${j.emoji} ${j.name}`, cooldownLeft(g, u, `work:${k}`))).join('\n') },
      { name: '🙏 乞食', value: line('乞食', cooldownLeft(g, u, 'beg')) },
      { name: '🏦 大型犯罪', value: Object.values(HEISTS).map((T) => line(`${T.emoji} ${T.short}`, cooldownLeft(g, u, heistKey(T.id)))).join('\n') },
    ];
    if (s.petsEnabled && getPets(g, u).length) fields.push({ name: '🐾 ペット', value: getPets(g, u).slice(0, 8).map((p, n) => `**${n + 1}. ${p.name}**\n${line('🍖 餌', cooldownLeft(g, u, `pet:feed:${p.id}`))}\n${line('🎾 遊び', cooldownLeft(g, u, `pet:play:${p.id}`))}`).join('\n').slice(0, 1024) }); // ペットごとに、名前の行と、餌・遊びの行を、分ける(横に並べると、途中で折り返して、読みにくい)
    if (s.shopEnabled) { // お店の品(飲み物・タバコなど)の、効果が続く時間(枠ごと)
      const act = Object.fromEntries(activeStatuses(g, u, now).map((x) => [x.slot, x]));
      fields.push({ name: '🏪 お店の品の効果', value: Object.entries(SLOTS).map(([slot, label]) => { const st = act[slot], it = st && shopById(s, st.item);
        return it ? `${it.emoji} **${it.name}**(${label}枠) — あと **${dur(st.until - now)}**(<t:${Math.floor(st.until / 1000)}:R>)\n-# ${itemText(it)}` : `▫️ ${label}枠 — 効いている品は、ありません`; }).join('\n').slice(0, 1024) });
    }
    if (s.wantedEnabled) {
      const wc = wantedCfg(s), heat = getHeat(g, u, s.wantedDecayMin), n = starsOf(heat, wc.heatPerStar);
      fields.push({ name: '👮 指名手配', value: `${line('逮捕(/arrest)', cooldownLeft(g, u, 'arrest'))}\n${n ? `${starText(n)} あなたは **指名手配 Lv${n}** です(手配度 ${heat})` : `手配されていません(手配度 ${heat})`}` });
    }
    const ready = fields.flatMap((f) => f.value.split('\n')).filter((x) => x.startsWith('✅')).length;
    const e = new EmbedBuilder().setColor(jl ? RED : BLUE).setTitle('⏱️ クールダウン一覧').addFields(fields)
      .setDescription(jl ? `🚔 **留置場にいます**(あと ${dur(jl)})。犯罪・バイトなどは、出てからです。\`/bail\` で保釈できます。` : `いま使えるものは **${ready}件** です。`)
      .setFooter({ text: `所持金 ${money(s, wallet(i))}` });
    await i.reply({ embeds: [e], ...(i.options.getBoolean('public') ? {} : EPH) });
  },
};

/* ================= お店(タバコ・アルコールなど。品は、サーバーごとに自由に変えられる) ================= */
const shopOff = (i) => refuse(i, 'このサーバーでは、お店はオフです。管理者が、ダッシュボードの「通貨 → お店・ペット・株など」でオンにできます。');
const shopNumber = (s, i) => { const items = shopItems(s), n = i.options.getInteger('item', true); return { items, it: items[n - 1] ?? null, n }; };
export const shopCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('shop').setDescription('お店(タバコ・お酒など。使うと、しばらく効果がつきます)')
    .addSubcommand((c) => c.setName('list').setDescription('品物と、いま効いている効果を見ます').addStringOption(searchOpt).addBooleanOption((o) => o.setName('public').setDescription('全員に表示する(省略すると自分だけ)')))
    .addSubcommand((c) => c.setName('buy').setDescription('買います')
      .addIntegerOption((o) => o.setName('item').setDescription('品の番号(/shop list の番号)').setRequired(true).setMinValue(1).setMaxValue(MAX_SHOP_ITEMS))
      .addIntegerOption((o) => o.setName('amount').setDescription('個数(省略すると1)').setMinValue(1).setMaxValue(SHOP_MAX_STACK)))),
  async execute(i) {
    const s = await open(i); if (!s) return;
    if (!s.shopEnabled) return shopOff(i);
    const g = i.guildId, u = i.user.id, now = Date.now(), own = allItems(g, u);
    if (i.options.getSubcommand() === 'list') {
      const items = shopItems(s), active = activeStatuses(g, u, now), match = matcher(i), shown = items.map((it, n) => ({ it, n })).filter(({ it }) => match(it.name, it.desc, SLOTS[it.slot], itemText(it))); // 番号は、絞り込んでも、変わらない
      if (!shown.length) return noMatch(i);
      const head = active.length ? active.map((st) => { const it = shopById(s, st.item); return it ? `${it.emoji} **${it.name}** の効果: あと ${dur(st.until - now)}` : null; }).filter(Boolean).join('\n') || 'いま効いている効果は、ありません。' : 'いま効いている効果は、ありません。';
      const e = new EmbedBuilder().setColor(0xb8860b).setTitle('🏪 お店')
        .setDescription(`${head}\n\n\`/shop buy\` で買って(番号で選びます)、\`/use\` で使います。同じ枠(${Object.values(SLOTS).join('・')})の品は、同時に1つだけ効きます(もう一度使うと、上書き)。`)
        .addFields(shown.map(({ it, n }) => ({ name: `${n + 1}. ${it.emoji} ${it.name}(${SLOTS[it.slot]}枠)`, value: `**${money(s, it.price)}** ・ ${it.minutes}分 ・ 所持 **${own[it.id] ?? 0}**\n${itemText(it)}${it.desc ? `\n-# ${it.desc}` : ''}`, inline: false })))
        .setFooter({ text: `所持金 ${money(s, wallet(i))}` });
      return i.reply({ embeds: [e], ...vis(i) });
    }
    const { it, n } = shopNumber(s, i), amount = i.options.getInteger('amount') ?? 1;
    if (!it) return refuse(i, `${n} 番の品は、ありません。(/shop list の番号を指定してください)`);
    const have = own[it.id] ?? 0;
    if (have + amount > SHOP_MAX_STACK) return refuse(i, `${it.emoji} ${it.name}は、最大${SHOP_MAX_STACK}個までしか持てません。(いま ${have}個)`);
    const total = it.price * amount;
    if (!collect(g, u, total, s)) return refuse(i, `お金が足りません。(必要 ${money(s, total)} / 手持ち ${money(s, Math.max(0, wallet(i)))})`);
    addItem(g, u, it.id, amount);
    await i.reply({ embeds: [card(i, s, 0xb8860b, '🏪 お店', `${it.emoji} **${it.name}** を **${amount}個** 買いました。\n**- ${money(s, total)}**\n所持: **${have + amount}個**(\`/use ${n}\` で使えます)`)] });
  },
};
export const useCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('use').setDescription('お店で買った品を使います(しばらく、効果がつきます)')
    .addIntegerOption((o) => o.setName('item').setDescription('品の番号(/shop list の番号)').setRequired(true).setMinValue(1).setMaxValue(MAX_SHOP_ITEMS))),
  async execute(i) {
    const s = await open(i); if (!s) return;
    if (!s.shopEnabled) return shopOff(i);
    const g = i.guildId, u = i.user.id, { it, n } = shopNumber(s, i), now = Date.now();
    if (!it) return refuse(i, `${n} 番の品は、ありません。(/shop list の番号を指定してください)`);
    if (!useItem(g, u, it.id)) return refuse(i, `${it.emoji} **${it.name}** を持っていません。\`/shop buy\` で買えます。`);
    const prev = activeStatuses(g, u, now).find((st) => st.slot === it.slot);
    setStatus(g, u, it.slot, it.id, now + it.minutes * 60_000);
    const prevItem = prev && shopById(s, prev.item);
    await i.reply({ embeds: [card(i, s, 0xb8860b, `${it.emoji} ${it.name}を使った`, `効果が **${it.minutes}分** つきます。\n${itemText(it)}${prevItem ? `\n-# ${prevItem.name}の効果を、上書きしました` : ''}`)] });
  },
};

/* ================= 贈り物(持っている品を、ほかの人にあげる) ================= */
export const giveCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('give').setDescription('持っている品を、ほかの人にあげます')
    .addSubcommand((c) => c.setName('shop').setDescription('お店で買った品を、あげます')
      .addUserOption((o) => o.setName('user').setDescription('あげる相手').setRequired(true))
      .addIntegerOption((o) => o.setName('item').setDescription('品の番号(/shop list の番号)').setRequired(true).setMinValue(1).setMaxValue(MAX_SHOP_ITEMS))
      .addIntegerOption((o) => o.setName('amount').setDescription('個数(省略すると1)').setMinValue(1).setMaxValue(SHOP_MAX_STACK)))
    .addSubcommand((c) => c.setName('market').setDescription('闇マーケットで買った道具を、あげます')
      .addUserOption((o) => o.setName('user').setDescription('あげる相手').setRequired(true))
      .addStringOption((o) => o.setName('item').setDescription('道具').setRequired(true).addChoices(...ITEMS.map((x) => ({ name: `${x.emoji} ${x.name}`, value: x.id }))))
      .addIntegerOption((o) => o.setName('amount').setDescription('個数(省略すると1)').setMinValue(1).setMaxValue(99)))),
  async execute(i) {
    const s = await open(i); if (!s) return;
    const g = i.guildId, me = i.user.id, to = i.options.getUser('user', true), sub = i.options.getSubcommand(), n = i.options.getInteger('amount') ?? 1;
    if (to.bot) return refuse(i, 'Botには、あげられません。');
    if (to.id === me) return refuse(i, '自分には、あげられません。');
    let item, max, label;
    if (sub === 'shop') {
      if (!s.shopEnabled) return shopOff(i);
      item = shopItems(s)[i.options.getInteger('item', true) - 1]; if (!item) return refuse(i, `${i.options.getInteger('item')} 番の品は、ありません。(/shop list の番号を指定してください)`);
      max = SHOP_MAX_STACK; label = 'お店';
    } else {
      if (!s.blackMarket) return refuse(i, 'このサーバーでは、闇マーケットはオフです。');
      item = itemById(i.options.getString('item', true)); if (!item) return refuse(i, 'その道具は、ありません。');
      max = marketCfg(s).maxStack; label = '闇市';
    }
    const r = transferItem(g, me, to.id, item.id, n, max);
    if (r === 'short') return refuse(i, `${item.emoji} ${item.name}を、${n}個は持っていません。(いま ${itemQty(g, me, item.id)}個)`);
    if (r === 'full') return refuse(i, `<@${to.id}> は、${item.emoji} ${item.name}を、これ以上持てません。(最大${max}個。いま ${itemQty(g, to.id, item.id)}個)`);
    await i.reply({ content: `<@${to.id}>`, embeds: [card(i, s, 0xe91e63, '🎁 贈り物', `${item.emoji} **${item.name}** を **${n}個**、<@${to.id}> にあげました!\n-# ${label}の品 ・ ${i.user.username} の残り ${itemQty(g, me, item.id)}個`)], allowedMentions: { users: [to.id] } });
  },
};

/* ================= ペット ================= */
const MAX_SLOTS = 40;
const petOff = (i) => refuse(i, 'このサーバーでは、ペットはオフです。管理者が、ダッシュボードの「通貨 → お店・ペット・株など」でオンにできます。');
const cleanName = (v, fallback) => (String(v ?? '').replace(/[\r\n<>@`*_~|]/g, '').trim().slice(0, 12) || fallback);
const petCapacity = (s, g, u) => petCfg(s).baseSlots + (s.estateEnabled ? estateHoldings(g, u).reduce((a, h) => a + h.count * (estateById(s, h.property)?.petSlots ?? 0), 0) : 0);
export const petCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('pet').setDescription('ペットを飼って、育てます(育つと、ボーナスがつきます)')
    .addSubcommand((c) => c.setName('status').setDescription('ペットの様子を見ます(まだなら、飼える動物の一覧)').addStringOption(searchOpt).addBooleanOption((o) => o.setName('public').setDescription('全員に表示する(省略すると自分だけ)')))
    .addSubcommand((c) => c.setName('adopt').setDescription('ペットを飼います(お金がかかります。飼える数は、不動産で増えます)')
      .addIntegerOption((o) => o.setName('species').setDescription('動物の番号(/pet status の一覧の番号)').setRequired(true).setMinValue(1).setMaxValue(MAX_PETS))
      .addStringOption((o) => o.setName('name').setDescription('名前(省略すると、動物の名前)').setMaxLength(12)))
    .addSubcommand((c) => c.setName('feed').setDescription('餌をあげます(お金がかかります)').addIntegerOption((o) => o.setName('pet').setDescription('ペットの番号(省略すると1番)').setMinValue(1).setMaxValue(MAX_SLOTS)))
    .addSubcommand((c) => c.setName('play').setDescription('遊びます(お金はかかりません)').addIntegerOption((o) => o.setName('pet').setDescription('ペットの番号(省略すると1番)').setMinValue(1).setMaxValue(MAX_SLOTS)))
    .addSubcommand((c) => c.setName('rename').setDescription('名前を変えます').addStringOption((o) => o.setName('name').setDescription('新しい名前').setRequired(true).setMaxLength(12)).addIntegerOption((o) => o.setName('pet').setDescription('ペットの番号(省略すると1番)').setMinValue(1).setMaxValue(MAX_SLOTS)))
    .addSubcommand((c) => c.setName('release').setDescription('ペットを手放します(お金は戻りません)').addBooleanOption((o) => o.setName('confirm').setDescription('本当に手放すなら、オン').setRequired(true)).addIntegerOption((o) => o.setName('pet').setDescription('ペットの番号(省略すると1番)').setMinValue(1).setMaxValue(MAX_SLOTS)))),
  async execute(i) {
    const s = await open(i); if (!s) return;
    if (!s.petsEnabled) return petOff(i);
    const g = i.guildId, u = i.user.id, cfg = petCfg(s), now = Date.now(), sub = i.options.getSubcommand(), pets = getPets(g, u), cap = petCapacity(s, g, u);
    const bonusText = (row, sp) => { const fx = petFx(row, cfg, sp, now); return Object.values(fx).some((v) => v) ? `**${bonusLabel(sp, cfg.power, levelOf(row.xp))}**` : `ボーナスは、おなかがすいていて、出ていません(満腹度 ${cfg.minHunger} 以上で出ます)`; };
    const capText = `飼っている数 **${pets.length} / ${cap}匹**${s.estateEnabled ? '(不動産を買うと、飼える数が増える物件があります)' : ''}`;
    if (sub === 'status') {
      if (!pets.length) {
        const open_ = petsOpen(s);
        if (!open_.length) return refuse(i, '飼えるペットが、まだ用意されていません。管理者が、ダッシュボードで追加できます。');
        const match = matcher(i), shownS = open_.map((x, n) => ({ x, n })).filter(({ x }) => match(x.name, x.foodName, bonusLabel(x, cfg.power))).slice(0, 24); if (!shownS.length) return noMatch(i);
        const list = shownS.map(({ x, n }) => ({ name: `${n + 1}. ${x.emoji} ${x.name} ・ ${money(s, x.price)}`, value: `${bonusLabel(x, cfg.power)} / レベル\n餌: ${x.foodEmoji} ${x.foodName}(${money(s, x.feedCost)})`, inline: true }));
        const e = new EmbedBuilder().setColor(0xe67e22).setTitle('🐾 ペット').setDescription(`まだ、ペットがいません。\`/pet adopt species:番号\` で飼えます。育てると、ボーナスがつきます。\n${capText}`).addFields(list);
        return i.reply({ embeds: [e], ...vis(i) });
      }
      const e = new EmbedBuilder().setColor(0xe67e22).setTitle('🐾 ペット').setAuthor({ name: i.member?.displayName ?? i.user.username, iconURL: i.user.displayAvatarURL?.() })
        .setDescription(`${capText}${pets.length < cap ? '\n`/pet adopt` で、もう1匹飼えます。' : ''}\n世話は、番号で選びます(例: \`/pet feed pet:2\`)`)
        .addFields(pets.slice(0, 24).map((pet, n) => {
          const sp = speciesOf(s, pet.species), h = hungerNow(pet, cfg.hungerDecay, now), lv = levelOf(pet.xp), nx = nextXp(pet.xp), fcd = cooldownLeft(g, u, `pet:feed:${pet.id}`), pcd = cooldownLeft(g, u, `pet:play:${pet.id}`);
          return { name: `${n + 1}. ${sp.emoji} ${pet.name}(${sp.name}) Lv ${lv}`, value: `${lv >= MAX_LEVEL ? 'なつき度 最大' : `なつき度 ${pet.xp} / ${nx}`}\n${hungerBar(h)}\n${bonusText(pet, sp)}\n${sp.foodEmoji} ${fcd ? `あと ${dur(fcd)}` : `**あげられます**(${money(s, sp.feedCost)})`} ・ 🎾 ${pcd ? `あと ${dur(pcd)}` : '**できます**'}`, inline: true };
        }));
      return i.reply({ embeds: [e], ...vis(i) });
    }
    if (sub === 'adopt') {
      if (pets.length >= cap) return refuse(i, `これ以上は飼えません。(${pets.length} / ${cap}匹)${s.estateEnabled ? '\n不動産を買うと、飼える数が増えます(`/estate list` で、増える数を確かめられます)。' : '\n手放すなら `/pet release` です。'}`);
      const sp = petsOpen(s)[i.options.getInteger('species', true) - 1]; if (!sp) return refuse(i, 'その番号の動物は、いません。`/pet status` で、番号を確かめてください。');
      if (!collect(g, u, sp.price, s)) return refuse(i, `お金が足りません。(必要 ${money(s, sp.price)} / 手持ち ${money(s, Math.max(0, wallet(i)))})`);
      const name = cleanName(i.options.getString('name'), sp.name); adoptPet(g, u, sp.id, name, now);
      return i.reply({ embeds: [card(i, s, 0xe67e22, `${sp.emoji} ${name} が、仲間になった!`, `${sp.name}を飼いました。(${pets.length + 1} / ${cap}匹)\n**- ${money(s, sp.price)}**\n餌と遊びで、なつき度が上がり、レベルが上がると、ボーナスがつきます(${bonusLabel(sp, cfg.power)} / レベル)。\`/pet status\` で様子を見られます。`)] });
    }
    if (!pets.length) return refuse(i, 'ペットがいません。`/pet adopt` で飼えます。');
    const num = i.options.getInteger('pet') ?? 1, pet = pets[num - 1]; if (!pet) return refuse(i, `${num} 番のペットは、いません。(/pet status の番号を指定してください。いま ${pets.length}匹)`);
    const sp = speciesOf(s, pet.species), h = hungerNow(pet, cfg.hungerDecay, now), lv0 = levelOf(pet.xp);
    const lvText = (xpAdd) => { const lv1 = levelOf(pet.xp + xpAdd); return lv1 > lv0 ? `\n🎉 **レベルアップ!** Lv ${lv1}(${bonusLabel(sp, cfg.power, lv1)})` : ''; };
    if (sub === 'feed') {
      const key = `pet:feed:${pet.id}`, cd = cooldownLeft(g, u, key); if (cd) return refuse(i, `${pet.name}は、まだおなかがいっぱいです。あと ${dur(cd)}。`);
      if (h >= 100) return refuse(i, `${pet.name}は、おなかがいっぱいです。`);
      if (!collect(g, u, sp.feedCost, s)) return refuse(i, `餌代が足りません。(必要 ${money(s, sp.feedCost)})`);
      const hungerAfter = Math.min(100, h + sp.feedHunger); updatePet(pet.id, { hunger: hungerAfter, xpAdd: cfg.feedXp }, now); setCooldown(g, u, key, cfg.feedCd);
      return i.reply({ embeds: [card(i, s, 0xe67e22, `${sp.foodEmoji} ${pet.name}に${sp.foodName}をあげた`, `満腹度 ${h} → **${hungerAfter}**、なつき度 +${cfg.feedXp}\n**- ${money(s, sp.feedCost)}**${lvText(cfg.feedXp)}`)] });
    }
    if (sub === 'play') {
      const key = `pet:play:${pet.id}`, cd = cooldownLeft(g, u, key); if (cd) return refuse(i, `${pet.name}は、少し休んでいます。あと ${dur(cd)}。`);
      if (h < 10) return refuse(i, `${pet.name}は、おなかがすいて、遊べません。餌をあげましょう。`);
      const hungerAfter = Math.max(0, h - 5); updatePet(pet.id, { hunger: hungerAfter, xpAdd: cfg.playXp }, now); setCooldown(g, u, key, cfg.playCd);
      return i.reply({ embeds: [card(i, s, 0xe67e22, `🎾 ${pet.name}と遊んだ`, `なつき度 +${cfg.playXp}、満腹度 ${h} → ${hungerAfter}${lvText(cfg.playXp)}`)] });
    }
    if (sub === 'rename') { const name = cleanName(i.options.getString('name', true), pet.name); renamePet(pet.id, name); return i.reply({ content: `${sp.emoji} 名前を **${name}** に変えました。`, ...EPH }); }
    if (sub === 'release') {
      if (!i.options.getBoolean('confirm')) return refuse(i, '手放すときは、`confirm` をオンにしてください。(お金は戻りません)');
      releasePet(pet.id); return i.reply({ content: `${sp.emoji} **${pet.name}** を手放しました。`, ...EPH });
    }
  },
};

/* ================= 株 ================= */
const stockOff = (i) => refuse(i, 'このサーバーでは、株はオフです。管理者が、ダッシュボードの「通貨 → お店・ペット・株など」でオンにできます。');
const arrow = trendArrow;
const pct = (c) => `${c > 0 ? '+' : ''}${(c * 100).toFixed(1)}%`;
export const stockCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('stock').setDescription('株(架空の会社)を売り買いします')
    .addSubcommand((c) => c.setName('list').setDescription('株価と、自分の持ち株を見ます').addStringOption(searchOpt).addBooleanOption((o) => o.setName('public').setDescription('全員に表示する(省略すると自分だけ)')))
    .addSubcommand((c) => c.setName('holders').setDescription('みんなの持ち株と、株の割合(持ち株が、全員の合計の何%か)を見ます')
      .addIntegerOption((o) => o.setName('company').setDescription('会社の番号(省略すると、全部の会社のまとめ)').setMinValue(1).setMaxValue(MAX_COMPANIES))
      .addBooleanOption((o) => o.setName('public').setDescription('全員に表示する(省略すると自分だけ)')))
    .addSubcommand((c) => c.setName('buy').setDescription('株を買います')
      .addIntegerOption((o) => o.setName('company').setDescription('会社の番号(/stock list の番号)').setRequired(true).setMinValue(1).setMaxValue(MAX_COMPANIES))
      .addIntegerOption((o) => o.setName('shares').setDescription('株数').setRequired(true).setMinValue(1)))
    .addSubcommand((c) => c.setName('sell').setDescription('株を売ります')
      .addIntegerOption((o) => o.setName('company').setDescription('会社の番号(/stock list の番号)').setRequired(true).setMinValue(1).setMaxValue(MAX_COMPANIES))
      .addIntegerOption((o) => o.setName('shares').setDescription('株数(省略すると、持っている全部)').setMinValue(1)))),
  async execute(i) {
    const s = await open(i); if (!s) return;
    if (!s.stocksEnabled) return stockOff(i);
    const g = i.guildId, u = i.user.id, cfg = stockCfg(s), market = marketNow(s, g), sub = i.options.getSubcommand();
    if (sub === 'list') {
      const mine = Object.fromEntries(holdings(g, u).map((h) => [h.company, h]));
      let total = 0, cost = 0;
      const match = matcher(i), fieldsAll = market.map((m, n) => {
        const c = companyOf(s, m.company), px = unitPrice(m.price), h = mine[c.id], ev = m.news[0];
        if (h) { total += px * h.shares; cost += h.cost; } // 評価額は、絞り込んでも、全部の持ち株ぶん
        return { ok: match(c.name, c.ticker), field: { name: `${n + 1}. ${c.emoji} ${c.ticker}  ${c.name}`, value: `**${money(s, px)}** ${arrow(m.change)} ${pct(m.change)}(24時間)\n\`${sparkline(m.spark)}\` 24時間: 高 ${unitPrice(m.hi).toLocaleString()} / 安 ${unitPrice(m.lo).toLocaleString()}\n${h ? `持ち株 **${h.shares}株**(取得 ${money(s, Math.round(h.cost / h.shares))}/株 ・ 損益 **${money(s, px * h.shares - h.cost)}**)` : '持ち株なし'}${ev ? `\n📰 ${ev.minutesAgo}分前: ${ev.up ? '🔺' : '🔻'} ${ev.text}` : ''}\n-# 変動 ${'■'.repeat(m.level)}${'□'.repeat(10 - m.level)} Lv${m.level}(${VOL_LABELS[m.level - 1]})`, inline: false } };
      });
      const fields = fieldsAll.filter((x) => x.ok).map((x) => x.field); if (!fields.length) return noMatch(i);
      const e = new EmbedBuilder().setColor(0x2ecc71).setTitle('📈 株式市場').setDescription(`株価は、**${Math.round(cfg.tickMs / 60000)}分ごと**に動きます。売買の手数料は、それぞれ ${(cfg.fee * 100).toFixed(1)}%。\`/stock buy\` \`/stock sell\``).addFields(fields)
        .setFooter({ text: `持ち株の評価額 ${total.toLocaleString()}(損益 ${(total - cost).toLocaleString()})・ 手持ち ${wallet(i).toLocaleString()}` });
      return i.reply({ embeds: [e], ...vis(i) });
    }
    if (sub === 'holders') { // みんなの持ち株と、株の割合(全員の持ち株の合計に対する、その人の持ち株の割合)
      const all = stockHoldersAll(g), pick = i.options.getInteger('company'), pc = (x, t) => (t ? `${((x / t) * 100).toFixed(1)}%` : '-');
      const by = (id) => all.filter((r) => r.company === id), px = (m) => unitPrice(m.price);
      if (pick) {
        const m = market[pick - 1]; if (!m) return refuse(i, `${pick} 番の会社は、ありません。`);
        const c = companyOf(s, m.company), rows = by(c.id).sort((a, b) => b.shares - a.shares), total = rows.reduce((a, r) => a + r.shares, 0);
        const e = new EmbedBuilder().setColor(0x2ecc71).setTitle(`👥 ${c.emoji} ${c.name}(${c.ticker})の株主`)
          .setDescription(rows.length ? `株主 **${rows.length}人** ・ みんなの持ち株の合計 **${total.toLocaleString()}株**(時価 ${money(s, total * px(m))})\n株価 ${money(s, px(m))}\n\n${rows.slice(0, 15).map((r, n) => `${n + 1}. <@${r.user_id}> — **${r.shares.toLocaleString()}株** ・ 割合 **${pc(r.shares, total)}**${rows.length >= 2 && cfg.sellLockPct < 100 && (r.shares / total) * 100 > cfg.sellLockPct ? ' 👑 過半数(売れません)' : ''} ・ 評価額 ${money(s, r.shares * px(m))}`).join('\n')}${rows.length > 15 ? `\n…ほか ${rows.length - 15}人` : ''}` : 'まだ、この会社の株を持っている人は、いません。')
          .setFooter({ text: '割合 = その人の持ち株 ÷ みんなの持ち株の合計' });
        return i.reply({ embeds: [e], allowedMentions: NO_MENTIONS, ...vis(i) });
      }
      const fields = market.map((m, n) => { const c = companyOf(s, m.company), rows = by(c.id).sort((a, b) => b.shares - a.shares), total = rows.reduce((a, r) => a + r.shares, 0), top = rows[0];
        return { name: `${n + 1}. ${c.emoji} ${c.ticker} ${c.name}`, value: rows.length ? `株主 ${rows.length}人 ・ 合計 **${total.toLocaleString()}株**(${money(s, total * px(m))})\n筆頭株主 <@${top.user_id}> ${top.shares.toLocaleString()}株(${pc(top.shares, total)})` : 'まだ、持っている人は、いません', inline: false }; });
      const e = new EmbedBuilder().setColor(0x2ecc71).setTitle('👥 みんなの持ち株').addFields(fields).setFooter({ text: '`/stock holders company:番号` で、その会社の株主の一覧(割合つき)' });
      return i.reply({ embeds: [e], allowedMentions: NO_MENTIONS, ...vis(i) });
    }
    const idx = i.options.getInteger('company', true) - 1, m = market[idx]; if (!m) return refuse(i, 'その会社は、ありません。');
    const c = companyOf(s, m.company), px = unitPrice(m.price), h = holding(g, u, c.id);
    if (sub === 'buy') {
      const n = i.options.getInteger('shares', true);
      if (h.shares + n > cfg.maxShares) return refuse(i, `${c.name}の株は、最大 ${cfg.maxShares.toLocaleString()}株までしか持てません。(いま ${h.shares}株)`);
      const gross = px * n, fee = Math.ceil(gross * cfg.fee), total = gross + fee;
      if (!collect(g, u, total, s)) return refuse(i, `お金が足りません。(必要 ${money(s, total)} / 手持ち ${money(s, Math.max(0, wallet(i)))})`);
      addHolding(g, u, c.id, n, total);
      return i.reply({ embeds: [card(i, s, 0x2ecc71, `${c.emoji} ${c.name} を買いました`, `**${n}株** × ${money(s, px)}\n**- ${money(s, total)}**(手数料 ${money(s, fee)} 込み)\n持ち株: **${h.shares + n}株**`)] });
    }
    const n = i.options.getInteger('shares') ?? h.shares;
    if (!n || h.shares < n) return refuse(i, `${c.name}の株を、${n || 0}株は持っていません。(いま ${h.shares}株)`);
    { // 過半数を持っている人は、売れない(株主が2人以上のとき。持ち株の合計に対する割合が、決めた割合を超えているとき)
      const rows = stockHoldersAll(g).filter((r) => r.company === c.id), total = rows.reduce((a, r) => a + r.shares, 0), pctNow = total ? (h.shares / total) * 100 : 0;
      if (cfg.sellLockPct < 100 && rows.length >= 2 && pctNow > cfg.sellLockPct) return refuse(i, `🔒 あなたは、${c.emoji} ${c.name}の株を、みんなの持ち株の **${pctNow.toFixed(1)}%** 持っています(${cfg.sellLockPct}% を超えると、売れません)。\n過半数を持っている間は、売れません。他の人が、もっと持つようになると、売れるようになります。`);
    }
    const basis = takeHolding(g, u, c.id, n); if (basis === null) return refuse(i, `${c.name}の株が足りません。`); // 取れたときだけ売る(二重に売れない)
    const gross = px * n, fee = Math.floor(gross * cfg.fee), net = gross - fee, p = pay(g, u, net, s), profit = net - basis;
    return i.reply({ embeds: [card(i, s, profit >= 0 ? GREEN : RED, `${c.emoji} ${c.name} を売りました`, `**${n}株** × ${money(s, px)}\n**+ ${money(s, p.paid)}**(手数料 ${money(s, fee)} 引き)${shortNote(s, p)}\n損益: **${profit >= 0 ? '+' : ''}${money(s, profit)}**(取得費 ${money(s, basis)})`)] });
  },
};

/* ================= 株のニュース(会社ごとに見る) ================= */
export const newsCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('news').setDescription('株のニュース(最近起きた出来事)を、会社ごとに見ます')
    .addIntegerOption((o) => o.setName('company').setDescription('会社の番号(/stock list の番号。省略すると、全部の会社)').setMinValue(1).setMaxValue(MAX_COMPANIES))
    .addBooleanOption((o) => o.setName('public').setDescription('全員に表示する(省略すると自分だけ)'))),
  async execute(i) {
    const s = await open(i); if (!s) return;
    if (!s.stocksEnabled) return stockOff(i);
    const g = i.guildId, n = i.options.getInteger('company'), c0 = n ? companiesOf(s)[n - 1] : null;
    if (n && !c0) return refuse(i, `${n} 番の会社は、ありません。(/stock list の番号を指定してください)`);
    marketNow(s, g); // 株価を、いままで進める(その間に起きたニュースも、記録される)
    const rows = recentNews(g, c0?.id ?? null, 10);
    const co = (id) => { const k = companiesOf(s).find((x) => x.id === id); return k ? companyOf(s, k) : { name: id, ticker: '', emoji: '📰' }; };
    const title = c0 ? `📰 ${companyOf(s, c0).emoji} ${companyOf(s, c0).name} のニュース` : '📰 株のニュース(全部の会社)';
    const e = new EmbedBuilder().setColor(0x3498db).setTitle(title)
      .setDescription(rows.length ? rows.map((r) => { const c = co(r.company), pctv = (r.after_px / r.before_px - 1) * 100, px = (v) => Math.max(1, Math.round(v)).toLocaleString(); return `${r.up ? '📈' : '📉'} ${c0 ? '' : `${c.emoji} **${c.ticker}** `}**${r.text}**\n${r.up ? '🔺' : '🔻'} ${pctv > 0 ? '+' : ''}${pctv.toFixed(1)}%(${px(r.before_px)} → ${px(r.after_px)})・ <t:${r.tick * 60}:R>`; }).join('\n\n') : 'まだ、ニュースは、ありません。(ニュースは、起きるたびに、ここに記録されます)')
      .setFooter({ text: '最近の10件 ・ 7日ぶんまで残ります' });
    return i.reply({ embeds: [e], ...vis(i) });
  },
};

/* ================= 不祥事(お金を払って、会社の株価を下げる) ================= */
export const scandalCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('scandal').setDescription('お金を払って、会社の不祥事を、こっそり起こします(その会社の株価が下がります)')
    .addIntegerOption((o) => o.setName('company').setDescription('会社の番号(/stock list の番号)').setRequired(true).setMinValue(1).setMaxValue(MAX_COMPANIES))),
  async execute(i, rng = rnd) {
    const s = await open(i); if (!s) return;
    if (!s.stocksEnabled) return stockOff(i);
    if (!s.scandalEnabled) return refuse(i, 'このサーバーでは、不祥事は、オフです。管理者が、ダッシュボードの「株」でオンにできます。');
    const g = i.guildId, u = i.user.id, cfg = stockCfg(s), n = i.options.getInteger('company', true), c0 = companiesOf(s)[n - 1], now = Date.now();
    if (!c0) return refuse(i, `${n} 番の会社は、ありません。(/stock list の番号を指定してください)`);
    const c = companyOf(s, c0), coKey = `co:${c0.id}`;
    const mine = cooldownLeft(g, u, 'scandal'); if (mine) return refuse(i, `🤫 次の不祥事まで、あと ${dur(mine)}。(足がつかないように、しばらく、おとなしく)`);
    const theirs = cooldownLeft(g, coKey, 'scandal'); if (theirs) return refuse(i, `${c.emoji} ${c.name}は、いま、騒ぎの最中です。あと ${dur(theirs)} は、もう1つは起こせません。`);
    marketNow(s, g, now); // 株価を、いままで進める
    if (!collect(g, u, cfg.scandalCost, s)) return refuse(i, `お金が足りません。(費用 ${money(s, cfg.scandalCost)} / 手持ち ${money(s, Math.max(0, wallet(i)))})`);
    const bad = (s.newsEvents ?? []).filter((e) => e.enabled && e.pct < 0 && (!e.company || e.company === c0.id)), text = bad.length ? bad[Math.floor(rng() * bad.length)].text : '不祥事が、発覚';
    const last = lastStockRow(g, c0.id), before = last.price, after = Math.max(c0.base * 0.15, before * (1 - cfg.scandalDrop));
    shockStock(g, c0.id, after); // 最新の株価を、書き換える(このあとの値動きは、この値段から続く)
    const caught = rng() < cfg.scandalCatch, who = i.member?.displayName ?? i.user.username;
    let tick = Math.floor(now / 60000); while (Number(addNews(g, c0.id, tick, false, caught ? `${text}(${who}の仕業と判明)` : `${text}(何者かが、仕掛けた?)`, before, after, s.newsChannelId ? 0 : 1).changes) === 0) tick++; // 新聞に、載る(同じ分に、ほかのニュースがあれば、1分ずらす)
    setCooldown(g, u, 'scandal', cfg.scandalCd); setCooldown(g, coKey, 'scandal', cfg.scandalCd);
    const pctv = (after / before - 1) * 100, px = (v) => Math.max(1, Math.round(v)).toLocaleString();
    if (!caught) return i.reply({ embeds: [card(i, s, 0x2c3e50, '🤫 不祥事を、仕掛けた', `${c.emoji} **${c.name}** に、「${text}」が起きました。\n株価 ${px(before)} → **${px(after)}**(${pctv.toFixed(1)}%)\n**- ${money(s, cfg.scandalCost)}**\n-# だれにも、ばれていません。新聞に載りますが、仕業は、あなたしか知りません`)], ...EPH });
    const extra = fine(g, u, cfg.scandalCost, s, 'scandal'); // ばれた: 罰金(費用と同じ額)
    return i.reply({ embeds: [card(i, s, RED, '🚨 不祥事の仕業が、ばれた!', `${c.emoji} **${c.name}** の「${text}」は、**${who}** の仕業と判明しました!\n株価 ${px(before)} → **${px(after)}**(${pctv.toFixed(1)}%)\n**- ${money(s, cfg.scandalCost)}**(費用)・ 罰金 **- ${money(s, extra)}**${debtNote(i, s)}`)] });
  },
};

/* ================= 宝くじ(サーバーごとに、自由に、複数のくじを作れる) ================= */
const lotteryOff = (i) => refuse(i, 'このサーバーでは、宝くじはオフです。管理者が、ダッシュボードの「通貨 → お店・ペット・株など」でオンにできます。');
/** 番号の文字から、番号の一覧を作る。「123, 456」は、そのまま。「100-110」(-・~・〜)は、連番(100〜110)。{ list } か { error } */
export function parseLotteryNumbers(str, cap) {
  const text = String(str ?? '').normalize('NFKC'), re = /(\d+)\s*[-~〜]\s*(\d+)|(\d+)/g, out = []; let m;
  while ((m = re.exec(text))) {
    if (m[3] !== undefined) out.push(Number(m[3]));
    else { const a = Number(m[1]), b = Number(m[2]); if (b < a) return { error: `「${m[0]}」は、小さい番号から、大きい番号の順に書いてください。` }; if (b - a + 1 > cap) return { error: `連番は、${cap}枚までです。(「${m[0]}」は、${b - a + 1}枚)` }; for (let n = a; n <= b; n++) out.push(n); }
    if (out.length > cap) return { error: `1回に買えるのは、最大 ${cap}枚までです。` };
  }
  return { list: out };
}
export const lotteryCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('lottery').setDescription('宝くじ(番号を選んで買います。決まった時刻に、自動で抽選します)')
    .addSubcommand((c) => c.setName('info').setDescription('くじの一覧、または、1つのくじの詳しい情報(次の抽選・ジャックポット・自分のくじ)')
      .addIntegerOption((o) => o.setName('lottery').setDescription('くじの番号(省略すると、一覧)').setMinValue(1).setMaxValue(MAX_LOTTERIES)).addStringOption(searchOpt).addBooleanOption((o) => o.setName('public').setDescription('全員に表示する(省略すると自分だけ)')))
    .addSubcommand((c) => c.setName('buy').setDescription('くじを買います')
      .addIntegerOption((o) => o.setName('lottery').setDescription('くじの番号(/lottery info の番号。省略すると 1)').setMinValue(1).setMaxValue(MAX_LOTTERIES))
      .addIntegerOption((o) => o.setName('count').setDescription('枚数(省略すると1枚)').setMinValue(1).setMaxValue(100))
      .addIntegerOption((o) => o.setName('number').setDescription('番号(省略すると、ランダム。指定すると、その番号を枚数ぶん買います)').setMinValue(0).setMaxValue(9999))
      .addStringOption((o) => o.setName('numbers').setDescription('番号を、いくつか指定(例: 123,456,789)。「100-110」で連番。枚数より少なければ、残りは、ランダム').setMaxLength(100)))
    .addSubcommand((c) => c.setName('results').setDescription('前回の抽選結果を見ます')
      .addIntegerOption((o) => o.setName('lottery').setDescription('くじの番号(省略すると 1)').setMinValue(1).setMaxValue(MAX_LOTTERIES)).addBooleanOption((o) => o.setName('public').setDescription('全員に表示する(省略すると自分だけ)')))),
  async execute(i) {
    const s = await open(i); if (!s) return;
    const g = i.guildId, u = i.user.id, now = Date.now(), sub = i.options.getSubcommand(), all = lotteriesOf(s);
    for (const d of settleGuild(s, g, now)) await announce(i.client, s, g, d); // 抽選の時刻を過ぎていれば、ここでも抽選する(止まっていた間の取りこぼし防止)
    if (!s.lotteryEnabled && sub !== 'results') return lotteryOff(i);
    const pick = i.options.getInteger('lottery');
    if (sub === 'info' && pick === null) {
      const match = matcher(i), shownL = all.map((L, n) => ({ L, n })).filter(({ L }) => match(L.name)); if (!shownL.length) return noMatch(i);
      const e = new EmbedBuilder().setColor(0xf1c40f).setTitle('🎟️ 宝くじ').setDescription('`/lottery buy lottery:番号` で買えます。詳しくは `/lottery info lottery:番号`。')
        .addFields(shownL.map(({ L, n }) => { const at = Math.floor(drawTimeOf(roundOf(now, L), L) / 1000); return { name: `${n + 1}. ${L.emoji} ${L.name}`, value: `1枚 **${money(s, L.price)}** ・ ${L.digits}桁 ・ 抽選 <t:${at}:R>\n🥇 ジャックポット **${money(s, lotteryJackpot(g, L.id, L.jackpotBase))}**`, inline: false }; }))
        .setFooter({ text: `所持金 ${wallet(i).toLocaleString()}` });
      return i.reply({ embeds: [e], ...vis(i) });
    }
    const n = pick ?? 1, L = all[n - 1]; if (!L) return refuse(i, `${n} 番のくじは、ありません。(/lottery info で一覧を見られます)`);
    const round = roundOf(now, L), drawAt = drawTimeOf(round, L), mine = userTickets(g, L.id, round, u), count = userTicketCount(g, L.id, round, u);
    if (sub === 'results') {
      const d = lastDraw(g, L.id); if (!d) return refuse(i, `${L.emoji} ${L.name}は、まだ抽選が行われていません。`);
      return i.reply({ embeds: [drawEmbed(s, { ...d, lottery: L, jackpotWon: !!d.jackpot_won, short: 0, nextJackpot: lotteryJackpot(g, L.id, L.jackpotBase) })], ...vis(i) });
    }
    if (sub === 'info') {
      const est = estimateRtp(L);
      const e = new EmbedBuilder().setColor(0xf1c40f).setTitle(`${L.emoji} ${L.name}`)
        .setDescription(`次の抽選: <t:${Math.floor(drawAt / 1000)}:F>(<t:${Math.floor(drawAt / 1000)}:R>)\n1枚 **${money(s, L.price)}** ・ ${L.digits}桁(${pad(0, L.digits)}〜${'9'.repeat(L.digits)})・ 1人 最大 ${L.maxTickets}枚まで`)
        .addFields({ name: `🥇 1等(${L.digits}桁一致)`, value: `**${money(s, lotteryJackpot(g, L.id, L.jackpotBase))}**\n当たりが出なければ、持ち越し(確率 ${(est.win1 * 100).toFixed(est.win1 < 0.001 ? 2 : 1)}%)`, inline: true },
          { name: `🥈 2等(下${L.digits - 1}桁)${L.digits >= 3 ? ' / 🥉 3等(下' + (L.digits - 2) + '桁)' : ''}`, value: `くじ代の **×${L.prize2}**${L.digits >= 3 ? `\nくじ代の **×${L.prize3}**` : ''}`, inline: true },
          { name: `あなたのくじ(${count}枚)`, value: mine.length ? mine.map((t) => `${pad(t.number, L.digits)}${t.qty > 1 ? `×${t.qty}` : ''}`).join('  ').slice(0, 1000) : 'まだ買っていません。' })
        .setFooter({ text: `この回の販売 ${roundSales(g, L.id, round).toLocaleString()}枚 ・ 所持金 ${wallet(i).toLocaleString()}` });
      return i.reply({ embeds: [e], ...vis(i) });
    }
    const maxNum = 10 ** L.digits - 1, picked = i.options.getInteger('number');
    // numbers: 番号を、いくつか(1枚ずつ)。「100-110」のように書くと、連番(100から110まで)
    const parsed = parseLotteryNumbers(i.options.getString('numbers'), L.maxTickets); if (parsed.error) return refuse(i, parsed.error);
    const listed = parsed.list;
    const k = Math.max(i.options.getInteger('count') ?? (listed.length || 1), listed.length);
    if (picked !== null && picked > maxNum) return refuse(i, `${L.name}の番号は、${pad(0, L.digits)}〜${maxNum} です。`);
    if (listed.some((n) => n > maxNum)) return refuse(i, `${L.name}の番号は、${pad(0, L.digits)}〜${maxNum} です。(${listed.filter((n) => n > maxNum).join(', ')} は、大きすぎます)`);
    if (count + k > L.maxTickets) return refuse(i, `1回の抽選で買えるのは、最大 ${L.maxTickets}枚までです。(いま ${count}枚)`);
    const total = L.price * k;
    if (!collect(g, u, total, s)) return refuse(i, `お金が足りません。(必要 ${money(s, total)} / 手持ち ${money(s, Math.max(0, wallet(i)))})`);
    const bought = new Map();
    if (picked !== null && !listed.length) bought.set(picked, k); // 1つの番号を、枚数ぶん
    else { for (const num of listed) bought.set(num, (bought.get(num) ?? 0) + 1); for (let q = listed.length; q < k; q++) { const num = drawNumber(L.digits); bought.set(num, (bought.get(num) ?? 0) + 1); } } // 決めた番号は1枚ずつ、残りは、ランダム
    for (const [num, qty] of bought) addTicket(g, L.id, round, u, num, L.price, qty);
    const list = [...bought].sort((a, b) => a[0] - b[0]).map(([num, qty]) => `${pad(num, L.digits)}${qty > 1 ? `×${qty}` : ''}`).join('  ');
    await i.reply({ embeds: [card(i, s, 0xf1c40f, `${L.emoji} ${L.name}を買いました`, `**${k}枚**(番号: ${list.slice(0, 900)})\n**- ${money(s, total)}**\n抽選: <t:${Math.floor(drawAt / 1000)}:R>`)], ...EPH });
  },
};

/* ================= 不動産(物件を買って、家賃をもらう) ================= */
const estateOff = (i) => refuse(i, 'このサーバーでは、不動産はオフです。管理者が、ダッシュボードの「通貨 → お店・ペット・株など」でオンにできます。');
/** 溜まっている家賃を払って、受け取った時刻を進める。予算が足りなくて、払いきれなかったぶんは、そのまま溜まったままにする。{ paid, short, hourly } を返す */
function collectRent(s, g, u, now = Date.now()) {
  const cfg = estateCfg(s), owned = estateHoldings(g, u).map((h) => ({ ...(estateById(s, h.property) ?? {}), count: h.count })).filter((x) => x.id);
  const hourly = hourlyNet(owned), at = rentAt(g, u) ?? now, amount = accrued(owned, at, now, cfg.capHours);
  if (amount <= 0) { setRentAt(g, u, owned.length ? now : now); return { paid: 0, short: 0, hourly }; }
  const p = pay(g, u, amount, s);
  const unpaidHours = hourly > 0 ? (p.short / hourly) : 0; // 払えなかったぶんは、その時間ぶん、まだ溜まっている扱い
  setRentAt(g, u, Math.round(now - unpaidHours * 3600_000));
  return { paid: p.paid, short: p.short, hourly };
}
export const estateCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('estate').setDescription('不動産(物件を買って、家賃をもらいます)')
    .addSubcommand((c) => c.setName('list').setDescription('物件の一覧と、自分の持ち物件・溜まった家賃を見ます').addStringOption(searchOpt).addBooleanOption((o) => o.setName('public').setDescription('全員に表示する(省略すると自分だけ)')))
    .addSubcommand((c) => c.setName('buy').setDescription('物件を買います')
      .addIntegerOption((o) => o.setName('property').setDescription('物件の番号(/estate list の番号)').setRequired(true).setMinValue(1).setMaxValue(MAX_PROPERTIES))
      .addIntegerOption((o) => o.setName('count').setDescription('数(省略すると1)').setMinValue(1).setMaxValue(20)))
    .addSubcommand((c) => c.setName('sell').setDescription('物件を売ります')
      .addIntegerOption((o) => o.setName('property').setDescription('物件の番号(/estate list の番号)').setRequired(true).setMinValue(1).setMaxValue(MAX_PROPERTIES))
      .addIntegerOption((o) => o.setName('count').setDescription('数(省略すると1)').setMinValue(1).setMaxValue(20)))
    .addSubcommand((c) => c.setName('collect').setDescription('溜まった家賃を受け取ります'))),
  async execute(i) {
    const s = await open(i); if (!s) return;
    if (!s.estateEnabled) return estateOff(i);
    const g = i.guildId, u = i.user.id, now = Date.now(), cfg = estateCfg(s), list = estateOf(s), sub = i.options.getSubcommand();
    const mine = () => estateHoldings(g, u).map((h) => ({ ...(estateById(s, h.property) ?? {}), count: h.count, spent: h.spent })).filter((x) => x.id);
    if (sub === 'list') {
      const match = matcher(i), shownP = list.map((p, n) => ({ p, n })).filter(({ p }) => match(p.name, p.desc)); if (!shownP.length) return noMatch(i);
      const own = Object.fromEntries(mine().map((x) => [x.id, x])), items = mine(), hourly = hourlyNet(items), at = rentAt(g, u) ?? now;
      const waiting = accrued(items, at, now, cfg.capHours), full = (now - at) / 3600_000 >= cfg.capHours;
      const e = new EmbedBuilder().setColor(0x16a085).setTitle('🏢 不動産')
        .setDescription(`家賃は、**1時間ごと**に溜まり、最大 **${cfg.capHours}時間ぶん**まで溜まります。\`/estate collect\` で受け取ります。\n手取り: **${money(s, hourly)}/時間**(家賃 − 維持費)・溜まった家賃: **${money(s, waiting)}**${full && waiting ? '(上限です。早く受け取りましょう)' : ''}`)
        .addFields(shownP.map(({ p, n }) => { const net = Math.max(0, p.rent - p.upkeep), o = own[p.id]; return { name: `${n + 1}. ${p.emoji} ${p.name}`, value: `**${money(s, p.price)}** ・ 家賃 ${money(s, p.rent)}/時 − 維持費 ${money(s, p.upkeep)} = **${money(s, net)}/時**(1日 ${(net * 24 / p.price * 100).toFixed(1)}%)\n持ち物件 **${o?.count ?? 0}/${p.maxOwn}**${p.petSlots && s.petsEnabled ? ` ・ 🐾 ペット枠 +${p.petSlots}` : ''}${p.desc ? `\n-# ${p.desc}` : ''}`, inline: false }; }))
        .setFooter({ text: `手持ち ${wallet(i).toLocaleString()} ・ 売るときは、買った値段の ${Math.round(cfg.sellPct * 100)}%` });
      return i.reply({ embeds: [e], ...vis(i) });
    }
    if (sub === 'collect') {
      const owned = mine(); if (!owned.length) return refuse(i, '物件を持っていません。`/estate buy` で買えます。');
      const r = collectRent(s, g, u, now);
      if (!r.paid && !r.short) return refuse(i, `まだ、家賃は溜まっていません。(手取り ${money(s, r.hourly)}/時間)`);
      return i.reply({ embeds: [card(i, s, 0x16a085, '🏢 家賃を受け取りました', `**+ ${money(s, r.paid)}**${r.short ? `\n-# 予算が足りず、${money(s, r.short)} は、溜まったままです` : ''}\n手取り: ${money(s, r.hourly)}/時間`)] });
    }
    const n = i.options.getInteger('property', true), p = list[n - 1], k = i.options.getInteger('count') ?? 1;
    if (!p) return refuse(i, `${n} 番の物件は、ありません。(/estate list の番号を指定してください)`);
    const have = estateCount(g, u, p.id);
    if (sub === 'buy') {
      if (have.count + k > p.maxOwn) return refuse(i, `${p.emoji} ${p.name}は、最大 ${p.maxOwn}件までしか持てません。(いま ${have.count}件)`);
      const gross = p.price * k, fee = Math.ceil(gross * cfg.feePct), total = gross + fee;
      if (!collect(g, u, total, s)) return refuse(i, `お金が足りません。(必要 ${money(s, total)} / 手持ち ${money(s, Math.max(0, wallet(i)))})`);
      const r = collectRent(s, g, u, now); // いままでの家賃を、先に受け取る(これからは、新しい物件ぶんも溜まる)
      addEstate(g, u, p.id, k, total);
      return i.reply({ embeds: [card(i, s, 0x16a085, `${p.emoji} ${p.name} を買いました`, `**${k}件**\n**- ${money(s, total)}**${fee ? `(手数料 ${money(s, fee)} 込み)` : ''}\n持ち物件: **${have.count + k}件** ・ 家賃 +${money(s, Math.max(0, p.rent - p.upkeep) * k)}/時間${r.paid ? `\n-# 溜まっていた家賃 ${money(s, r.paid)} も、受け取りました` : ''}`)] });
    }
    if (have.count < k) return refuse(i, `${p.emoji} ${p.name}を、${k}件は持っていません。(いま ${have.count}件)`);
    const r = collectRent(s, g, u, now);
    const basis = takeEstate(g, u, p.id, k); if (basis === null) return refuse(i, `${p.name}が足りません。`); // 取れたときだけ売る(二重に売れない)
    const sale = Math.round(p.price * k * cfg.sellPct), paid = pay(g, u, sale, s), diff = sale - basis;
    return i.reply({ embeds: [card(i, s, diff >= 0 ? GREEN : 0x16a085, `${p.emoji} ${p.name} を売りました`, `**${k}件**\n**+ ${money(s, paid.paid)}**(値段の ${Math.round(cfg.sellPct * 100)}%)${shortNote(s, paid)}\n買った値段との差: **${diff >= 0 ? '+' : ''}${money(s, diff)}**${r.paid ? `\n-# 溜まっていた家賃 ${money(s, r.paid)} も、受け取りました` : ''}`)] });
  },
};

/* ================= 指名手配 ================= */
const wantedOff = (i) => refuse(i, 'このサーバーでは、指名手配はオフです。管理者が、ダッシュボードの「通貨 → 指名手配」でオンにできます。');
export const wantedCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('wanted').setDescription('指名手配中の人(手配書)を見ます')
    .addUserOption((o) => o.setName('user').setDescription('調べる人(省略すると、手配書の一覧)'))),
  async execute(i) {
    const s = await open(i); if (!s) return;
    if (!s.wantedEnabled) return wantedOff(i);
    const g = i.guildId, u = i.options.getUser('user');
    if (u) {
      const wc = wantedCfg(s), heat = getHeat(g, u.id, s.wantedDecayMin), n = starsOf(heat, wc.heatPerStar);
      return i.reply({ content: n ? `${starText(n)} <@${u.id}> は **指名手配 Lv${n}** です。(懸賞金 ${money(s, bountyOf(heat, s.bountyPerStar, wc.heatPerStar))})` : `<@${u.id}> は、指名手配されていません。${heat ? `(手配度 ${heat} / 星が付くのは ${wc.heatPerStar} から)` : ''}`, allowedMentions: NO_MENTIONS, ...EPH });
    }
    const wc = wantedCfg(s), rows = topWanted(g, s.wantedDecayMin, wc.heatPerStar, 10);
    const e = new EmbedBuilder().setColor(RED).setTitle('🚨 指名手配')
      .setDescription(rows.length ? rows.map((r, n) => `${n + 1}. ${starText(starsOf(r.heat, wc.heatPerStar))} <@${r.user_id}> — 懸賞金 **${money(s, bountyOf(r.heat, s.bountyPerStar, wc.heatPerStar))}**`).join('\n') : '指名手配中の人は、いません。')
      .setFooter({ text: `手配中 ${rows.length}人 ・ 警察のバイトのボーナス確率 ${Math.round(Math.min(POLICE_BONUS_CAP, Math.max(jobOf(s, 'police').bonus.chance, jobOf(s, 'police').bonus.chance + topWanted(g, s.wantedDecayMin, wc.heatPerStar, 1000).length * s.policeBonusPerWanted / 100)) * 100)}% ・ 警察のバイトを重ねると、/arrest で逮捕できます` });
    await i.reply({ embeds: [e], allowedMentions: NO_MENTIONS });
  },
};
export const arrestCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('arrest').setDescription('指名手配中の人を、逮捕します(警察のバイトを重ねた人だけ)')
    .addStringOption((o) => o.setName('wanted').setDescription('指名手配中の人から選ぶ(候補が出ます)').setAutocomplete(true))
    .addUserOption((o) => o.setName('user').setDescription('逮捕する人を、直接えらぶ(省略すると、いちばん手配度の高い人)'))),
  /** 指名手配中の人の候補(星・懸賞金つき。手配度の高い順)。「選ばない」なら、いちばん手配度の高い人 */
  async autocomplete(i) {
    const s = getSettings(i.guildId), wc = wantedCfg(s), q = String(i.options.getFocused() ?? '').normalize('NFKC').toLowerCase();
    if (!s.enabled || !s.wantedEnabled) return i.respond([]);
    const rows = topWanted(i.guildId, s.wantedDecayMin, wc.heatPerStar, 25).filter((r) => r.user_id !== i.user.id && !jailLeft(i.guildId, r.user_id));
    const named = await Promise.all(rows.map(async (r) => { const m = i.guild?.members?.cache?.get(r.user_id) ?? await i.guild?.members?.fetch?.(r.user_id).catch(() => null); return { r, name: m?.displayName ?? i.client?.users?.cache?.get(r.user_id)?.username ?? '手配中の人' }; }));
    const out = named.filter((x) => !q || x.name.normalize('NFKC').toLowerCase().includes(q)).slice(0, 25)
      .map(({ r, name }) => ({ name: `${'⭐'.repeat(Math.max(1, starsOf(r.heat, wc.heatPerStar)))} ${name}(懸賞金 ${bountyOf(r.heat, s.bountyPerStar, wc.heatPerStar).toLocaleString()})`.slice(0, 100), value: r.user_id }));
    return i.respond(out);
  },
  async execute(i, rng = rnd) {
    const s = await open(i); if (!s) return;
    if (!s.wantedEnabled) return wantedOff(i);
    const g = i.guildId, me = i.user.id;
    let target = i.options.getUser('user');
    const picked = i.options.getString?.('wanted'); // 手配中の人の一覧から選んだ(ユーザーID)
    if (!target && /^\d{15,25}$/.test(String(picked ?? ''))) target = await i.client?.users?.fetch?.(picked).catch(() => null) ?? { id: picked, bot: false, username: '手配中の人' };
    if (!target) { // 名前を入れなかった: いま手配中の人のうち、手配度がいちばん高い人(自分と、留置場にいる人は除く)
      const top = topWanted(g, s.wantedDecayMin, wantedCfg(s).heatPerStar, 25).filter((r) => r.user_id !== me && !jailLeft(g, r.user_id))[0];
      if (!top) return refuse(i, '逮捕できる、手配中の人が、いません。(/wanted で、手配書を見られます)');
      target = await i.client?.users?.fetch?.(top.user_id).catch(() => null) ?? { id: top.user_id, bot: false, username: '手配中の人' };
    }
    if (target.bot || target.id === me) return refuse(i, 'その相手は、逮捕できません。');
    const jl = jailLeft(g, me); if (jl) return refuse(i, `🚔 留置場にいる間は、逮捕できません。(あと ${dur(jl)})`);
    const n = shiftsOf(g, me, 'police');
    if (n < s.arrestMinShifts) return refuse(i, `👮 逮捕するには、警察のバイト(/work)を ${s.arrestMinShifts}回 以上する必要があります。(いま ${n}回)`);
    const cd = cooldownLeft(g, me, 'arrest'); if (cd) return refuse(i, `👮 次の逮捕まで、あと ${dur(cd)}。`);
    const wc = wantedCfg(s), heat = getHeat(g, target.id, s.wantedDecayMin), stars = starsOf(heat, wc.heatPerStar);
    if (!stars) return refuse(i, `<@${target.id}> は、指名手配されていません。(/wanted で、手配書を見られます)`);
    if (jailLeft(g, target.id)) return refuse(i, `<@${target.id}> は、すでに留置場にいます。`);
    if (wc.bountyFine === 0 && budgetEmpty(s, g)) return refuse(i, BUDGET_EMPTY); // 罰金を取らない設定のときだけ、懸賞金は、予算(または何もないところ)から払われる
    setCooldown(g, me, 'arrest', wc.arrestCd);
    const fxMe = userFx(s, g, me), fxTg = userFx(s, g, target.id); // お店の品・ペットの効果(逮捕する側・される側)
    const chance = Math.min(1, Math.max(0, wc.arrestChance + fxTg.arrestChance + fxMe.arrestSuccess));
    if (rng() >= chance) {
      return i.reply({ embeds: [card(i, s, RED, '👮 逮捕に失敗…', `<@${target.id}> に、まんまと逃げられた!\n-# 次の逮捕まで ${dur(wc.arrestCd)}`)], allowedMentions: NO_MENTIONS });
    }
    const baseBounty = bountyOf(heat, s.bountyPerStar, wc.heatPerStar), bounty = Math.round(baseBounty * wc.reward * Math.max(0, 1 + fxMe.arrestReward)), jailMs = Math.min(wc.jailMax, wc.jailPerStar * stars);
    // 懸賞金の出どころ: 逮捕された人の罰金(予算がオンなら、予算に入る)→ そこから、逮捕した人に払う
    const fineAmt = Math.round(baseBounty * wc.bountyFine * Math.max(0, 1 + fxTg.arrestFine)), took = fineAmt > 0 ? fine(g, target.id, fineAmt, s, 'arrest') : 0; // 罰金は、懸賞金(基本)に対する割合。報酬の割合とは、別
    const p = pay(g, me, bounty, s);
    jail(g, target.id, jailMs); clearHeat(g, target.id);
    await i.reply({ embeds: [card(i, s, GOLD, '👮 逮捕成功!', `${starText(stars)} <@${target.id}> を逮捕しました!\n🚔 留置場に ${dur(jailMs)} 入ります。\n\n懸賞金 **+ ${money(s, p.paid)}**${shortNote(s, p)}${took ? `\n-# <@${target.id}> が、罰金 ${money(s, took)} を支払いました(懸賞金は、ここから払われます)` : ''}`)], allowedMentions: NO_MENTIONS });
  },
};

export const commands = [detailCommand, balanceCommand, depositCommand, withdrawCommand, richestCommand, crimeCommand, workCommand, begCommand, bailCommand, chinchiroCommand, slotCommand, blackjackCommand, blackjackEndCommand, heistCommand, shopCommand, useCommand, giveCommand, petCommand, stockCommand, newsCommand, scandalCommand, lotteryCommand, estateCommand, cooldownsCommand, jobCommand, wantedCommand, arrestCommand, marketCommand, releaseCommand, payCommand, balanceEditCommand, cooldownResetCommand];
