import { hash } from '@node-rs/argon2';
import { pool } from './db.ts';

/**
 * Seed za lokalni razvoj: prvi admin korisnik i jedan red podešavanja (singleton).
 * Nema samoregistracije (spec §6) — admin se pravi ovde, kasnije preko Podešavanja.
 * Idempotentno: ponovni seed ne pravi duplikate.
 */
const ADMIN_EMAIL = 'admin@karton.local';
const ADMIN_PASSWORD = 'admin123';

async function seed(): Promise<void> {
  const exists = await pool.query('SELECT 1 FROM app_user WHERE email = $1', [ADMIN_EMAIL]);
  if (exists.rowCount === 0) {
    const passwordHash = await hash(ADMIN_PASSWORD); // @node-rs/argon2: default je argon2id
    await pool.query(
      `INSERT INTO app_user (name, email, password_hash, role, status)
       VALUES ($1, $2, $3, 'admin', 'active')`,
      ['Administrator', ADMIN_EMAIL, passwordHash],
    );
    console.log(`✓ Admin kreiran: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  } else {
    console.log(`• Admin već postoji: ${ADMIN_EMAIL}`);
  }

  const settings = await pool.query('SELECT 1 FROM settings WHERE id = 1');
  if (settings.rowCount === 0) {
    await pool.query(
      `INSERT INTO settings (id, shop_name, work_hours_from, work_hours_to, default_validity_days, reminder_send_time, page_size)
       VALUES (1, $1, '08:00', '18:00', 15, '09:00', 20)`,
      ['Autoservis (demo)'],
    );
    console.log('✓ Podešavanja (singleton) kreirana.');
  } else {
    console.log('• Podešavanja već postoje.');
  }

  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
