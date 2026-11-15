import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './db.js';
import { gracefulExit, RESTART_CODE } from './shutdown.js';

/**
 * 別の場所(自宅など)から、データベースを引っ越すための、一度きりの受け口。
 * 環境変数 MIGRATION_TOKEN(16文字以上)を設定したときだけ有効。引っ越しが終わったら、変数を消すこと。
 *   PUT /migrate/import  (Authorization: Bearer <MIGRATION_TOKEN>、本文 = scripts/export-db.mjs で作ったファイル)
 * 受け取ったファイルは、中身を検査してから保存し、BOTを再起動する(起動時に、db.js がデータを入れ替える)。
 * 一度引っ越しをしたあとは、?force=1 を付けない限り、受け付けない
 */
const same = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };

export function mountMigration(app, { onDone = () => gracefulExit(RESTART_CODE, 'データの引っ越し') } = {}) {
  const token = process.env.MIGRATION_TOKEN;
  if (!token || token.length < 16) return false;
  const PENDING = `${DATA_DIR}/bot.db.import`, TMP = `${DATA_DIR}/bot.db.upload`, DONE = `${DATA_DIR}/.migrated`;
  app.put('/migrate/import', express.raw({ type: () => true, limit: '512mb' }), (req, res) => {
    const given = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!same(given, token)) return res.status(401).json({ error: 'トークンが違います' });
    if (fs.existsSync(DONE) && req.query.force !== '1') return res.status(409).json({ error: 'すでに引っ越し済みです。もう一度行うなら、?force=1 を付けてください' });
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length < 1024) return res.status(400).json({ error: 'ファイルが空、または小さすぎます' });
    try {
      fs.writeFileSync(TMP, body);
      const check = new DatabaseSync(TMP, { readOnly: true });
      try {
        const ok = check.prepare('PRAGMA integrity_check').get();
        const tables = check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
        if (Object.values(ok)[0] !== 'ok') throw new Error('データベースが壊れています');
        if (!tables.includes('guild_kv')) throw new Error('Lumiのデータベースではありません(guild_kv がありません)');
        check.close();
        fs.renameSync(TMP, PENDING);
        fs.writeFileSync(DONE, String(Date.now()));
        console.log(`[migrate] データを受け取りました(${body.length} bytes / ${tables.length} テーブル)。再起動して入れ替えます`);
        res.json({ ok: true, bytes: body.length, tables: tables.length });
        onDone();
      } catch (e) { try { check.close(); } catch { /* 閉じ済み */ } throw e; }
    } catch (e) {
      try { fs.rmSync(TMP, { force: true }); } catch { /* なし */ }
      res.status(400).json({ error: String(e.message || e) });
    }
  });
  console.log('[migrate] データの引っ越しの受け口が有効です(終わったら、MIGRATION_TOKEN を消してください)');
  return true;
}
