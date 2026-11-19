#!/usr/bin/env node
// 初音ミク(ボカロ)に関する言葉を、VocaDB(無料・登録なし)と、日本語版Wikipediaから、まとめて取る。
//   取るもの: ミクの曲(人気順)・ボカロP・Wikipediaの「初音ミク関連」のカテゴリの項目
//   読み: かな・カタカナの題は、そのまま。漢字まじりの題は、kuromoji で、読みを取る(読めないものは、とばす)
//   使い方: node scripts/fetch-miku.mjs [--songs 1500] [--producers 300]
//   出力:   src/features/shiritori/data/miku-extra.json
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { getJson, sleep, onlyKana, isKanaStr } from './lib/http.mjs';

const require = createRequire(import.meta.url);
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/features/shiritori/data/miku-extra.json');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : def; };
const WIKI_CATEGORIES = ['Category:初音ミクの楽曲', 'Category:VOCALOID楽曲', 'Category:ボーカロイド', 'Category:ボカロP']; // 見つからないカテゴリは、とばします

/** 題の、末尾の「(曲)」などの、注釈を、取る(記事名の、見分け用なので) */
export const cleanTitle = (title) => String(title ?? '').normalize('NFKC').replace(/\s*[\(（][^)）]*[\)）]\s*$/, '').replace(/[「」『』“”"]/g, '').trim();
/** 題から、読み(ひらがな)を作る。作れなければ null */
export async function readingOf(title, tokenizer) {
  const t = String(title ?? '').normalize('NFKC').replace(/\s*[\(（][^)）]*[\)）]\s*$/, '').replace(/[「」『』“”"]/g, '').trim();
  if (!t || /[A-Za-z0-9]/.test(t)) return null; // 英数字まじりは、読めない
  const plain = onlyKana(t.replace(/[!！?？♪☆★~〜…。、，,.]/g, ''));
  if (isKanaStr(plain)) return plain;
  if (!tokenizer) return null;
  let out = '';
  for (const tk of tokenizer.tokenize(t.replace(/[!！?？♪☆★~〜…。、，,.]/g, ''))) {
    const r = tk.reading && tk.reading !== '*' ? tk.reading : (/^[぀-ヿー]+$/.test(tk.surface_form) ? tk.surface_form : null);
    if (!r) return null; out += r;
  }
  const hira = onlyKana(out);
  return isKanaStr(hira) ? hira : null;
}
const loadTokenizer = () => new Promise((res) => { try { const k = require('kuromoji'); k.builder({ dicPath: path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict') }).build((e, tk) => res(e ? null : tk)); } catch { res(null); } });

async function main() {
  const tk = await loadTokenizer(), titles = new Map(); // 表記 → 種類
  const add = (t, kind) => { const c = cleanTitle(t); if (c && !titles.has(c)) titles.set(c, kind); };
  // VocaDB: ミク(アーティストID 1)の曲を、人気順に
  const SONGS = arg('songs', 1500), PAGE = 50;
  for (let start = 0; start < SONGS; start += PAGE) {
    const r = await getJson(`https://vocadb.net/api/songs?artistId[]=1&childVoicebanks=true&sort=RatingScore&maxResults=${PAGE}&start=${start}&lang=Japanese&fields=None`).catch((e) => { console.warn(`VocaDB(曲) ${start}: ${e.message}`); return null; });
    if (!r?.items?.length) break; for (const s of r.items) add(s.name ?? s.defaultName, 'song'); await sleep(300);
  }
  console.log(`曲: ${titles.size}件`);
  // VocaDB: ボカロP(フォロワーの多い順)
  const PRODUCERS = arg('producers', 300);
  for (let start = 0; start < PRODUCERS; start += PAGE) {
    const r = await getJson(`https://vocadb.net/api/artists?artistTypes=Producer&sort=FollowerCount&maxResults=${PAGE}&start=${start}&lang=Japanese&fields=None`).catch((e) => { console.warn(`VocaDB(P) ${start}: ${e.message}`); return null; });
    if (!r?.items?.length) break; for (const a of r.items) add(a.name ?? a.defaultName, 'producer'); await sleep(300);
  }
  // Wikipedia: カテゴリの項目
  for (const cat of WIKI_CATEGORIES) {
    let cont = '', n = 0;
    do {
      const r = await getJson(`https://ja.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=${encodeURIComponent(cat)}&cmlimit=500&cmtype=page&format=json&origin=*${cont ? `&cmcontinue=${encodeURIComponent(cont)}` : ''}`).catch((e) => { console.warn(`Wikipedia ${cat}: ${e.message}`); return null; });
      for (const m of r?.query?.categorymembers ?? []) { add(m.title, 'wiki'); n++; } cont = r?.continue?.cmcontinue ?? ''; await sleep(300);
    } while (cont);
    console.log(`${cat}: ${n}件`);
  }
  const entries = new Map();
  for (const [surface, kind] of titles) { const reading = await readingOf(surface, tk); if (reading && reading.length >= 2 && !entries.has(reading)) entries.set(reading, { surface, reading, kind }); }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ source: 'VocaDB (https://vocadb.net) / ja.wikipedia.org', fetchedAt: new Date().toISOString(), entries: [...entries.values()] }, null, 1));
  console.log(`✅ ${titles.size}件のうち、読みが取れた ${entries.size}語を、${path.relative(process.cwd(), OUT)} に、書きました`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
