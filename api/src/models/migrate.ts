/**
 * Minimal migration runner: applies schema.sql to the configured database.
 *
 *   npm run migrate --workspace api
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPool, closePool } from '../config/db.js';

const here = dirname(fileURLToPath(import.meta.url));

async function migrate(): Promise<void> {
  const sql = await readFile(join(here, 'schema.sql'), 'utf8');
  const pool = getPool();
  console.log('[migrate] applying schema.sql…');
  await pool.query(sql);
  console.log('[migrate] done.');
}

migrate()
  .catch((err) => {
    console.error('[migrate] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
