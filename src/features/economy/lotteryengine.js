import { EmbedBuilder } from 'discord.js';
import { db } from '../../core/db.js';
import { claimLotteryRounds, claimOrphanTickets, lotteryJackpot, setLotteryJackpot, recordDraw, pendingLotteryGuilds, addWallet } from './db.js';
import { treasury, addTreasury } from './ledger.js';
import { getSettings, money } from './settings.js';
import { lotteriesOf, roundOf, drawTimeOf, drawNumber, settleRound, nextJackpot, pad } from './lottery.js';

/**
 * 締め切った回(いまの回より前)のくじを、くじの種類ごとに、まとめて抽選して、当選金を払う。
 * 1つの取引(トランザクション)で行うので、途中で止まっても、二重に払ったり、払い忘れたりしない。
 * くじが1枚もない回は、抽選しない(ジャックポットは、そのまま)。予算がオンのサーバーでは、当選金は予算から払われる(足りなければ、ある分だけ)。
 * 設定から消されたくじの売れ残りは、買ったときのくじ代で、払い戻す
 */
export function settleGuild(s, g, now = Date.now(), rng = null) {
  const out = [], lotteries = lotteriesOf(s);
  const give = (user, amount) => { let paid = amount; if (s.budgetEnabled) { paid = Math.min(amount, treasury(g)); if (paid > 0) addTreasury(g, -paid); } if (paid > 0) addWallet(g, user, paid); return paid; };
  db.exec('BEGIN');
  try {
    for (const L of lotteries) {
      const rows = claimLotteryRounds(g, L.id, roundOf(now, L) - 1);
      if (!rows.length) continue;
      const byRound = Map.groupBy(rows, (r) => r.round);
      let jackpot = lotteryJackpot(g, L.id, L.jackpotBase);
      for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
        const tickets = byRound.get(round), winning = drawNumber(L.digits, rng), res = settleRound(tickets, winning, L, jackpot);
        let paid = 0, short = 0; const winners = [];
        for (const [user, p] of res.payouts) { const got = give(user, p.amount); paid += got; short += p.amount - got; winners.push({ user, amount: got, short: p.amount - got, tiers: p.tiers }); }
        const next = nextJackpot(res, L, jackpot);
        setLotteryJackpot(g, L.id, next);
        const count = tickets.reduce((a, t) => a + t.qty, 0);
        recordDraw(g, L.id, { round, winning, jackpot: res.jackpot, jackpotWon: res.jackpotWon, tickets: count, sales: res.sales, paid, winners });
        const buyers = [...new Set(tickets.map((t) => t.user_id))];
        out.push({ lottery: L, round, buyers, drawAt: drawTimeOf(round, L), winning, jackpot: res.jackpot, jackpotWon: res.jackpotWon, tickets: count, sales: res.sales, paid, short, winners, nextJackpot: next });
        jackpot = next;
      }
    }
    for (const t of claimOrphanTickets(g, lotteries.map((x) => x.id))) { give(t.user_id, t.price * t.qty); out.push({ refund: true, user: t.user_id, amount: t.price * t.qty }); } // 消されたくじ: 払い戻し
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return out;
}

/** 抽選結果の発表の文(埋め込み) */
export function drawEmbed(s, d) {
  const L = d.lottery, w1 = d.winners.filter((x) => x.tiers[1] > 0), w2 = d.winners.reduce((a, x) => a + x.tiers[2], 0), w3 = d.winners.reduce((a, x) => a + x.tiers[3], 0);
  const e = new EmbedBuilder().setColor(d.jackpotWon ? 0xf1c40f : 0x3498db).setTitle(`${L.emoji} ${L.name} 抽選結果`)
    .setDescription(`当選番号: **${pad(d.winning, L.digits)}**\n販売 ${d.tickets.toLocaleString()}枚`)
    .addFields({ name: `🥇 1等(${L.digits}桁一致)${d.jackpotWon ? '' : ' — 該当なし'}`, value: d.jackpotWon ? w1.map((x) => `<@${x.user}> **${money(s, x.amount)}**${x.tiers[1] > 1 ? `(${x.tiers[1]}枚)` : ''}`).slice(0, 10).join('\n') : `ジャックポット **${money(s, d.nextJackpot)}** を、次回に持ち越し!`, inline: false },
      { name: `🥈 2等(下${L.digits - 1}桁一致)`, value: `${w2}枚`, inline: true }, ...(L.digits >= 3 ? [{ name: `🥉 3等(下${L.digits - 2}桁一致)`, value: `${w3}枚`, inline: true }] : []))
    .setFooter({ text: `当選金の合計 ${d.paid.toLocaleString()}${d.short ? `(予算が足りず ${d.short.toLocaleString()} は減額)` : ''}${d.jackpotWon ? ` ・ 次回のジャックポット ${d.nextJackpot.toLocaleString()}` : ''}` });
  return e;
}
export async function announce(client, s, g, d) {
  if (d.refund) return false;
  const id = d.lottery.channelId ?? s.lotteryChannelId; if (!id) return false;
  const ch = client.channels.cache.get(id); if (!ch?.isTextBased?.() || ch.guildId !== g) return false;
  // 買った人全員にメンション(1通のメンションは100人まで・文字数の上限もあるので、多いときは先頭から80人)
  const all = s.lotteryMention === false ? [] : (d.buyers ?? d.winners.map((x) => x.user)), users = all.slice(0, 80);
  const content = users.length ? `${users.map((u) => `<@${u}>`).join(' ')}${all.length > users.length ? ` ほか${all.length - users.length}人` : ''} ${d.lottery.emoji} ${d.lottery.name} の抽選結果です!` : undefined;
  try { await ch.send({ content, embeds: [drawEmbed(s, d)], allowedMentions: { users } }); return true; }
  catch (e) { console.warn(`[lottery] 発表を送れませんでした (${g}): ${e.message}`); return false; }
}
/** くじが残っているサーバーを、順に抽選して、発表する(1分ごとに呼ぶ) */
export async function settleAll(client, now = Date.now()) {
  for (const g of pendingLotteryGuilds()) {
    try {
      const s = getSettings(g);
      for (const d of settleGuild(s, g, now)) { if (!d.refund) console.log(`[lottery] ${g}/${d.lottery.name}: 当選番号 ${pad(d.winning, d.lottery.digits)} / 販売 ${d.tickets}枚 / 払い戻し ${d.paid}`); await announce(client, s, g, d); }
    } catch (e) { console.error(`[lottery] 抽選に失敗 (${g}):`, e.message); }
  }
}
