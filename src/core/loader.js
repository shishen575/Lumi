import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../features');

/**
 * src/features/<name>/index.js を自動ロードする。
 * 機能の形: export default { name, title, ui?, register({ client, router, getKV, setKV, db }) }
 * 無効化したい時は環境変数 DISABLED_FEATURES=name1,name2
 */
export async function loadFeatures() {
  const disabled = (process.env.DISABLED_FEATURES || '').split(',').map((s) => s.trim());
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('_') || disabled.includes(d.name)) continue;
    const file = path.join(dir, d.name, 'index.js');
    if (!fs.existsSync(file)) continue;
    const mod = (await import(pathToFileURL(file))).default;
    out.push(mod);
  }
  return out;
}
