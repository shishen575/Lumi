import { PermissionFlagsBits } from 'discord.js';
import { getKV, setKV } from './db.js';

/**
 * ダッシュボードを操作できる人:
 *   運営(OPERATOR_IDS)      … BOTが入っている全サーバー
 *   オーナー / 管理者権限    … そのサーバー(常に。締め出し防止)
 *   管理ロールを持つ人       … そのサーバー(サーバーごとにダッシュボードで選ぶ)
 * 「ロールの管理」権限だけでは操作できない。
 */
export const operatorIds = () => (process.env.OPERATOR_IDS || '').split(/[,\s]+/).filter(Boolean);
export const isOperator = (userId) => operatorIds().includes(userId);

export const getAdminRoles = (guildId) => getKV(guildId, 'admin_roles', []);
export const setAdminRoles = (guildId, ids) => setKV(guildId, 'admin_roles', ids);

/** 'operator' | 'owner' | 'admin' | 'role' | null */
export async function resolveAccess(guild, userId) {
  const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
  if (isOperator(userId)) return { level: 'operator', member };
  if (!member) return { level: null, member: null };
  if (guild.ownerId === userId) return { level: 'owner', member };
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return { level: 'admin', member };
  if (getAdminRoles(guild.id).some((id) => member.roles.cache.has(id))) return { level: 'role', member };
  return { level: null, member };
}

/** スラッシュコマンドなど、すでにメンバー情報がある場面用(同期) */
export function hasAccessSync(guild, member, userId) {
  if (isOperator(userId)) return true;
  if (!guild || !member) return false;
  if (guild.ownerId === userId || member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const has = (id) => (member.roles?.cache ? member.roles.cache.has(id) : member.roles?.includes?.(id));
  return getAdminRoles(guild.id).some(has);
}

export const canEditAccess = (level) => level === 'operator' || level === 'owner' || level === 'admin';

/** /api/guilds/:gid/... の入口。権限は毎回ライブに確認し、req.guild / req.access / req.actor / req.canAssign を用意する */
export function guildAccess(client) {
  return async (req, res, next) => {
    const uid = req.session.user.id;
    const guild = client.guilds.cache.get(req.params.gid);
    if (!guild) return res.status(isOperator(uid) ? 404 : 403).json({ error: isOperator(uid) ? 'bot is not in this server' : 'forbidden' });
    const { level, member } = await resolveAccess(guild, uid);
    if (!level) return res.status(403).json({ error: 'このサーバーを管理する権限がありません' });
    req.guild = guild;
    req.access = level;
    req.member = member;
    req.actor = { id: uid, displayName: member?.displayName ?? req.session.user.name };
    // 管理ロールの人は、自分の最上位ロールより下のロールしか付与対象にできない(権限昇格の防止)
    const unrestricted = level !== 'role';
    req.canAssign = (role) => unrestricted || (!!member && role.position < member.roles.highest.position);
    next();
  };
}

/** アクセス設定のAPI(管理ロールの選択)。変更できるのはオーナー・管理者・運営だけ */
export function mountAccessRoutes(router) {
  router.get('/access', (req, res) => res.json({
    level: req.access, canEdit: canEditAccess(req.access), roles: getAdminRoles(req.guild.id),
  }));
  router.put('/access', (req, res) => {
    if (!canEditAccess(req.access)) return res.status(403).json({ error: '変更できるのは、サーバーのオーナー・管理者・運営だけです' });
    const ids = [...new Set((Array.isArray(req.body?.roles) ? req.body.roles : []).map(String))];
    if (ids.length > 25) return res.status(400).json({ error: '選べるロールは25個までです' });
    for (const id of ids) {
      const r = req.guild.roles.cache.get(id);
      if (!r || r.id === req.guild.id || r.managed) return res.status(400).json({ error: '選べないロールが含まれています' });
    }
    setAdminRoles(req.guild.id, ids);
    res.json({ ok: true });
  });
}
