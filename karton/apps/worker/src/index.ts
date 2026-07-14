process.env.TZ = 'UTC';
import pg from 'pg';
import nodemailer from 'nodemailer';
import { resolve } from 'node:path';
import { runBackupWithEvidence } from '@karton/shared/backup';

/**
 * Worker (odvojen proces, teh. preporuka §5): zakazani poslovi.
 * Deli bazu sa API-jem. Poslovi rade u petlji sa fiksnim intervalima.
 */
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// PAŽNJA: SMTP se čita iz .env, a NE iz Podešavanja u aplikaciji — što god Mario tamo
// ukuca, ovde se ne koristi. Nema ni autentikacije (`auth`) ni TLS-a (`secure: false`),
// pa ovo radi samo sa lokalnim Mailpit-om. Pre produkcije: čitati smtp_* iz tabele
// settings, dodati auth i secure prema portu (465 = odmah TLS, 587 = STARTTLS).
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? 'localhost',
  port: Number(process.env.SMTP_PORT ?? 1025),
  secure: false,
});
const SENDER = process.env.SENDER_EMAIL ?? 'servis@localhost';

const RETRY_BACKOFF_MIN = [5, 15, 60, 180, 360]; // rastući razmak, max 5 pokušaja (BR-30)

function log(msg: string): void {
  console.log(`[worker ${new Date().toISOString()}] ${msg}`);
}

/** Automatski istek ponuda i predračuna kojima je prošao rok (spec §10). */
async function expireDocuments(): Promise<void> {
  const today = belgradeToday();
  const q = await pool.query(`UPDATE document SET status='expired', version=version+1 WHERE type='quote' AND status='pending' AND valid_until < $1`, [today]);
  const p = await pool.query(`UPDATE document SET status='expired', version=version+1 WHERE type='proforma' AND status='valid' AND valid_until < $1`, [today]);
  if ((q.rowCount ?? 0) + (p.rowCount ?? 0) > 0) log(`isteklo: ponuda ${q.rowCount}, predračuna ${p.rowCount}`);
}

/** Slanje dospelih podsetnika sa retry (SKIP LOCKED da dva radnika ne uzmu isti). */
async function sendReminders(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const due = await client.query<{ id: number; appointment_id: number; attempt_count: number }>(
      `SELECT ar.id, ar.appointment_id, ar.attempt_count FROM appointment_reminder ar
       WHERE ar.send_status='scheduled' AND ar.scheduled_send_at <= now()
       FOR UPDATE SKIP LOCKED LIMIT 20`);
    for (const r of due.rows) {
      await client.query(`UPDATE appointment_reminder SET send_status='processing' WHERE id=$1`, [r.id]);
    }
    await client.query('COMMIT');

    for (const r of due.rows) {
      // uslovi se proveravaju u trenutku slanja (BR-30)
      const info = await pool.query<{ status: string; enabled: boolean; email: string | null; cname: string; sdate: string; stime: string; make: string; model: string; plate: string | null; shop: string; phone: string | null }>(
        `SELECT a.status, a.reminders_enabled enabled,
           (SELECT value FROM customer_contact WHERE customer_id=a.customer_id AND kind='email' AND is_primary ORDER BY id LIMIT 1) email,
           c.name cname, to_char(a.date,'DD.MM.YYYY') sdate, to_char(a.time,'HH24:MI') stime,
           v.make, v.model, (SELECT plate FROM registration_history WHERE vehicle_id=v.id AND valid_to IS NULL LIMIT 1) plate,
           s.shop_name shop, s.phone
         FROM appointment a JOIN customer c ON c.id=a.customer_id JOIN vehicle v ON v.id=a.vehicle_id CROSS JOIN settings s WHERE a.id=$1`,
        [r.appointment_id]);
      const d = info.rows[0];
      // Uslovi se proveravaju u trenutku slanja (pravila 4–6). Ako u ovom trenutku
      // ne važe (termin otkazan/realizovan, podsetnik isključen, ili klijent nema email),
      // podsetnik se TERMINALNO preskače — ne vraća se u 'scheduled'. Time se sprečava
      // zakašnjelo slanje ako se email doda posle vremena (pravilo 6) i vrtenje u krug.
      if (!d || d.status !== 'scheduled' || !d.enabled || !d.email) {
        const razlog = !d ? 'termin ne postoji'
          : d.status !== 'scheduled' ? `termin nije zakazan (${d.status})`
          : !d.enabled ? 'podsetnik isključen'
          : 'klijent nema email u trenutku slanja';
        await pool.query(`UPDATE appointment_reminder SET send_status='skipped', last_attempt_at=now(), last_error=$2 WHERE id=$1`, [r.id, razlog]);
        log(`podsetnik preskočen: termin ${r.appointment_id} — ${razlog}`);
        continue;
      }
      try {
        await transporter.sendMail({
          from: `${d.shop} <${SENDER}>`,
          to: d.email,
          subject: `Podsetnik za zakazani termin — ${d.shop}`,
          text: `Poštovani/a ${d.cname},\n\nPodsećamo Vas na zakazani termin u servisu ${d.shop}.\n\n`
            + `Datum: ${d.sdate}\nVreme: ${d.stime}\nVozilo: ${d.make} ${d.model}${d.plate ? ` (${d.plate})` : ''}\n`
            + `Telefon servisa: ${d.phone ?? ''}\n\nOvo je automatski podsetnik.`,
        });
        await pool.query(`UPDATE appointment_reminder SET send_status='sent', sent_at=now(), attempt_count=attempt_count+1, last_attempt_at=now() WHERE id=$1`, [r.id]);
        log(`podsetnik poslat: termin ${r.appointment_id} → ${d.email}`);
      } catch (err) {
        const attempts = r.attempt_count + 1;
        const msg = err instanceof Error ? err.message : String(err);
        if (attempts >= RETRY_BACKOFF_MIN.length + 1) {
          await pool.query(`UPDATE appointment_reminder SET send_status='failed', attempt_count=$2, last_attempt_at=now(), last_error=$3 WHERE id=$1`, [r.id, attempts, msg]);
          log(`podsetnik ODUSTAO nakon ${attempts} pokušaja: termin ${r.appointment_id}`);
        } else {
          const backoff = RETRY_BACKOFF_MIN[attempts - 1] ?? 360;
          await pool.query(`UPDATE appointment_reminder SET send_status='scheduled', scheduled_send_at=now() + ($2||' minutes')::interval, attempt_count=$3, last_attempt_at=now(), last_error=$4 WHERE id=$1`,
            [r.id, backoff, attempts, msg]);
          log(`podsetnik greška (pokušaj ${attempts}), retry za ${backoff}min: termin ${r.appointment_id}`);
        }
      }
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    log(`greška u sendReminders: ${err instanceof Error ? err.message : err}`);
  } finally {
    client.release();
  }
}

function belgradeToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Belgrade' });
}

/**
 * Dnevni backup (spec §4.14): pokreće se jednom dnevno u BACKUP_HOUR po beogradskom vremenu.
 * Ishod — i uspeh i neuspeh — upisuje se u `backup_run`, pa je vidljiv u Podešavanjima.
 */
const BACKUP_HOUR = Number(process.env.BACKUP_HOUR ?? 2);
const backupOpts = {
  databaseUrl: process.env.DATABASE_URL!,
  // isti direktorijum kao API (oba se sidre na koren monorepoa, ne na svoj cwd)
  backupDir: resolve(import.meta.dirname, '../../..', process.env.BACKUP_DIR ?? './backups'),
  dockerContainer: process.env.DB_CONTAINER ?? 'karton-db',
};

async function dailyBackup(): Promise<void> {
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Belgrade' });
  const [today, clock] = now.split(' ') as [string, string];
  if (Number(clock.slice(0, 2)) !== BACKUP_HOUR) return;

  // idempotentno: ako danas već postoji uspešan backup, preskoči
  const done = await pool.query(
    `SELECT 1 FROM backup_run WHERE status='success'
       AND (started_at AT TIME ZONE 'Europe/Belgrade')::date = $1::date`, [today]);
  if ((done.rowCount ?? 0) > 0) return;

  const res = await runBackupWithEvidence(pool, backupOpts, today.replace(/-/g, ''));
  log(res.ok ? `backup uspešan (#${res.id})` : `backup NEUSPEŠAN: ${res.error}`);
}

async function tick(): Promise<void> {
  await expireDocuments().catch((e) => log(`expire greška: ${e}`));
  await sendReminders().catch((e) => log(`reminders greška: ${e}`));
  await dailyBackup().catch((e) => log(`backup greška: ${e}`));
}

log(`Worker pokrenut. Poslovi: istek dokumenata, email podsetnici (retry), dnevni backup u ${String(BACKUP_HOUR).padStart(2, '0')}:00.`);
void tick();
setInterval(() => void tick(), 60_000); // svakih 60s
