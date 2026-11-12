import crypto from 'node:crypto';

// DBに保存する秘密の値(連携トークンなど)を暗号化する。鍵は SESSION_SECRET から作る(AES-256-GCM)。
// SESSION_SECRET を変えると復号できなくなる(連携をやり直す)
let key;
const getKey = () => (key ??= crypto.scryptSync(process.env.SESSION_SECRET || 'dev-only-secret', 'lumi-secrets-v1', 32));

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

/** 復号できなければ null(鍵が変わった、改ざんされた、など) */
export function decrypt(blob) {
  try {
    const [iv, tag, enc] = String(blob).split('.').map((s) => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return null; }
}
