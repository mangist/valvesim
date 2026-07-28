/**
 * PostgreSQL connection & pooling.
 *
 * The pool is created lazily so the API can boot (and serve /health)
 * even when the database isn't reachable yet.
 */
import pg from 'pg';
import 'dotenv/config';

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = process.env.DATABASE_URL
      ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 })
      : new pg.Pool({
          host: process.env.PGHOST ?? 'localhost',
          port: Number(process.env.PGPORT ?? 5432),
          database: process.env.PGDATABASE ?? 'valvesim',
          user: process.env.PGUSER ?? 'valvesim',
          password: process.env.PGPASSWORD,
          max: 10,
        });

    pool.on('error', (err) => {
      console.error('[db] idle client error:', err.message);
    });
  }
  return pool;
}

export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<R>> {
  return getPool().query<R>(text, params as never[]);
}

/** True when the database answers a trivial query. */
export async function isDbUp(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = null;
}
