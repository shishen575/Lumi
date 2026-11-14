import { spawnSync } from 'node:child_process';
/** 動いているコードのバージョン(gitの短いID)。gitが無い環境(Railwayなど)では、環境変数のコミット番号を使う。取れなければ null */
export const version = (() => {
  const env = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || process.env.SOURCE_VERSION;
  if (env) return String(env).slice(0, 7);
  try { const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() || null : null; } catch { return null; }
})();
