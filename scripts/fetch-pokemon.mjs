#!/usr/bin/env node
// ポケモンの、技・特性・道具・地名などの、日本語名を、PokeAPI(無料・登録なし)から、まとめて取る。
//   使い方: node scripts/fetch-pokemon.mjs [--limit 30]   ← まず、--limit で、少しだけ試す
//   出力:   src/features/shiritori/data/pokemon-extra.json(しりとりの辞書が、自動で、読み込みます)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJson, mapPolite, onlyKana, isKanaStr } from './lib/http.mjs';

const BASE = 'https://pokeapi.co/api/v2', OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/features/shiritori/data/pokemon-extra.json');
const KINDS = ['move', 'ability', 'item', 'location', 'region', 'type', 'nature', 'egg-group', 'pokemon-habitat', 'berry-flavor'];
const limitArg = process.argv.indexOf('--limit'), LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;

/** names: [{ name, language: { name } }] から、{ surface, reading } を作る。ja-Hrkt = かな表記、ja = 漢字まじりの表記 */
export function jaName(names) {
  const by = Object.fromEntries((names ?? []).map((n) => [n.language?.name, n.name]));
  const kana = by['ja-Hrkt'] ?? (isKanaStr(onlyKana(by.ja)) ? by.ja : null), surface = by.ja ?? by['ja-Hrkt'];
  const reading = kana ? onlyKana(kana) : null;
  return reading && isKanaStr(reading) && reading.length >= 2 && !/[0-9０-９]/.test(surface ?? '') ? { surface, reading } : null;
}

async function main() {
  const all = new Map();
  for (const kind of KINDS) {
    const list = await getJson(`${BASE}/${kind}?limit=3000`).catch((e) => { console.warn(`${kind}: 一覧を取れませんでした: ${e.message}`); return null; });
    const urls = (list?.results ?? []).slice(0, LIMIT).map((r) => r.url);
    console.log(`${kind}: ${urls.length}件を、取ります…`);
    const rows = await mapPolite(urls, (u) => getJson(u), { onProgress: (d, n) => d % 100 === 0 && console.log(`  ${d}/${n}`) });
    for (const row of rows) { const n = row && jaName(row.names); if (n && !all.has(n.reading)) all.set(n.reading, { ...n, kind }); }
  }
  const entries = [...all.values()].sort((a, b) => a.reading.localeCompare(b.reading, 'ja'));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ source: 'PokeAPI (https://pokeapi.co)', fetchedAt: new Date().toISOString(), entries }, null, 1));
  console.log(`✅ ${entries.length}語を、${path.relative(process.cwd(), OUT)} に、書きました`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
