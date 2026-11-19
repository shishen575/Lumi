import { WORDS } from './words.js';
import { THEME } from './theme.js';

/**
 * しりとりのルール(辞書は、BOTが答えるための、言葉の一覧だけ。人の言葉が、実在するかは、調べない)
 *  ・ひらがな・カタカナ(と「ー」)の、2文字以上。漢字・英数字・記号は、使えない
 *  ・前の言葉の、最後の文字から、始める。「ん」で終わったら、負け。同じ言葉を、2回使ったら、負け
 *  ・最後が「ー」なら、その前の文字の母音(らーめん → ん ではなく、らーめ → え)。小さい「ゃゅょっぁぃぅぇぉ」は、大きい字にして数える
 *  ・濁点・半濁点は、区別する(き と ぎ は、別の字)
 */
const SMALL = { ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お', ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', ゎ: 'わ', っ: 'つ' };
const VOWEL_ROWS = { あ: 'あかさたなはまやらわがざだばぱぁゃゎ', い: 'いきしちにひみりぎじぢびぴぃ', う: 'うくすつぬふむゆるぐずづぶぷぅゅっ', え: 'えけせてねへめれげぜでべぺぇ', お: 'おこそとのほもよろをごぞどぼぽぉょ' };
const VOWEL_OF = new Map(Object.entries(VOWEL_ROWS).flatMap(([v, chars]) => [...chars].map((c) => [c, v])));

/** カタカナ → ひらがな。全角・半角のスペースや、「・」は、取り除く */
export const toHira = (s) => String(s ?? '').normalize('NFKC').replace(/[\s・]/g, '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
export const isKana = (s) => /^[ぁ-ゖー]+$/.test(s) && !/^ー/.test(s);
/** その言葉の、「次に始める文字」(最後の文字。ー のときは、その前の文字の母音。小さい字は、大きい字に) */
export function tailOf(word) {
  const chars = [...word];
  let i = chars.length - 1;
  while (i > 0 && chars[i] === 'ー') i--; // 末尾の ー は、読みとばす
  let c = chars[i];
  if (chars[chars.length - 1] === 'ー') c = VOWEL_OF.get(SMALL[c] ?? c) ?? c; // らーめーん?: 長音は、母音に
  return SMALL[c] ?? c;
}
export const headOf = (word) => { const c = [...word][0]; return SMALL[c] ?? c; };

/** 辞書(ひらがなだけ・2文字以上・「ん」で終わらない)と、最初の文字ごとの索引 */
const DICT = WORDS.map(toHira).filter((w) => isKana(w) && [...w].length >= 2 && tailOf(w) !== 'ん');
const BY_HEAD = new Map();
for (const w of new Set(DICT)) { const h = headOf(w); (BY_HEAD.get(h) ?? BY_HEAD.set(h, []).get(h)).push(w); }
export const dictSize = () => new Set(DICT).size;
/** テーマの言葉(ポケモン・ミク): 「ん」で終わらない、2文字以上のものを、ルミの語彙に(設定でオフにできる) */
const THEME_BY_HEAD = new Map();
for (const x of THEME) { const w = toHira(x.reading); if (!isKana(w) || [...w].length < 2 || tailOf(w) === 'ん') continue; const h = headOf(w); (THEME_BY_HEAD.get(h) ?? THEME_BY_HEAD.set(h, []).get(h)).push(w); }
export const themeSize = () => [...THEME_BY_HEAD.values()].reduce((a, l) => a + l.length, 0);
const headList = (c, theme) => (theme ? [...(BY_HEAD.get(c) ?? []), ...(THEME_BY_HEAD.get(c) ?? [])] : (BY_HEAD.get(c) ?? []));
const HARD_TAILS = new Set([...'るぬづぢぷぺぴぽぞぜぎぐゆよ']); // 人間が、返しにくい終わりの文字

/** 人の言葉を、検査する。OK なら { ok: true, word, head, tail } / ダメなら { ok: false, lose: 負けにするか, why } */
export function checkWord(raw, need, used) {
  const word = toHira(raw);
  if (!word) return { ok: false, lose: false, why: '言葉が、空です。' };
  if (!isKana(word)) return { ok: false, lose: false, why: 'ひらがな・カタカナだけで、書いてください。(漢字・英数字・記号は、使えません)' };
  if ([...word].length < 2) return { ok: false, lose: false, why: '2文字以上の言葉にしてください。' };
  if ([...word].length > 30) return { ok: false, lose: false, why: '長すぎます(30文字まで)。' };
  if (need && headOf(word) !== need) return { ok: false, lose: false, why: `「**${need}**」から、始めてください。` };
  const tail = tailOf(word);
  if (used.includes(word)) return { ok: false, lose: true, why: `「${word}」は、もう使いました!` };
  if (tail === 'ん') return { ok: false, lose: true, why: `「${word}」は、「ん」で終わりました!` };
  return { ok: true, word, head: headOf(word), tail };
}

/**
 * BOTの言葉を選ぶ。level: easy(返しやすい終わりの言葉・辞書の一部だけ) / normal / hard(返しにくい文字で、終わる言葉を、選ぶ)
 * 言葉が見つからなければ null(BOTの負け)
 */
export function botPick(need, used, level = 'normal', rng = Math.random, theme = true) {
  const seen = new Set(used);
  let list = headList(need, theme).filter((w) => !seen.has(w));
  if (!list.length) return null;
  if (level === 'easy') { // 辞書の、半分くらいしか知らない(そのかわり、返しやすい)
    const known = list.filter((w) => !HARD_TAILS.has(tailOf(w)));
    const pool = (known.length ? known : list).filter((w) => w.length % 2 === 0 || rng() < 0.4);
    list = pool.length ? pool : (known.length ? known : list);
  } else if (level === 'hard') {
    // 返しにくい文字で終わる言葉(あれば)。さらに、その文字から始まる言葉が、辞書に残っていて、BOTが次に返せるもの
    const hard = list.filter((w) => HARD_TAILS.has(tailOf(w)));
    const next = (hard.length ? hard : list).filter((w) => headList(tailOf(w), theme).some((x) => !seen.has(x) && x !== w));
    list = next.length ? next : (hard.length ? hard : list);
  } else {
    const ok = list.filter((w) => headList(tailOf(w), theme).some((x) => !seen.has(x) && x !== w)); // 自分が、詰まらない言葉
    list = ok.length ? ok : list;
  }
  return list[Math.floor(rng() * list.length)];
}
