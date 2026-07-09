import pg from 'pg';
import { config } from './config.ts';

/**
 * Jedinstveni pg pool za celu aplikaciju. Poslovna logika je uvek
 * u transakcijama (spec §3) — vidi helper `tx`.
 */
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

/** Izvrši callback unutar jedne transakcije; rollback na grešku. */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
