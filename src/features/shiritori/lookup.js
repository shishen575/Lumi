import { db, migrate } from '../../core/db.js';

/**
 * 辞書にない言葉を、外の無料の辞書(Jisho.org・日本語版Wiktionary)に、問い合わせる。結果は、保存して、同じ言葉は、二度と、聞かない。
 *  ・Jisho.org の非公式API: 言葉と読みが、載っているか(名詞か)。漢字の読みも、ここから、取れる
 *  ・Wiktionary(MediaWiki API): そのページが、あるか(読みは、取れない。かなの言葉の、存在の確認だけ)
 * 外部のサービスには、言葉(1語)だけを、送る。人や、サーバーの情報は、送らない。
 * 時間がかかったり、止まっていたりしたら、「分からない」として、扱う(遊びは、止めない)
 */
migrate(`CREATE TABLE IF NOT EXISTS shiritori_lookup (word TEXT PRIMARY KEY, ok INTEGER NOT NULL, reading TEXT, src TEXT, at INTEGER NOT NULL)`);
const NEG_TTL = 24 * 3600_000, TIMEOUT = 3500;
/** 連絡先として、BOTの公開サイトのアドレスを入れる(Wikimedia は、連絡先つきの User-Agent を、求めている)。個人の情報は、入れない */
const userAgent = () => `lumi-bot-shiritori/1.0${process.env.BASE_URL ? ` (${process.env.BASE_URL})` : ''}`;
let fetchImpl = (...a) => fetch(...a);
export const setFetch = (f) => { fetchImpl = f; }; // テスト用

const toKata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const toHira = (s) => String(s ?? '').normalize('NFKC').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s・]/g, '');
const isKana = (s) => /^[ぁ-ゖー]+$/.test(s);

// 同じサービスに、続けて聞かない(1秒に1回まで)
const nextAt = new Map();
async function polite(host) { const now = Date.now(), at = Math.max(now, nextAt.get(host) ?? 0); nextAt.set(host, at + 1000); if (at > now) await new Promise((r) => setTimeout(r, at - now)); }
async function getJson(host, url) {
  await polite(host);
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try { const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent(), Accept: 'application/json' }, signal: ctl.signal }); return res.ok ? await res.json() : null; }
  catch { return null; } finally { clearTimeout(t); }
}

/** Jisho: text(書いたまま)と hira(ひらがな)に合う、名詞の項目を探す。{ reading, surface } か null */
export function matchJisho(json, text, hira) {
  for (const e of json?.data ?? []) {
    // 名詞の項目か: 名詞の意味が1つでもある(「勉強」: Noun + Suru verb)/ 「Wikipedia」の項目だけ。動詞・形容詞の項目に、Wikipedia の意味が、1つ混じっているだけのもの(走る)は、除く
    const senses = (e.senses ?? []).map((s) => s.parts_of_speech ?? []);
    const nounish = senses.some((p) => p.some((x) => /^(noun|proper noun|place|pronoun)\b/i.test(x)));
    const wikiOnly = senses.length > 0 && senses.every((p) => p.length > 0 && p.every((x) => /^wikipedia definition$/i.test(x)));
    if (!nounish && !wikiOnly) continue;
    for (const j of e.japanese ?? []) {
      const reading = toHira(j.reading ?? (isKana(toHira(j.word ?? '')) ? j.word : '')), word = j.word ?? j.reading;
      if (!reading || !isKana(reading)) continue;
      if (word === text || reading === hira || toHira(word ?? '') === hira) return { reading, surface: word };
    }
  }
  return null;
}
/** Wiktionary: titles=A|B で、ページがあるか。あれば、true */
export function wiktionaryHas(json) {
  const pages = json?.query?.pages; if (!pages) return false;
  return Object.values(pages).some((p) => p && !('missing' in p) && !('invalid' in p) && p.pageid);
}

const cacheGet = (word) => { const r = db.prepare('SELECT * FROM shiritori_lookup WHERE word=?').get(word); return !r ? null : (r.ok || Date.now() - r.at < NEG_TTL ? r : null); };
const cachePut = (word, ok, reading, src) => db.prepare(`INSERT INTO shiritori_lookup (word, ok, reading, src, at) VALUES (?,?,?,?,?)
  ON CONFLICT(word) DO UPDATE SET ok=excluded.ok, reading=excluded.reading, src=excluded.src, at=excluded.at`).run(word, ok ? 1 : 0, reading ?? null, src ?? null, Date.now());

/**
 * 外の辞書に、聞く。text: 書いたまま / hira: ひらがな(かなの言葉のとき)/ kana: かなの言葉か
 * 戻り値: { ok: true, reading, src } / { ok: false }
 */
export async function remoteCheck(text, { kana }) {
  const key = String(text).normalize('NFKC'), hira = toHira(key);
  const hit = cacheGet(key); if (hit) return hit.ok ? { ok: true, reading: hit.reading, src: hit.src, cached: true } : { ok: false, cached: true };
  const jishoP = getJson('jisho.org', `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(key)}`).then((j) => matchJisho(j, key, hira));
  const wiktP = kana ? getJson('ja.wiktionary.org', `https://ja.wiktionary.org/w/api.php?action=query&format=json&redirects=1&titles=${encodeURIComponent(`${hira}|${toKata(hira)}`)}`).then(wiktionaryHas) : Promise.resolve(false);
  const [jisho, wikt] = await Promise.all([jishoP, wiktP]);
  if (jisho) { cachePut(key, true, jisho.reading, 'jisho'); return { ok: true, reading: jisho.reading, src: 'jisho' }; }
  if (wikt && kana) { cachePut(key, true, hira, 'wiktionary'); return { ok: true, reading: hira, src: 'wiktionary' }; }
  cachePut(key, false, null, null); return { ok: false };
}
