// 書き出したデータベースを、引っ越し先(MIGRATION_TOKEN を設定したLumi)に送る。
//   node scripts/upload-db.mjs <ファイル> <https://引っ越し先のアドレス> <MIGRATION_TOKEN> [--force]
//   --force: すでに引っ越し済みのサーバーに、もう一度送る(データを入れ替え直す)
import fs from 'node:fs';

const args = process.argv.slice(2), force = args.includes('--force');
const [file, base, token] = args.filter((a) => a !== '--force');
if (!file || !base || !token) { console.error('使い方: node scripts/upload-db.mjs <ファイル> <https://アドレス> <トークン>'); process.exit(1); }
const body = fs.readFileSync(file);
console.log(`送信中: ${(body.length / 1048576).toFixed(2)} MB → ${base}`);
const res = await fetch(`${base.replace(/\/$/, '')}/migrate/import${force ? '?force=1' : ''}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }, body });
const text = await res.text();
console.log(res.status, text);
process.exit(res.ok ? 0 : 1);
