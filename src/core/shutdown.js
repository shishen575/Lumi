// 止まる(再起動する)ときの共通の手順。お知らせを出して、少し待ってから終了する。
//   ・停止の合図(パネルの停止・再起動 = SIGINT / SIGTERM)
//   ・GitHub の更新による再起動(終了コード42)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = () => Math.max(0, Number(process.env.SHUTDOWN_WAIT_SECONDS ?? 5)) * 1000;

const hooks = [], cleanups = [];
/** 終了の前に実行する(お知らせの送信など)。失敗しても、終了は止めない */
export const onShutdown = (fn) => hooks.push(fn);
/** お知らせと待ち時間のあとに実行する(接続を閉じるなど) */
export const onShutdownCleanup = (fn) => cleanups.push(fn);

let running = false;
/** 停止の準備に入っているか。入っているあいだは、新しいスラッシュコマンドを受け付けない(途中で終了して、お金だけ動くのを防ぐ) */
export const isShuttingDown = () => running;
/**
 * お知らせを出して、5秒待ってから終了する(待ち時間は SHUTDOWN_WAIT_SECONDS で変えられる)。
 * お知らせの送信は、待ち時間の中で並行して行う(送信が遅くても、待ち時間より長引かせない)
 */
export async function gracefulExit(code = 0, reason = 'stop') {
  if (running) return;
  running = true;
  const ms = wait();
  console.log(`[shutdown] ${Math.round(ms / 1000)}秒待ってから終了します (${reason})`);
  const t0 = Date.now();
  await Promise.all([
    Promise.race([Promise.allSettled(hooks.map((f) => f({ reason, code, waitMs: ms }))), sleep(Math.max(1000, ms - 500))]),
    sleep(ms),
  ]);
  await Promise.race([Promise.allSettled(cleanups.map((f) => f())), sleep(2000)]);
  console.log(`[shutdown] 終了します (${Date.now() - t0}ms)`);
  process.exit(code);
}

/** 停止の合図を受け取る。待っている間に、もう一度合図が来たら、すぐ終了する */
export function installSignalHandlers() {
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      if (running) { console.log(`[shutdown] ${sig} を再度受け取ったので、すぐ終了します`); process.exit(0); }
      gracefulExit(0, sig);
    });
  }
}
