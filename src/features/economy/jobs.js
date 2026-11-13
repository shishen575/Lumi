import { pick } from './games.js';
const ri = (rng, [a, b]) => a + Math.floor(rng() * (b - a + 1));
const M = 60_000;

/** 犯罪: 成功率(chance)、成功の報酬(win)、失敗の罰金(fine)、次にできるまでの時間(cd)、留置場にいる時間(jail) */
export const CRIMES = {
  convenience: { name: 'コンビニ強盗', emoji: '🏪', chance: 0.65, win: [200, 600], fine: [150, 400], cd: 5 * M, jail: 3 * M,
    ok: ['レジの現金を、袋に詰めて逃げ切った。', '店員が固まっている隙に、売上金をつかんで走り去った。', '深夜のコンビニで、まんまと現金を奪った。'],
    ng: ['店員に取り押さえられ、警察に通報された。', '逃げる途中で、買い物客につまずいて捕まった。', '防犯カメラにばっちり映っていた。'] },
  atm: { name: 'ATM襲撃', emoji: '🏧', chance: 0.55, win: [400, 1200], fine: [300, 800], cd: 10 * M, jail: 5 * M,
    ok: ['ATMをこじ開けて、現金カセットを抱えて逃げた。', '暗証番号を読み取って、口座から引き出した。', '回収に来たスタッフに紛れて、現金を持ち去った。'],
    ng: ['警報が鳴り響き、駆けつけた警官に囲まれた。', '工具が折れて、もたついている間に通報された。', 'ATMの横の防犯カメラに、顔が映っていた。'] },
  bank: { name: '銀行強盗', emoji: '🏦', chance: 0.35, win: [3000, 9000], fine: [1500, 4000], cd: 30 * M, jail: 15 * M,
    ok: ['金庫室に入り込み、札束を鞄に詰めて、脱出に成功した!', '人質を取らず、スマートに大金を奪って、姿を消した。', '見事な作戦で、警備をすり抜けて大金を手にした。'],
    ng: ['金庫室の前で、警備員に見つかった。', '作戦が漏れていて、銀行の外で警察が待ち構えていた。', '逃走車が、渋滞にはまって、あえなく御用。'] },
  jewel: { name: '宝石強盗', emoji: '💎', chance: 0.45, win: [1500, 4500], fine: [1000, 2500], cd: 20 * M, jail: 10 * M,
    ok: ['ショーケースを破って、ダイヤの首飾りを盗み出した。', '閉店間際に忍び込み、高級な宝石を鞄に入れた。', '偽物とすり替えて、本物の宝石を持ち出した。'],
    ng: ['センサーに触れて、シャッターが降りた。', '盗んだ宝石が、実は鑑定用の追跡タグつきだった。', '店のオーナーが、実は元警官だった。'] },
  pirate: { name: '海賊', emoji: '🏴‍☠️', chance: 0.40, win: [2000, 7000], fine: [1200, 3500], cd: 25 * M, jail: 12 * M,
    ok: ['商船を襲って、積み荷の金貨を奪った!', '嵐に紛れて、財宝を積んだ船に乗り込んだ。', '沈没船の財宝を引き上げて、悠々と帰港した。'],
    ng: ['沿岸警備隊の船に、追いつかれた。', '嵐で船が転覆して、財宝ごと海に沈んだ。', '手下の裏切りで、港で御用になった。'] },
};

/** バイト: 給料(pay)、次にできるまでの時間(cd)、ボーナス(chance の確率で、amount が上乗せ) */
export const JOBS = {
  convenience: { name: 'コンビニ', emoji: '🏪', pay: [150, 350], cd: 10 * M, text: ['レジ打ちと品出しを、きっちりこなした。', '深夜シフトを、眠い目をこすって乗り切った。', '常連さんに、「いつもありがとう」と言われた。'] },
  police: { name: '警察', emoji: '👮', pay: [300, 700], cd: 30 * M, text: ['街をパトロールして、迷子を保護した。', '交通整理をして、市民から感謝された。', '落とし物を届けに来た人に、対応した。'],
    bonus: { chance: 0.2, amount: [300, 800], text: '犯人を逮捕して、特別手当をもらった!' } },
  fastfood: { name: 'ファーストフード', emoji: '🍔', pay: [200, 450], cd: 15 * M, text: ['ハンバーガーを、笑顔で次々と作った。', 'ドライブスルーを、さばき切った。', 'ポテトを揚げ続けて、汗だくになった。'],
    bonus: { chance: 0.25, amount: [100, 300], text: 'ランチタイムが大入りで、チップをもらった!' } },
};

export const BEG = {
  cd: 2 * M,
  ok: ['通りがかりの人が、小銭を恵んでくれた。', '優しいおばあちゃんが、お菓子代をくれた。', '路上ライブの横で、投げ銭が少し分けてもらえた。'],
  none: ['誰も、立ち止まってくれなかった…', '「ごめんね」と、断られてしまった。', '雨が降ってきて、人通りが消えた。'],
  rich: ['お金持ちが現れて、気前よく札を数枚くれた!', '通りすがりの社長が、「頑張れよ」と大金をくれた!'],
};

export function resolveCrime(key, rng = Math.random, chanceDelta = 0) {
  const c = CRIMES[key]; const success = rng() < Math.min(0.95, Math.max(0.05, c.chance + chanceDelta)); // 指名手配の星で、成功率が下がる
  return success ? { success, amount: ri(rng, c.win), text: pick(rng, c.ok) } : { success, amount: ri(rng, c.fine), text: pick(rng, c.ng) };
}
export function resolveWork(key, rng = Math.random, bonusBoost = 0) {
  const j = JOBS[key]; const pay = ri(rng, j.pay);
  const bonus = j.bonus && rng() < Math.min(0.95, j.bonus.chance + bonusBoost) ? { amount: ri(rng, j.bonus.amount), text: j.bonus.text } : null;
  return { pay, bonus, text: pick(rng, j.text) };
}
export function resolveBeg(rng = Math.random) {
  const r = rng();
  if (r < 0.05) return { amount: ri(rng, [200, 500]), text: pick(rng, BEG.rich) };
  if (r < 0.70) return { amount: ri(rng, [10, 80]), text: pick(rng, BEG.ok) };
  return { amount: 0, text: pick(rng, BEG.none) };
}
