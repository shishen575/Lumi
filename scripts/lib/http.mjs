/** やさしく、取りにいく(はじめだけ、まとめて取る用): 同時 N 件・間隔・やり直し。外部のAPIに、迷惑をかけない */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function getJson(url, { retries = 3, timeoutMs = 20000, fetchImpl = fetch } = {}) {
  for (let n = 0; ; n++) {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
      const res = await fetchImpl(url, { headers: { 'User-Agent': 'lumi-bot-dictionary-builder', Accept: 'application/json' }, signal: ctl.signal }).finally(() => clearTimeout(t));
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (n >= retries) throw new Error(`${url}: ${e.message}`);
      await sleep(1000 * 2 ** n); // 1秒・2秒・4秒と、待ってから、やり直す
    }
  }
}
/** items を、同時に concurrency 件ずつ、gapMs 空けて、処理する(結果は、順番どおり) */
export async function mapPolite(items, fn, { concurrency = 4, gapMs = 120, onProgress } = {}) {
  const out = new Array(items.length); let next = 0, done = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) { const i = next++; try { out[i] = await fn(items[i], i); } catch (e) { out[i] = null; console.warn(`  ! ${e.message}`); } done++; onProgress?.(done, items.length); await sleep(gapMs); }
  }));
  return out;
}
export const kataToHira = (s) => String(s ?? '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
export const onlyKana = (s) => kataToHira(String(s ?? '').normalize('NFKC').replace(/[\s・\-:!?♪]/g, ''));
export const isKanaStr = (s) => /^[ぁ-ゖー]+$/.test(s);
