import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getSettings, money } from './settings.js';
import { peek, deposit, withdraw, cooldownLeft, setCooldown, jailLeft, jail, release, richest, getBj, saveBj, deleteBj } from './db.js';
import { ensureAccount, pay, collect, fine, treasury } from './ledger.js';
import {
  rnd, roundProb, chinchiroPlay, chinchiroCompare, chinchiroScale, slotSpin, slotPayout, slotMultiplier,
  bjDeal, bjHit, bjStand, bjDouble, handValue, cardText, bjScale,
} from './games.js';
import { CRIMES, JOBS, resolveCrime, resolveWork, resolveBeg, BEG } from './jobs.js';

const EPH = { flags: MessageFlags.Ephemeral };
const NO_MENTIONS = { parse: [] };
const GREEN = 0x57f287, RED = 0xed4245, GOLD = 0xf1c40f, BLUE = 0x5865f2, GRAY = 0x99aab5;
const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const BJ_TTL = 10 * 60_000;

const dur = (ms) => { const t = Math.ceil(ms / 1000), m = Math.floor(t / 60), r = t % 60; return m ? `${m}分${r ? `${r}秒` : ''}` : `${r}秒`; };
const wallet = (i) => peek(i.guildId, i.user.id).wallet;
const card = (i, s, color, title, desc) => {
  const e = new EmbedBuilder().setColor(color).setTitle(title)
    .setAuthor({ name: i.member?.displayName ?? i.user.username, iconURL: i.user.displayAvatarURL?.() })
    .setFooter({ text: `所持金 ${money(s, wallet(i))}` });
  return desc ? e.setDescription(desc) : e; // Discordの埋め込みは、空の説明文を受け付けない
};
const guildOnly = (b) => b.setDMPermission(false);

/** 共通の入口: オフのサーバーでは断る。口座を用意して、時間切れのブラックジャックを精算する */
async function open(i) {
  const s = getSettings(i.guildId);
  if (!s.enabled) { await i.reply({ content: 'このサーバーでは、通貨機能がオフです。管理者が、ダッシュボードの「通貨」でオンにできます。', ...EPH }); return null; }
  ensureAccount(i.guildId, i.user.id, s);
  const b = getBj(i.guildId, i.user.id);
  if (b && Date.now() - b.started_at > BJ_TTL) deleteBj(i.guildId, i.user.id); // 時間切れ: 賭け金は戻らない
  return s;
}
const refuse = (i, text) => i.reply({ content: text, ...EPH });
const budgetEmpty = (s, g) => s.budgetEnabled && treasury(g) <= 0;
const BUDGET_EMPTY = 'いま、サーバーの予算が空です。管理者が予算を追加するまで、報酬はもらえません。';
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
      .addFields({ name: '手持ち', value: money(s, a.wallet), inline: true }, { name: '銀行', value: money(s, a.bank), inline: true }, { name: '合計', value: money(s, a.wallet + a.bank), inline: true })
      .setDescription(jl ? `🚔 留置場にいます(あと ${dur(jl)})` : '手持ちは、犯罪で捕まったときの罰金の対象です。銀行に預けると安全です。')], allowedMentions: NO_MENTIONS });
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
    const cd = cooldownLeft(i.guildId, i.user.id, `crime:${key}`); if (cd) return refuse(i, `${c.emoji} ${c.name}は、まだ警戒が厳しいです。あと ${dur(cd)}。`);
    if (budgetEmpty(s, i.guildId)) return refuse(i, BUDGET_EMPTY);
    const r = resolveCrime(key, rng);
    if (r.success) {
      const p = pay(i.guildId, i.user.id, r.amount, s);
      if (p.paid > 0) setCooldown(i.guildId, i.user.id, `crime:${key}`, c.cd);
      return i.reply({ embeds: [card(i, s, GREEN, `${c.emoji} ${c.name} 成功!`, `${r.text}\n\n**+ ${money(s, p.paid)}**${shortNote(s, p)}`)] });
    }
    const took = fine(i.guildId, i.user.id, r.amount, s);
    jail(i.guildId, i.user.id, c.jail); setCooldown(i.guildId, i.user.id, `crime:${key}`, c.cd);
    await i.reply({ embeds: [card(i, s, RED, `${c.emoji} ${c.name} 失敗…`, `${r.text}\n\n罰金 **- ${money(s, took)}**\n🚔 留置場に ${dur(c.jail)} 入ります。(/bail で、保釈金を払って出られます)`)] });
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
    await i.reply({ embeds: [card(i, s, GREEN, `${j.emoji} ${j.name}のバイト`, `${r.text}\n\n給料 **+ ${money(s, r.pay)}**${r.bonus ? `\n${r.bonus.text} **+ ${money(s, r.bonus.amount)}**` : ''}${shortNote(s, p)}`)] });
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
    await i.reply({ embeds: [card(i, s, GREEN, '🙏 乞食', `${r.text}\n\n**+ ${money(s, p.paid)}**${shortNote(s, p)}`)] });
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
      const extra = fine(i.guildId, i.user.id, bet * (r.mult - 1), s); // 倍払いのぶんは、持っている範囲まで
      title = '🎲 負け…'; color = RED; line = `**- ${money(s, bet + extra)}**(×${r.mult})`;
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
    if (!g) return i.update({ content: 'このゲームは、すでに終了しています。', embeds: [], components: [] });
    if (Date.now() - g.started_at > BJ_TTL) { deleteBj(i.guildId, uid); return i.update({ content: '時間切れで、ゲームが終了しました。(賭け金は戻りません)', embeds: [], components: [] }); }
    let st = g.state;
    if (action === 'double') {
      if (st.player.length !== 2 || st.doubled) return i.reply({ content: 'ダブルダウンは、最初の2枚のときだけです。', ...EPH });
      if (!collect(i.guildId, uid, st.bet, s)) return i.reply({ content: `ダブルダウンの賭け金が足りません。(必要 ${money(s, st.bet)})`, ...EPH });
      st = bjDouble(st);
    } else if (action === 'hit') st = bjHit(st);
    else if (action === 'stand') st = bjStand(st);
    else return;
    if (st.done) return i.update(bjFinish(i, s, st));
    saveBj(i.guildId, uid, g.msg_id, st);
    await i.update({ embeds: [bjEmbed(i, s, st, false)], components: bjButtons(i, st, s) });
  },
};

export const commands = [balanceCommand, depositCommand, withdrawCommand, richestCommand, crimeCommand, workCommand, begCommand, bailCommand, chinchiroCommand, slotCommand, blackjackCommand];
