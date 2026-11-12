import { getKV, setKV } from '../../core/db.js';

export const getSettings = (guildId) => getKV(guildId, 'message_link', { enabled: false }); // 既定はオフ
export const setSettings = (guildId, s) => setKV(guildId, 'message_link', s);
