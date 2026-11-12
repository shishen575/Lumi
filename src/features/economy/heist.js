import { pick } from './games.js';
const M = 60_000;
const ri = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const shuffle = (rng, arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** 大型銀行強盗: ミニゲーム(全ステップを、制限時間内に終える)で、成功が決まる */
export const HEIST = {
  name: '大型銀行強盗', emoji: '🏦',
  steps: 5,                  // 突破するステップの数
  timeMs: 60_000,            // 制限時間
  maxMistakes: 2,            // 間違えてよい回数(3回目で、警報が鳴って失敗)
  win: [6000, 15000],        // 成功の報酬
  speedBonus: 0.25,          // 早く終えるほど、報酬に最大で +25%
  fine: [3000, 6000],        // 失敗の罰金
  jail: 30 * M,              // 失敗したときの、留置場の時間
  cd: 180 * M,               // 次に挑戦できるまでの時間
};

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
const MAKERS = [arithmetic, sequence, oddOne, wire];

/** ステップを作る。同じ種類が続けて並びすぎないようにする */
export function makeSteps(rng, n = HEIST.steps) {
  const steps = []; let prev = -1;
  for (let i = 0; i < n; i++) {
    let k; do { k = Math.floor(rng() * MAKERS.length); } while (k === prev && MAKERS.length > 1);
    steps.push(MAKERS[k](rng)); prev = k;
  }
  return steps;
}
/** 成功の報酬: 基本の報酬に、残り時間に応じたボーナス */
export const heistReward = (base, remainingMs) => Math.round(base * (1 + HEIST.speedBonus * Math.max(0, Math.min(1, remainingMs / HEIST.timeMs))));
export const heistBase = (rng) => ri(rng, ...HEIST.win);
export const heistFine = (rng) => ri(rng, ...HEIST.fine);
