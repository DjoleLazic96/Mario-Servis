import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './db.ts';

/**
 * Jednostavan migration runner (pravilo 4, teh. preporuka §10):
 * baza se pravi isključivo migracijama — nikad ručno.
 * Svaki .sql fajl iz ./migrations izvršava se jednom, u transakciji,
 * i beleži u schema_migrations. Redosled = abecedni po imenu (001_, 002_, ...).
 */
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

async function run(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✓ ${file}`);
      ran++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`✗ ${file} — migracija nije uspela, rollback.`);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(ran === 0 ? 'Baza je već ažurna (nema novih migracija).' : `Primenjeno migracija: ${ran}.`);
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
