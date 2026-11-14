// データベースの書き出し(引っ越し用)。BOTが動いていても使える、一貫したコピーを作る。
//   node scripts/export-db.mjs [出力ファイル(既定 export.db)]
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const src = `${process.env.DATA_DIR || 'data'}/bot.db`, out = process.argv[2] || 'export.db';
if (!fs.existsSync(src)) { console.error(`${src} が見つかりません`); process.exit(1); }
if (fs.existsSync(out)) { console.error(`${out} がすでにあります。消すか、別の名前を指定してください`); process.exit(1); }
const db = new DatabaseSync(src, { readOnly: true });
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`); // WALの内容も含めた、1つのファイルにする
db.close();
console.log(`書き出しました: ${out} (${(fs.statSync(out).size / 1048576).toFixed(2)} MB)`);
