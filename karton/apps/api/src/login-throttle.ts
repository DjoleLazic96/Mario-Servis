/**
 * Kočnica na prijavi (spec §6).
 *
 * Zaključava se ADRESA KOJA POGAĐA, ne nalog — da neko ko zna korisničko ime
 * ne bi mogao da drži Marija trajno napolju. Robot koji skenira internet biva
 * odsečen, a Mario u servisu (druga adresa) ne oseti ništa.
 *
 * Brojač živi u bazi, ne u memoriji: preživljava restart i deploy.
 */
import { pool } from './db.ts';

/** Promašaja pre zaključavanja. Pet, ne tri — omaška pri kucanju je normalna. */
const MAX_FAILURES = 5;
/** Koliko adresa čeka posle zaključavanja. */
const LOCK_MINUTES = 30;
/** Posle ovoliko mirovanja brojač se poništava — stare omaške ne pamtimo zauvek. */
const RESET_MINUTES = 30;

export interface LockState { locked: boolean; secondsLeft: number }

/** Da li je adresa trenutno zaključana (poziva se PRE provere lozinke). */
export async function checkLock(ip: string): Promise<LockState> {
  const { rows } = await pool.query<{ secs: number }>(
    `SELECT ceil(extract(epoch FROM (locked_until - now())))::int secs
       FROM login_throttle WHERE ip=$1 AND locked_until > now()`, [ip]);
  const secs = rows[0]?.secs;
  return secs ? { locked: true, secondsLeft: secs } : { locked: false, secondsLeft: 0 };
}

/**
 * Beleži promašaj. Vraća stanje posle beleženja — ako je ovim potezom
 * dostignut limit, adresa je od sada zaključana.
 */
export async function recordFailure(ip: string): Promise<LockState> {
  // Jedan upit: uvećaj (ili poništi ako je prošao prozor mirovanja) i vrati novi broj.
  const { rows } = await pool.query<{ failed_count: number }>(
    `INSERT INTO login_throttle (ip, failed_count, updated_at) VALUES ($1, 1, now())
     ON CONFLICT (ip) DO UPDATE SET
       failed_count = CASE
         WHEN login_throttle.updated_at < now() - ($2 || ' minutes')::interval THEN 1
         ELSE login_throttle.failed_count + 1 END,
       updated_at = now()
     RETURNING failed_count`, [ip, RESET_MINUTES]);
  const count = rows[0]!.failed_count;
  if (count < MAX_FAILURES) return { locked: false, secondsLeft: 0 };

  await pool.query(
    `UPDATE login_throttle SET locked_until = now() + ($2 || ' minutes')::interval, failed_count = 0 WHERE ip=$1`,
    [ip, LOCK_MINUTES]);
  return { locked: true, secondsLeft: LOCK_MINUTES * 60 };
}

/** Uspešna prijava briše trag — pošten korisnik ne nosi stare promašaje. */
export async function clearFailures(ip: string): Promise<void> {
  await pool.query('DELETE FROM login_throttle WHERE ip=$1', [ip]);
}

/** Zaključane adrese — za admina u Podešavanjima. */
export async function listLocks(): Promise<{ ip: string; lockedUntil: string }[]> {
  const { rows } = await pool.query<{ ip: string; locked_until: string }>(
    `SELECT ip, locked_until FROM login_throttle WHERE locked_until > now() ORDER BY locked_until DESC`);
  return rows.map((r) => ({ ip: r.ip, lockedUntil: r.locked_until }));
}

/** Admin pušta ranije. */
export async function unlock(ip: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM login_throttle WHERE ip=$1', [ip]);
  return (r.rowCount ?? 0) > 0;
}

export const throttleLimits = { MAX_FAILURES, LOCK_MINUTES };
