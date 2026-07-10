import { pool } from './db.ts';

/**
 * `page_size` iz podešavanja je podrazumevana veličina strane za sve liste (spec §4.14).
 * Čita se jednom i drži u memoriji; `invalidateSettingsCache()` zove PATCH /settings.
 */
let cachedPageSize: number | null = null;

export async function defaultPageSize(): Promise<number> {
  if (cachedPageSize !== null) return cachedPageSize;
  const { rows } = await pool.query<{ page_size: number }>('SELECT page_size FROM settings WHERE id=1');
  cachedPageSize = rows[0]?.page_size ?? 20;
  return cachedPageSize;
}

export function invalidateSettingsCache(): void {
  cachedPageSize = null;
}
