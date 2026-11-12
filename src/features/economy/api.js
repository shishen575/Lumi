import { canEditAccess } from '../../core/access.js';
import { getSettings, saveSettings } from './settings.js';
import { richest, jailed, release, jailLeft, releaseAll } from './db.js';
import { treasury, setTreasury, addTreasury, circulation } from './ledger.js';
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
    if (req.body?.all) return res.json({ released: releaseAll(g) });
    const uid = String(req.body?.user_id ?? '');
    if (!/^\d{5,25}$/.test(uid)) return res.status(400).json({ error: 'ユーザーが不正です' });
    if (!jailLeft(g, uid)) return res.status(404).json({ error: 'その人は、留置場にいません' });
    release(g, uid); res.json({ released: 1 });
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
