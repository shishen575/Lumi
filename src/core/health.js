/**
 * BOTの動きが止まったことを検知して、そのときの状況をログに出す(原因調べ用)。
 * 1秒ごとに時刻を確認して、予定より遅れていたら、その間、BOTの処理が止まっていたことになる。
 *   CPU が高い  → 重い計算をしている(または、メモリ不足でガベージコレクションが長引いている)
 *   CPU が低い  → ディスクや外部の待ち、または、サーバーのCPU制限で、処理が進められていない
 */
export function startHealthMonitor(client) {
  // Discordとの通信の遅さ(ゲートウェイのハートビートの往復時間)。処理が止まっていないのに遅いときは、通信が原因
  const ping = () => { const p = client?.ws?.ping; return typeof p === 'number' && p >= 0 ? `${Math.round(p)}ms` : '不明'; };
  let last = performance.now(), cpu = process.cpuUsage();
  const t = setInterval(() => {
    const now = performance.now(), drift = now - last - 1000; last = now;
    const used = process.cpuUsage(cpu); cpu = process.cpuUsage();
    if (drift < 1000) return;
    const cpuPct = ((used.user + used.system) / 1000) / (drift + 1000) * 100;
    const m = process.memoryUsage();
    console.warn(`[health] 処理が ${Math.round(drift)}ms 止まりました (CPU ${cpuPct.toFixed(0)}% / メモリ ${Math.round(m.rss / 1048576)}MB / ヒープ ${Math.round(m.heapUsed / 1048576)}MB / Discordとの通信 ${ping()})`);
  }, 1000);
  t.unref?.();
  // 30秒ごとに、Discordとの通信が遅くないか確認する(処理が止まっていないのに遅いなら、サーバーのネットワークが原因)
  const n = setInterval(() => { const p = client?.ws?.ping; if (typeof p === 'number' && p > 1500) console.warn(`[health] Discordとの通信が遅いです (往復 ${Math.round(p)}ms)`); }, 30_000);
  n.unref?.();
  // 5分ごとに、状況を1行(メモリの増え方を見るため)
  const s = setInterval(() => {
    const m = process.memoryUsage();
    console.log(`[health] メモリ ${Math.round(m.rss / 1048576)}MB / ヒープ ${Math.round(m.heapUsed / 1048576)}MB / 通信 ${ping()} / 稼働 ${Math.round(process.uptime() / 60)}分`);
  }, 5 * 60_000);
  s.unref?.();
}
