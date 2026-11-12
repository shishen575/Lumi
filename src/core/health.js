// 止まった記録(/ping で表示する)。直近1時間ぶん
const stalls = [];
export function healthSnapshot(now = Date.now()) {
  while (stalls.length && now - stalls[0].at > 3600_000) stalls.shift();
  return { count: stalls.length, maxMs: stalls.reduce((a, s) => Math.max(a, s.ms), 0), lastMs: stalls.at(-1)?.ms ?? 0, lastAt: stalls.at(-1)?.at ?? 0 };
}
/** 通常の通信(REST)の速さを測る。失敗したら null */
export async function measureRest(client) {
  try { const t0 = performance.now(); await client.rest.get('/gateway'); return Math.round(performance.now() - t0); } catch { return null; }
}

/**
 * BOTの動きが止まったことを検知して、そのときの状況をログに出す(原因調べ用)。
 * 1秒ごとに時刻を確認して、予定より遅れていたら、その間、BOTの処理が止まっていたことになる。
 *   CPU が高い  → 重い計算をしている(または、メモリ不足でガベージコレクションが長引いている)
 *   CPU が低い  → ディスクや外部の待ち、または、サーバーのCPU制限で、処理が進められていない
 */
export function startHealthMonitor(client) {
  // ゲートウェイの切断・再接続を記録する。遅れの前後で切れているなら、通信の取りこぼし(回線・機器・MTUなど)の証拠になる
  if (client?.on) {
    client.on('shardDisconnect', (ev, id) => console.warn(`[health] ゲートウェイが切断されました (シャード${id} / コード ${ev?.code ?? '?'})`));
    client.on('shardReconnecting', (id) => console.warn(`[health] ゲートウェイに再接続しています (シャード${id})`));
    client.on('shardResume', (id, replayed) => console.warn(`[health] ゲートウェイを再開しました (シャード${id} / 取り戻したイベント ${replayed ?? '?'}件)`));
    client.on('shardError', (err, id) => console.warn(`[health] ゲートウェイのエラー (シャード${id}): ${err?.message ?? err}`));
  }
  // Discordとの通信の遅さ(ゲートウェイのハートビートの往復時間)。処理が止まっていないのに遅いときは、通信が原因
  const ping = () => { const p = client?.ws?.ping; return typeof p === 'number' && p >= 0 ? `${Math.round(p)}ms` : '不明'; };
  let last = performance.now(), cpu = process.cpuUsage();
  const t = setInterval(() => {
    const now = performance.now(), drift = now - last - 1000; last = now;
    const used = process.cpuUsage(cpu); cpu = process.cpuUsage();
    if (drift < 1000) return;
    stalls.push({ at: Date.now(), ms: Math.round(drift) });
    const cpuPct = ((used.user + used.system) / 1000) / (drift + 1000) * 100;
    const m = process.memoryUsage();
    console.warn(`[health] 処理が ${Math.round(drift)}ms 止まりました (CPU ${cpuPct.toFixed(0)}% / メモリ ${Math.round(m.rss / 1048576)}MB / ヒープ ${Math.round(m.heapUsed / 1048576)}MB / Discordとの通信 ${ping()} / REST ${restMs === null ? '不明' : `${restMs}ms`})`);
  }, 1000);
  t.unref?.();
  // 1分ごとに、通常の通信(REST)の速さを測る。ゲートウェイだけが遅いのか、通信全体が遅いのかを見分けるため
  let restMs = null;
  const probe = async () => {
    try {
      const t0 = performance.now(); await client.rest.get('/gateway'); restMs = Math.round(performance.now() - t0);
      if (restMs > 1500) console.warn(`[health] Discordの通常の通信(REST)が遅いです (${restMs}ms)`);
    } catch { restMs = null; }
  };
  if (client?.rest) { const r = setInterval(probe, 60_000); r.unref?.(); probe(); }
  // 30秒ごとに、Discordとの通信が遅くないか確認する(処理が止まっていないのに遅いなら、サーバーのネットワークが原因)
  const n = setInterval(() => { const p = client?.ws?.ping; if (typeof p === 'number' && p > 1500) console.warn(`[health] Discordとの通信が遅いです (往復 ${Math.round(p)}ms)`); }, 30_000);
  n.unref?.();
  // 5分ごとに、状況を1行(メモリの増え方を見るため)
  const s = setInterval(() => {
    const m = process.memoryUsage();
    console.log(`[health] メモリ ${Math.round(m.rss / 1048576)}MB / ヒープ ${Math.round(m.heapUsed / 1048576)}MB / 通信 ${ping()} / REST ${restMs === null ? '不明' : `${restMs}ms`} / 稼働 ${Math.round(process.uptime() / 60)}分`);
  }, 5 * 60_000);
  s.unref?.();
}
