import { canEditAccess } from '../../core/access.js';
import { getSettings, saveSettings } from './settings.js';
import { richest, jailed, release, jailLeft, releaseAll, peek, recentFines, claimFineRefund, audit, recentAudit, adjustBalance, clearCooldowns } from './db.js';
import { treasury, setTreasury, addTreasury, circulation, pay } from './ledger.js';
import { SLOT_SYMBOLS, CHERRY_TWO, CHERRY_ONE, slotRtp, slotScale, chinchiroScale, bjScale, bjStats } from './games.js';

/** router は /api/guilds/:gid/f/economy に載っていて、req.guild / req.access が使える */
export function mountApi(router) {
  const view = (req) => ({ ...getSettings(req.guild.id), treasury: treasury(req.guild.id), circulation: circulation(req.guild.id), canEditBudget: canEditAccess(req.access) });

  router.get('/settings', (req, res) => res.json(view(req)));
  router.put('/settings', (req, res) => {
    const b = req.body ?? {};
    // 予算のオン・オフは、お金の総量を決めるので、オーナー・管理者・運営だけ
    if (b.budgetEnabled !== undefined && !!b.budgetEnabled !== getSettings(req.guild.id).budgetEnabled && !canEditAccess(req.access)) {
      return res.status(403).json({ error: '予算のオン・オフを変えられるのは、サーバーのオーナー・管理者・運営だけです' });
    }
    saveSettings(req.guild.id, b);
    res.json(view(req));
  });

  // 予算の金額: set(その金額にする) / add(追加) / subtract(減らす)
  router.post('/budget', (req, res) => {
    if (!canEditAccess(req.access)) return res.status(403).json({ error: '予算を変えられるのは、サーバーのオーナー・管理者・運営だけです' });
    const amount = Math.floor(Number(req.body?.amount));
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e12) return res.status(400).json({ error: '金額は、0以上の整数にしてください' });
    const mode = req.body?.mode;
    if (mode === 'set') setTreasury(req.guild.id, amount);
    else if (mode === 'add') addTreasury(req.guild.id, amount);
    else if (mode === 'subtract') addTreasury(req.guild.id, -amount);
    else return res.status(400).json({ error: '操作が不正です' });
    res.json(view(req));
  });

  router.get('/richest', async (req, res) => {
    const rows = richest(req.guild.id, 10);
    res.json(await Promise.all(rows.map(async (r) => {
      const m = req.guild.members.cache.get(r.user_id) ?? (await req.guild.members.fetch(r.user_id).catch(() => null));
      return { user_id: r.user_id, name: m?.displayName ?? r.user_id, total: r.total, wallet: r.wallet, bank: r.bank };
    })));
  });

  // 留置場: いま入っている人の一覧と、釈放(サーバー側で、管理者が行う)
  router.get('/jail', async (req, res) => {
    const now = Date.now();
    res.json(await Promise.all(jailed(req.guild.id, now).map(async (r) => {
      const m = req.guild.members.cache.get(r.user_id) ?? (await req.guild.members.fetch(r.user_id).catch(() => null));
      return { user_id: r.user_id, name: m?.displayName ?? r.user_id, left: r.jail_until - now };
    })));
  });
  router.post('/release', (req, res) => {
    const g = req.guild.id;
    if (req.body?.all) { const n = releaseAll(g); audit(g, req.actor, null, '全員を釈放', null, `${n}人`); return res.json({ released: n }); }
    const uid = String(req.body?.user_id ?? '');
    if (!/^\d{5,25}$/.test(uid)) return res.status(400).json({ error: 'ユーザーが不正です' });
    if (!jailLeft(g, uid)) return res.status(404).json({ error: 'その人は、留置場にいません' });
    release(g, uid); audit(g, req.actor, uid, '釈放', null, null); res.json({ released: 1 });
  });

  /* ---------- 管理者の操作(残高の調整・罰金の返金)。お金を動かすので、オーナー・管理者・運営だけ。すべて記録に残す ---------- */
  const adminOnly = (req, res) => { if (canEditAccess(req.access)) return true; res.status(403).json({ error: 'この操作ができるのは、サーバーのオーナー・管理者・運営だけです' }); return false; };
  const ID = /^\d{5,25}$/;
  const nameOf = async (guild, id) => (guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null)))?.displayName ?? id;

  // メンバーを名前で探す(最大10人)
  router.get('/members', async (req, res) => {
    const q = String(req.query.q ?? '').trim().slice(0, 32);
    if (!q) return res.json([]);
    const found = ID.test(q) ? [await req.guild.members.fetch(q).catch(() => null)].filter(Boolean) : [...(await req.guild.members.search({ query: q, limit: 10 }).catch(() => new Map())).values()];
    res.json(found.filter((m) => !m.user.bot).map((m) => ({ id: m.id, name: m.displayName })));
  });
  // 1人の口座と、最近の罰金
  router.get('/account/:uid', async (req, res) => {
    const g = req.guild.id, uid = req.params.uid;
    if (!ID.test(uid)) return res.status(400).json({ error: 'ユーザーが不正です' });
    const a = peek(g, uid);
    res.json({ id: uid, name: await nameOf(req.guild, uid), wallet: a.wallet, bank: a.bank, jailLeft: jailLeft(g, uid), fines: recentFines(g, uid, 10) });
  });
  // 残高の調整
  router.post('/adjust', async (req, res) => {
    if (!adminOnly(req, res)) return;
    const b = req.body ?? {}, g = req.guild.id, uid = String(b.user_id ?? '');
    const amount = Math.floor(Number(b.amount));
    if (!ID.test(uid)) return res.status(400).json({ error: 'ユーザーが不正です' });
    if (!['wallet', 'bank'].includes(b.target) || !['add', 'subtract', 'set'].includes(b.mode)) return res.status(400).json({ error: '操作が不正です' });
    if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) return res.status(400).json({ error: '金額は、0以上の整数にしてください' });
    const s = getSettings(g);
    const before = peek(g, uid);
    const after = adjustBalance(g, uid, { target: b.target, mode: b.mode, amount, allowDebt: s.allowDebt });
    const col = b.target === 'bank' ? 'bank' : 'wallet';
    audit(g, req.actor, uid, `${b.target === 'bank' ? '銀行' : '手持ち'}を${{ add: '増やす', subtract: '減らす', set: '指定額にする' }[b.mode]}`, amount, `${before[col]} → ${after[col]}${b.note ? ` / ${b.note}` : ''}`);
    res.json({ wallet: after.wallet, bank: after.bank });
  });
  // クールダウンの解除
  router.post('/cooldown-reset', async (req, res) => {
    if (!adminOnly(req, res)) return;
    const uid = String(req.body?.user_id ?? ''), kind = req.body?.kind ?? 'all';
    if (!ID.test(uid) || !['all', 'crime', 'work', 'beg', 'heist'].includes(kind)) return res.status(400).json({ error: '指定が不正です' });
    const n = clearCooldowns(req.guild.id, uid, kind);
    audit(req.guild.id, req.actor, uid, `クールダウン解除(${kind})`, null, `${n}件`);
    res.json({ cleared: n });
  });
  // 罰金の返金(1つの罰金につき、1回だけ)
  router.post('/refund', async (req, res) => {
    if (!adminOnly(req, res)) return;
    const g = req.guild.id, id = Number(req.body?.fine_id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: '罰金が不正です' });
    const row = claimFineRefund(g, id);
    if (!row) return res.status(404).json({ error: 'その罰金は、すでに返金済みか、返金できません' });
    const s = getSettings(g); const p = pay(g, row.user_id, row.amount, s); // 予算がオンのときは、予算から返す(足りなければ、ある分だけ)
    audit(g, req.actor, row.user_id, `罰金の返金(${row.kind === 'heist' ? '大型銀行' : '犯罪'})`, p.paid, p.short ? `予算が足りず ${p.short} は返金できませんでした` : null);
    res.json({ paid: p.paid, short: p.short });
  });
  router.get('/audit', async (req, res) => {
    const rows = recentAudit(req.guild.id, 20);
    res.json(await Promise.all(rows.map(async (r) => ({ ...r, target_name: r.target_id ? await nameOf(req.guild, r.target_id) : null }))));
  });

  // 還元率(%)を変えたときの、配当表のプレビュー
  router.get('/rates', (req, res) => {
    const rate = Math.min(150, Math.max(50, Number.parseInt(req.query.rate, 10) || 95));
    const k = slotScale(rate);
    res.json({
      rate, baseSlotRtp: slotRtp() * 100,
      slot: SLOT_SYMBOLS.map((x) => ({ symbol: x.s, three: +(x.three * k).toFixed(2) })), cherryTwo: +(CHERRY_TWO * k).toFixed(2), cherryOne: +(CHERRY_ONE * k).toFixed(2),
      chinchiro: +chinchiroScale(rate).toFixed(3), blackjack: +bjScale(rate).toFixed(3), baseBlackjack: (1 + bjStats().win - bjStats().lose) * 100,
    });
  });
}
