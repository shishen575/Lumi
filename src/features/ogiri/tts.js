import { getKV, setKV } from '../../core/db.js';
import { encrypt, decrypt } from '../../core/crypto.js';

/**
 * 読み上げBOT(SHB2－読み上げBOT)との連携。
 * サーバーごとのトークン(読み上げBOTの /external on で発行)を、ダッシュボードに貼り付けて使う。
 * 読み上げの依頼は「送りっぱなし」: 失敗しても、大喜利の進行は止めない。
 */
const DEFAULT_URL = 'https://shb2-bot.shishen575.com/api/v1';
export const baseUrl = () => (process.env.TTS_API_URL || DEFAULT_URL).replace(/\/+$/, '');
const TIMEOUT_MS = 4000;

export const DEFAULT_TOGGLES = { odai: true, answer: true, sayName: true, result: true };
const KEY = 'ogiri_tts';
export const getTts = (guildId) => getKV(guildId, KEY, { tokenEnc: null, guildName: null, invalid: false, toggles: DEFAULT_TOGGLES });
const saveTts = (guildId, patch) => setKV(guildId, KEY, { ...getTts(guildId), ...patch });
export const setToggles = (guildId, t) => saveTts(guildId, { toggles: { ...DEFAULT_TOGGLES, ...t } });
export const setToken = (guildId, token, guildName) => saveTts(guildId, { tokenEnc: encrypt(token), guildName, invalid: false });
export const clearToken = (guildId) => saveTts(guildId, { tokenEnc: null, guildName: null, invalid: false });
export const markInvalid = (guildId) => saveTts(guildId, { invalid: true });
const tokenOf = (guildId) => { const t = getTts(guildId); return t.tokenEnc && !t.invalid ? decrypt(t.tokenEnc) : null; };

export class TtsError extends Error {
  constructor(status, body) { super(`TTS API ${status}${body?.error ? ` ${body.error}` : ''}`); this.status = status; this.body = body; }
}

async function call(path, token, { method = 'GET', body, key } = {}) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new TtsError(res.status, json);
  return json;
}

/** 貼り付けられたトークンの確認。成功すると { ok, guild_id, guild_name } */
export const health = (token) => call('/health', token);
export const session = (guildId, channelId) => {
  const token = tokenOf(guildId);
  if (!token) return Promise.resolve(null);
  return call(`/session?channel_id=${encodeURIComponent(channelId)}`, token);
};

/**
 * 読み上げを依頼する。kind: 'odai' | 'answer' | 'result'(サーバーの設定でオフなら、何もしない)
 * items: [{ text, user_id?, say_name? }] / key: 二重に読まないための Idempotency-Key
 * 例外は投げない。トークンが無効(401)と分かったら、以後の依頼を止める
 */
export async function speakFor(kind, guildId, channelId, items, key) {
  try {
    const t = getTts(guildId);
    if (!t.tokenEnc || t.invalid || !t.toggles?.[kind]) return null;
    const token = decrypt(t.tokenEnc);
    if (!token) return null; // 復号できない(SESSION_SECRETが変わった)。ダッシュボードで連携をやり直す
    const send = t.toggles.sayName ? items : items.map(({ say_name, ...rest }) => rest); // 「○○さん。」を読むかどうか
    return await call('/speak', token, { method: 'POST', body: { channel_id: channelId, items: send, source: 'lumi:ogiri' }, key });
  } catch (e) {
    if (e instanceof TtsError && e.status === 401) { markInvalid(guildId); console.warn(`[ogiri/tts] ${guildId}: トークンが無効です。連携を止めました`); }
    else console.warn(`[ogiri/tts] ${guildId}: 読み上げの依頼に失敗: ${e.message}`);
    return null;
  }
}
