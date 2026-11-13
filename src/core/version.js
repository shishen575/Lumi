import { spawnSync } from 'node:child_process';
/** 動いているコードのバージョン(gitの短いID)。取れなければ null */
export const version = (() => { try { const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() || null : null; } catch { return null; } })();
