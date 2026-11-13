import { pick } from './games.js';
const M = 60_000;
const ri = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const shuffle = (rng, arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/**
 * 大型犯罪(ミニゲーム)。全ステップを、制限時間内に終えれば成功。
 * 難しいほど(ステップが多い・間違えられない)、報酬も罰金も、留置場も、待ち時間も、大きくなる。
 * makers: 出題する問題の種類(下の MAKERS の名前)
 */
const ALL = ['arithmetic', 'sequence', 'oddOne', 'wire', 'largest', 'countIcons'];
export const HEISTS = {
  bank: {
    id: 'bank', name: '大型銀行強盗', short: '大型銀行', emoji: '🏦', blurb: '標準',
    steps: 5, timeMs: 60_000, maxMistakes: 2, win: [6000, 15000], speedBonus: 0.25, fine: [3000, 6000], jail: 30 * M, cd: 180 * M,
    makers: ['arithmetic', 'sequence', 'oddOne', 'wire'], success: '金庫を開けて、大金を持ち出した!', caught: '警備員に見つかった。',
  },
  armored: {
    id: 'armored', name: '現金輸送車の襲撃', short: '現金輸送車', emoji: '🚚', blurb: '易しい',
    steps: 4, timeMs: 45_000, maxMistakes: 2, win: [3500, 8000], speedBonus: 0.25, fine: [1800, 3500], jail: 20 * M, cd: 120 * M,
    makers: ['arithmetic', 'wire', 'largest', 'countIcons'], success: '輸送車の荷台から、現金のケースを奪って逃げた!', caught: '護衛に取り押さえられた。',
  },
  museum: {
    id: 'museum', name: '美術館の名画', short: '美術館', emoji: '🖼️', blurb: '慎重に',
    steps: 5, timeMs: 60_000, maxMistakes: 1, win: [8000, 18000], speedBonus: 0.25, fine: [4500, 8500], jail: 40 * M, cd: 240 * M,
    makers: ['oddOne', 'wire', 'countIcons', 'sequence'], success: '名画を額縁ごと盗み出し、闇市場に売りさばいた!', caught: 'センサーが反応して、警備隊に囲まれた。',
  },
  casino: {
    id: 'casino', name: 'カジノの金庫', short: 'カジノ', emoji: '🎰', blurb: '長丁場',
    steps: 6, timeMs: 60_000, maxMistakes: 2, win: [10000, 24000], speedBonus: 0.25, fine: [6000, 11000], jail: 50 * M, cd: 300 * M,
    makers: ALL, success: '一晩の売り上げを、まるごと持ち出した!', caught: '監視室に気づかれた。',
  },
  vault: {
    id: 'vault', name: '国立宝物庫', short: '宝物庫', emoji: '💎', blurb: '最難関',
    steps: 8, timeMs: 75_000, maxMistakes: 2, win: [26000, 60000], speedBonus: 0.25, fine: [14000, 24000], jail: 90 * M, cd: 600 * M,
    makers: ALL, success: '国の宝を、ごっそり持ち出した!', caught: '特殊部隊に包囲された。',
  },
};
export const HEIST = HEISTS.bank; // 以前の呼び名(大型銀行)
export const heistTarget = (id) => HEISTS[id] ?? HEISTS.bank;
export const heistKey = (id) => (!id || id === 'bank' ? 'heist' : `heist:${id}`); // 待ち時間のキー(銀行は、以前のまま)

// --- 問題(ステップ)の作り方。答えは、サーバー側にだけ持つ ---
const uniqueOptions = (rng, answer, near) => {
  const set = new Set([answer]);
  for (let guard = 0; set.size < 4 && guard < 100; guard++) { const v = near(); if (v !== answer && v > 0) set.add(v); }
  for (let v = answer + 1; set.size < 4; v++) set.add(v); // 念のため
  return shuffle(rng, [...set]);
};
const withAnswer = (prompt, options, answer) => ({ prompt, options: options.map(String), answer: options.indexOf(answer) });

function arithmetic(rng) {
  const op = pick(rng, ['+', '-', '×']);
  let a, b, ans;
  if (op === '+') { a = ri(rng, 12, 89); b = ri(rng, 12, 89); ans = a + b; }
  else if (op === '-') { a = ri(rng, 40, 99); b = ri(rng, 11, a - 10); ans = a - b; }
  else { a = ri(rng, 3, 12); b = ri(rng, 3, 12); ans = a * b; }
  return withAnswer(`🔢 金庫の暗号錠: **${a} ${op} ${b}** = ?`, uniqueOptions(rng, ans, () => ans + pick(rng, [-10, -3, -2, -1, 1, 2, 3, 10])), ans);
}
function sequence(rng) {
  const kind = pick(rng, ['add', 'mul', 'alt']);
  let seq, ans;
  if (kind === 'add') { const s = ri(rng, 2, 20), d = ri(rng, 2, 9); seq = [0, 1, 2, 3].map((n) => s + d * n); ans = s + d * 4; }
  else if (kind === 'mul') { const s = ri(rng, 1, 4), f = pick(rng, [2, 3]); seq = [0, 1, 2, 3].map((n) => s * f ** n); ans = s * f ** 4; }
  else { const s = ri(rng, 5, 20), d1 = ri(rng, 2, 6), d2 = ri(rng, 7, 12); seq = [s, s + d1, s + d1 + d2, s + 2 * d1 + d2]; ans = s + 2 * d1 + 2 * d2; } // +a, +b を交互に
  return withAnswer(`📡 センサーの周期: **${seq.join(', ')}, ?**`, uniqueOptions(rng, ans, () => ans + pick(rng, [-6, -4, -2, -1, 1, 2, 4, 6])), ans);
}
const CATEGORIES = [['🍎', '🍌', '🍇', '🍓', '🍊'], ['🐶', '🐱', '🐭', '🐹', '🐰'], ['🚗', '🚕', '🚌', '🚓', '🚑'], ['⚽', '🏀', '🏈', '⚾', '🎾'], ['🌸', '🌻', '🌹', '🌷', '🌼']];
function oddOne(rng) {
  const [c1, c2] = shuffle(rng, CATEGORIES).slice(0, 2);
  const three = shuffle(rng, c1).slice(0, 3), odd = pick(rng, c2);
  const opts = shuffle(rng, [...three, odd]);
  return { prompt: '🕵️ 警備員の目をごまかせ: **仲間はずれ**を押せ', options: opts, answer: opts.indexOf(odd) };
}
const WIRES = [['🔴', '赤'], ['🔵', '青'], ['🟢', '緑'], ['🟡', '黄']];
function wire(rng) {
  const [target, name] = pick(rng, WIRES);
  const opts = shuffle(rng, WIRES.map((w) => w[0]));
  return { prompt: `✂️ 配線を切れ: **${name}色** の線はどれ?`, options: opts, answer: opts.indexOf(target) };
}
function largest(rng) {
  const nums = new Set(); while (nums.size < 4) nums.add(ri(rng, 10, 99));
  const opts = [...nums], big = pick(rng, [true, false]);
  const ans = big ? Math.max(...opts) : Math.min(...opts);
  return withAnswer(`🔐 暗証番号の照合: **一番${big ? '大きい' : '小さい'}数** を押せ`, shuffle(rng, opts), ans);
}
function countIcons(rng) {
  const [target, other] = shuffle(rng, ['🎥', '🔦', '🔔', '💡', '🔒']).slice(0, 2);
  const n = ri(rng, 3, 8), m = ri(rng, 3, 7);
  const row = shuffle(rng, [...Array(n).fill(target), ...Array(m).fill(other)]).join(' ');
  return withAnswer(`${target} 監視網のチェック: ${target} は **何個** ある?\n${row}`, uniqueOptions(rng, n, () => n + pick(rng, [-2, -1, 1, 2, 3])), n);
}
const MAKERS = { arithmetic, sequence, oddOne, wire, largest, countIcons };

/** ステップを作る。同じ種類が続けて並びすぎないようにする */
export function makeSteps(rng, n = HEIST.steps, makers = HEIST.makers) {
  const pool = makers.map((k) => MAKERS[k]).filter(Boolean);
  const steps = []; let prev = -1;
  for (let i = 0; i < n; i++) {
    let k; do { k = Math.floor(rng() * pool.length); } while (k === prev && pool.length > 1);
    steps.push(pool[k](rng)); prev = k;
  }
  return steps;
}
/** 成功の報酬: 基本の報酬に、残り時間に応じたボーナス */
export const heistReward = (base, remainingMs, T = HEIST) => Math.round(base * (1 + T.speedBonus * Math.max(0, Math.min(1, remainingMs / T.timeMs))));
export const heistBase = (rng, T = HEIST) => ri(rng, ...T.win);
export const heistFine = (rng, T = HEIST) => ri(rng, ...T.fine);
