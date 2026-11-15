import path from 'node:path';
import { DATA_DIR } from './db.js';

/**
 * Railway などで、データの置き場がボリュームの中にあるかを調べる。
 * ボリュームが付いていないと、再デプロイのたびに、データ(SQLite)が消える。問題があれば、警告の文を返す。なければ null
 * (Railway は、ボリュームを付けると、RAILWAY_VOLUME_MOUNT_PATH を環境変数で渡す)
 */
export function storageWarning(env = process.env, dataDir = DATA_DIR) {
  const onRailway = !!(env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_PROJECT_ID);
  if (!onRailway) return null;
  const mount = env.RAILWAY_VOLUME_MOUNT_PATH;
  if (!mount) return 'ボリュームが付いていません。このままだと、再デプロイのたびに、データが消えます。Railway で、Lumi のサービスにボリュームを付けて、マウントのパスを /app/data にしてください';
  const data = path.resolve(dataDir), vol = path.resolve(mount);
  if (data !== vol && !data.startsWith(vol + path.sep)) return `データの置き場(${data})が、ボリュームの場所(${vol})の外にあります。ボリュームの Mount path を ${data} にするか、DATA_DIR を ${vol} にしてください`;
  return null;
}
