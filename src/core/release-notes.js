import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// リリースノート(site/release-notes.json。新しいものが先頭、n は大きいほど新しい)。
// 更新のお知らせに添えるのと、更新履歴のページに表示するのと、同じファイルを使う
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../site/release-notes.json');

export function loadNotes(file = FILE) {
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return list.filter((e) => Number.isInteger(e?.n) && Array.isArray(e.items)).sort((a, b) => b.n - a.n);
  } catch (e) { console.warn('[release-notes] 読み込めませんでした:', e.message); return []; }
}
export const latestN = (notes) => notes[0]?.n ?? 0;
/** まだ知らせていない分(lastN より新しいもの)。lastN が無い(初めて)ときは、最新の1件だけ。最大 max 件、新しい順 */
export function unseen(notes, lastN, max = 3) {
  if (lastN == null) return notes.slice(0, 1);
  return notes.filter((e) => e.n > lastN).slice(0, max);
}
/** Discord向けの文字(`コード` はそのまま使える)。1つの欄が1024字を超えないように切る */
export function fieldFor(entry) {
  const lines = entry.items.map((it) => `・**${it.tag ?? '更新'}** ${it.text}`);
  let text = '';
  for (const l of lines) { if ((text + l + '\n').length > 1000) { text += '…(続きは更新履歴で)'; break; } text += l + '\n'; }
  return { name: `${entry.title}(${entry.date})`.slice(0, 256), value: text.trim() || '(内容なし)' };
}
