import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getSettings, money } from './settings.js';
import { audit, peek, deposit, withdraw, cooldownLeft, setCooldown, jailLeft, jail, release, richest, getBj, saveBj, deleteBj, getHeist, saveHeist, claimHeist, expiredHeists, setHeistDeadline, releaseAll } from './db.js';
import { ensureAccount, pay, collect, fine, treasury } from './ledger.js';
import { hasAccessSync } from '../../core/access.js';
import {
  rnd, roundProb, chinchiroPlay, chinchiroCompare, chinchiroScale, slotSpin, slotPayout, slotMultiplier,
  bjDeal, bjHit, bjStand, bjDouble, handValue, cardText, bjScale,
} from './games.js';
import { CRIMES, JOBS, resolveCrime, resolveWork, resolveBeg, BEG } from './jobs.js';
import { HEIST, makeSteps, heistReward, heistBase, heistFine } from './heist.js';

const EPH = { flags: MessageFlags.Ephemeral };
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
  if (bet > s.maxBet) { await refuse(i, `賭けられるのは、最大 ${money(s, s.maxBet)} までです。`); return null; }
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

export const richestCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('richest').setDescription('お金持ちランキング(手持ち + 銀行)')),
  async execute(i) {
    const s = await open(i); if (!s) return;
    const rows = richest(i.guildId, 10);
    if (!rows.length) return refuse(i, 'まだ、お金を持っている人がいません。');
    const M = ['🥇', '🥈', '🥉'];
    await i.reply({ content: `${s.currencyEmoji} **お金持ちランキング**\n\n${rows.map((r, n) => `${M[n] ?? `${n + 1}.`} <@${r.user_id}>  ${money(s, r.total)}`).join('\n')}`, allowedMentions: NO_MENTIONS });
  },
};

/* ================= 犯罪・バイト・乞食 ================= */
const crimeChoices = Object.entries(CRIMES).map(([value, c]) => ({ name: `${c.emoji} ${c.name}`, value }));
const jobChoices = Object.entries(JOBS).map(([value, j]) => ({ name: `${j.emoji} ${j.name}`, value }));

export const crimeCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('crime').setDescription('犯罪に挑戦します(成功すると大金。失敗すると罰金と留置場)')
    .addStringOption((o) => o.setName('type').setDescription('何をするか').setRequired(true).addChoices(...crimeChoices))),
  async execute(i, rng = rnd) {
    const s = await open(i); if (!s) return;
    const key = i.options.getString('type', true); const c = CRIMES[key];
    const jl = jailLeft(i.guildId, i.user.id); if (jl) return refuse(i, `🚔 留置場にいる間は、犯罪はできません。(あと ${dur(jl)}。/bail で保釈できます)`);
    const w = wallet(i); if (w <= 0) return refuse(i, `💸 所持金が0以下のときは、犯罪はできません。(いまの所持金 ${money(s, w)})\nバイト(/work)や乞食(/beg)で、お金を稼ぎましょう。`);
    const cd = cooldownLeft(i.guildId, i.user.id, `crime:${key}`); if (cd) return refuse(i, `${c.emoji} ${c.name}は、まだ警戒が厳しいです。あと ${dur(cd)}。`);
    if (budgetEmpty(s, i.guildId)) return refuse(i, BUDGET_EMPTY);
    const r = resolveCrime(key, rng);
    if (r.success) {
      const p = pay(i.guildId, i.user.id, r.amount, s);
      if (p.paid > 0) setCooldown(i.guildId, i.user.id, `crime:${key}`, c.cd);
      return i.reply({ embeds: [card(i, s, GREEN, `${c.emoji} ${c.name} 成功!`, `${r.text}\n\n**+ ${money(s, p.paid)}**${shortNote(s, p)}`)] });
    }
    const took = fine(i.guildId, i.user.id, r.amount, s, 'crime');
    jail(i.guildId, i.user.id, c.jail); setCooldown(i.guildId, i.user.id, `crime:${key}`, c.cd);
    await i.reply({ embeds: [card(i, s, RED, `${c.emoji} ${c.name} 失敗…`, `${r.text}\n\n罰金 **- ${money(s, took)}**${debtNote(i, s)}\n🚔 留置場に ${dur(c.jail)} 入ります。(/bail で、保釈金を払って出られます)`)] });
  },
};
export const workCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('work').setDescription('バイトをして、給料をもらいます')
    .addStringOption((o) => o.setName('job').setDescription('どのバイトか').setRequired(true).addChoices(...jobChoices))),
  async execute(i, rng = rnd) {
    const s = await open(i); if (!s) return;
    const key = i.options.getString('job', true); const j = JOBS[key];
    const jl = jailLeft(i.guildId, i.user.id); if (jl) return refuse(i, `🚔 留置場にいる間は、バイトはできません。(あと ${dur(jl)})`);
    const cd = cooldownLeft(i.guildId, i.user.id, `work:${key}`); if (cd) return refuse(i, `${j.emoji} ${j.name}のシフトは、あと ${dur(cd)} 後です。`);
    if (budgetEmpty(s, i.guildId)) return refuse(i, BUDGET_EMPTY);
    const r = resolveWork(key, rng);
    const p = pay(i.guildId, i.user.id, r.pay + (r.bonus?.amount ?? 0), s);
    if (p.paid > 0) setCooldown(i.guildId, i.user.id, `work:${key}`, j.cd);
    await i.reply({ embeds: [card(i, s, GREEN, `${j.emoji} ${j.name}のバイト`, `${r.text}\n\n給料 **+ ${money(s, r.pay)}**${r.bonus ? `\n${r.bonus.text} **+ ${money(s, r.bonus.amount)}**` : ''}${shortNote(s, p)}${debtNote(i, s)}`)] });
  },
};
export const begCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('beg').setDescription('道ばたで、お金をめぐんでもらいます')),
  async execute(i, rng = rnd) {
    const s = await open(i); if (!s) return;
    const cd = cooldownLeft(i.guildId, i.user.id, 'beg'); if (cd) return refuse(i, `今日はもう、人通りが少ないようです。あと ${dur(cd)}。`);
    if (budgetEmpty(s, i.guildId)) return refuse(i, BUDGET_EMPTY);
    const r = resolveBeg(rng); setCooldown(i.guildId, i.user.id, 'beg', BEG.cd);
    if (!r.amount) return i.reply({ embeds: [card(i, s, GRAY, '🙏 乞食', `${r.text}`)] });
    const p = pay(i.guildId, i.user.id, r.amount, s);
    await i.reply({ embeds: [card(i, s, GREEN, '🙏 乞食', `${r.text}\n\n**+ ${money(s, p.paid)}**${shortNote(s, p)}${debtNote(i, s)}`)] });
  },
};
export const bailCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('bail').setDescription('保釈金を払って、留置場から出ます(残り1分につき 100)')),
  async execute(i) {
    const s = await open(i); if (!s) return;
    const jl = jailLeft(i.guildId, i.user.id); if (!jl) return refuse(i, '留置場には、入っていません。');
    const cost = Math.ceil(jl / 60_000) * 100;
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

/* ================= 大型銀行強盗(ミニゲーム) ================= */
/** 失敗の精算(罰金と留置場)。claim できたときだけ精算するので、二重に罰金が引かれない。精算したら、そのゲームを返す */
function settleHeistFailure(g, u, s, reason, rng = rnd) {
  const game = claimHeist(g, u); if (!game) return null;
  const took = fine(g, u, heistFine(rng), s, 'heist'); jail(g, u, HEIST.jail);
  return { game, took, reason };
}
const REASON = { timeout: '⏰ 時間切れ! 警備員に見つかった。', alarm: `🚨 ${HEIST.maxMistakes + 1}回間違えて、警報が鳴り響いた!` };
const failEmbed = (s, name, r) => new EmbedBuilder().setColor(RED).setTitle(`${HEIST.emoji} ${HEIST.name} 失敗…`)
  .setDescription(`${REASON[r.reason]}\n\n罰金 **- ${money(s, r.took)}**\n🚔 留置場に ${dur(HEIST.jail)} 入ります。(/bail で、保釈金を払って出られます)`).setAuthor({ name });
const hsStatus = (st, deadline) => {
  const left = HEIST.maxMistakes - st.mistakes;
  return `制限時間: <t:${Math.floor(deadline / 1000)}:R> まで ・ ステップ **${st.idx + 1} / ${st.steps.length}** ・ 間違えられるのは あと **${left}回**`;
};
function hsBody(st, deadline, uid, warn = '') {
  const step = st.steps[st.idx];
  const e = new EmbedBuilder().setColor(BLUE).setTitle(`${HEIST.emoji} ${HEIST.name}`).setAuthor({ name: st.name, iconURL: st.avatar })
    .setDescription(`${hsStatus(st, deadline)}\n\n${warn ? `${warn}\n\n` : ''}${step.prompt}`);
  const row = new ActionRowBuilder().addComponents(step.options.map((label, k) =>
    new ButtonBuilder().setCustomId(`eco:hs:${uid}:${st.idx}:${k}`).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(st.wrong.includes(k))));
  return { embeds: [e], components: [row] };
}
export const heistCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('heist').setDescription(`大型銀行強盗(ミニゲーム。${HEIST.timeMs / 1000}秒以内に、${HEIST.steps}つの問題を解けば成功)`)),
  async execute(i, rng = rnd) {
    const s = await open(i); if (!s) return;
    const g = i.guildId, u = i.user.id;
    const jl = jailLeft(g, u); if (jl) return refuse(i, `🚔 留置場にいる間は、犯罪はできません。(あと ${dur(jl)})`);
    const w = wallet(i); if (w <= 0) return refuse(i, `💸 所持金が0以下のときは、犯罪はできません。(いまの所持金 ${money(s, w)})`);
    if (getHeist(g, u)) return refuse(i, '進行中の大型銀行強盗があります。先に、そちらを終わらせてください。');
    const cd = cooldownLeft(g, u, 'heist'); if (cd) return refuse(i, `${HEIST.emoji} 大型銀行は、まだ警備が厳重です。あと ${dur(cd)}。`);
    if (budgetEmpty(s, g)) return refuse(i, BUDGET_EMPTY);
    const st = { steps: makeSteps(rng), idx: 0, mistakes: 0, wrong: [], reward: heistBase(rng), name: i.member?.displayName ?? i.user.username, avatar: i.user.displayAvatarURL?.() };
    const deadline = (i.createdTimestamp ?? Date.now()) + HEIST.timeMs; // コマンドを打った時刻から数える(BOTの処理の遅れで、短くならない)
    setCooldown(g, u, 'heist', HEIST.cd);
    saveHeist(g, u, { channelId: i.channelId, state: st, deadline });  // 先に保存してから返信する
    try { await i.reply(hsBody(st, deadline, u)); }
    catch (e) { claimHeist(g, u); setCooldown(g, u, 'heist', 0); throw e; } // 画面を出せなかったときは、遊んでいないので、罰を受けない
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
    const st = game.state;
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
        const left = Math.max(0, game.deadline - now), amount = heistReward(st.reward, left);
        const p = pay(g, uid, amount, s);
        return safeUpdate(i, { embeds: [new EmbedBuilder().setColor(GOLD).setTitle(`${HEIST.emoji} ${HEIST.name} 成功!`).setAuthor({ name: st.name, iconURL: st.avatar })
          .setDescription(`金庫を開けて、大金を持ち出した!\n残り ${dur(left)} でクリア(スピードボーナス +${Math.round((amount / st.reward - 1) * 100)}%)\n\n**+ ${money(s, p.paid)}**${shortNote(s, p)}`)], components: [] });
      }
      saveHeist(g, uid, { state: st, deadline: game.deadline });
      return safeUpdate(i, hsBody(st, game.deadline, uid));
    }
    st.mistakes++; st.wrong.push(k);
    if (st.mistakes > HEIST.maxMistakes) { // 警報
      const r = settleHeistFailure(g, uid, s, 'alarm');
      return safeUpdate(i, r ? { embeds: [failEmbed(s, st.name, r)], components: [] } : { content: 'この強盗は、すでに終了しています。', embeds: [], components: [] });
    }
    saveHeist(g, uid, { state: st, deadline: game.deadline });
    await safeUpdate(i, hsBody(st, game.deadline, uid, '⚠️ 違う! 警報が鳴りかけた…'));
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

export const commands = [balanceCommand, depositCommand, withdrawCommand, richestCommand, crimeCommand, workCommand, begCommand, bailCommand, chinchiroCommand, slotCommand, blackjackCommand, heistCommand, releaseCommand];
