import { createRequire } from 'node:module';
import path from 'node:path';
import { toHira, isKana } from './game.js';
import { WORDS } from './words.js';

/** JMdict(EDRDG・CC BY-SA 4.0)の、3〜5文字の、ことば約9万語(読み)。はじめて使うときに、読み込む */
let knownP = null;
function knownReadings() {
  return (knownP ??= (async () => {
    try {
      const { unpack } = await import('@johnmorrisdotca/kotoba');
      const set = new Set();
      for (const n of [3, 4, 5]) { const mod = await import(`@johnmorrisdotca/kotoba/kana-${n}`); for (const w of unpack(Object.values(mod)[0], n).allowed) set.add(w); }
      return set;
    } catch (e) { console.warn('[shiritori] JMdictの語彙を読み込めませんでした:', e.message); return new Set(); }
  })());
}

/**
 * 人の言葉の、辞書チェックと、漢字の読み取り(形態素解析 kuromoji + IPA辞書)。
 *  ・かな: ルミの辞書にある言葉、または、ひらがな/カタカナで、名詞として、辞書に載っている言葉
 *  ・漢字まじり: 名詞として、読みを取り出す(林檎 → りんご)
 * 辞書は、はじめて使うときに、読み込む(数百ms・メモリ 約300MB)。読み込めなければ、チェックはしない(遊びは、止めない)
 */
const require = createRequire(import.meta.url);
let loading = null, idleTimer = null;
const IDLE_MS = 10 * 60_000; // 10分、使われなかったら、辞書を手放す(メモリを返す)
export function tokenizer() {
  clearTimeout(idleTimer); idleTimer = setTimeout(() => { loading = null; }, IDLE_MS); idleTimer.unref?.();
  if (!loading) loading = new Promise((resolve) => {
    try {
      const kuromoji = require('kuromoji');
      const dicPath = path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict');
      kuromoji.builder({ dicPath }).build((err, tk) => { if (err) { console.warn('[shiritori] 辞書を読み込めませんでした:', err.message); resolve(null); } else resolve(tk); });
    } catch (e) { console.warn('[shiritori] 辞書を使えません:', e.message); resolve(null); }
  });
  return loading;
}
const toKata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const OK_DETAIL = new Set(['一般', '固有名詞', 'サ変接続', '副詞可能', '形容動詞語幹', 'ナイ形容詞語幹', '特殊']);
/** 名詞だけで、できた言葉か(2つ以上に分かれるときは、最初以外の「接尾」(〜さん・〜山など)を許す)。OK なら、読み(ひらがな)を返す */
function nounReading(tokens, allowUnknown) {
  if (!tokens.length) return null;
  let reading = '';
  for (let n = 0; n < tokens.length; n++) {
    const t = tokens[n];
    if (t.pos !== '名詞') return null;
    if (!(OK_DETAIL.has(t.pos_detail_1) || (n > 0 && t.pos_detail_1 === '接尾'))) return null;
    if (t.word_type !== 'KNOWN') { if (!allowUnknown) return null; }
    reading += t.reading && t.reading !== '*' ? t.reading : t.surface_form;
  }
  return toHira(reading);
}
const BUILTIN = new Set(WORDS.map(toHira));

/**
 * 人の言葉を調べる。戻り値: { ok: true, reading, surface } / { ok: false, why }
 * check = false なら、辞書チェックは、しない(かなは、そのまま、漢字は、読みを取れたときだけ)
 */
export async function resolveWord(raw, { check = true, extra = null } = {}) {
  const text = String(raw ?? '').normalize('NFKC').replace(/[\s・]/g, ''), hira = toHira(text);
  if (!text) return { ok: false, why: '言葉が、空です。' };
  const kana = isKana(hira);
  if (kana && (!check || BUILTIN.has(hira) || extra?.has(hira))) return { ok: true, reading: hira, surface: text }; // extra: 運営が、登録した言葉
  if (kana && (await knownReadings()).has(hira)) return { ok: true, reading: hira, surface: text }; // JMdictにある言葉(辞書の読み込みは、いらない)
  const tk = await tokenizer();
  if (!tk) { // 辞書が使えない: かなは、そのまま通す。漢字は、読めないので、断る
    return kana ? { ok: true, reading: hira, surface: text } : { ok: false, why: '漢字は、いま、読み取れません。ひらがな・カタカナで、書いてください。' };
  }
  if (kana) { // かな: ひらがな・カタカナ、どちらかで、名詞として、載っているか
    for (const cand of [toKata(hira), hira]) { const r = nounReading(tk.tokenize(cand), false); if (r && isKana(r)) return { ok: true, reading: r, surface: text }; }
    return { ok: false, appeal: hira, why: `「${text}」は、辞書に見つかりません。(名詞で、別の書き方(カタカナ・漢字)も、試してください。**本当にある言葉なら、「異議申し立て」を、押してください**)` };
  }
  if (!/[一-鿿々〆ヶ]/.test(text) || /[A-Za-z0-9]/.test(text)) return { ok: false, why: 'ひらがな・カタカナ・漢字だけで、書いてください。(英数字・記号は、使えません)' };
  const r = nounReading(tk.tokenize(text), false);
  if (!r || !isKana(r)) return { ok: false, why: `「${text}」は、名詞として、読み取れませんでした。(ひらがな・カタカナで、書いてみてください)` };
  return { ok: true, reading: r, surface: text };
}
