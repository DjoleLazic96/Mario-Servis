/**
 * Backup se izvršava kroz `pg_dump` / `psql`. Na VPS-u su ti alati na PATH-u;
 * u lokalnom razvoju baza živi u Docker kontejneru, pa se komanda provlači kroz `docker exec`.
 * Modul je u `shared` jer ga koriste i API (ruka: "Napravi sada" / "Vrati iz backupa") i worker (dnevni posao).
 */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Minimum koji nam treba od `pg.Pool` — da `shared` ne zavisi od drajvera. */
export interface QueryablePool {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export interface BackupOptions {
  databaseUrl: string;
  backupDir: string;
  /** Ime Docker kontejnera sa bazom — koristi se samo ako `pg_dump` nije na PATH-u. */
  dockerContainer?: string;
}

function run(cmd: string, args: string[], opts: { stdoutTo?: string; stdinFrom?: string; env?: NodeJS.ProcessEnv } = {}): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    // bez `shell: true` — lozinka nikad ne prolazi kroz komandnu liniju niti kroz interpretaciju shell-a
    const child = spawn(cmd, args, {
      stdio: ['pipe', opts.stdoutTo ? 'pipe' : 'ignore', 'pipe'],
      env: opts.env ?? process.env,
    });
    const stdin = child.stdin!;
    let stderr = '';
    child.stderr!.on('data', (d: Buffer) => { stderr += d.toString(); });

    if (opts.stdoutTo) {
      const out = createWriteStream(opts.stdoutTo);
      child.stdout!.pipe(out);
      out.on('error', reject);
    }
    if (opts.stdinFrom) {
      readFile(opts.stdinFrom).then((buf) => { stdin.end(buf); }).catch(reject);
    } else {
      stdin.end();
    }

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${cmd} izašao sa kodom ${code}: ${stderr.trim().slice(0, 500)}`));
    });
  });
}

async function onPath(cmd: string): Promise<boolean> {
  try { await run(cmd, ['--version']); return true; } catch { return false; }
}

interface Conn { host: string; port: string; user: string; password: string; database: string }
function parseUrl(databaseUrl: string): Conn {
  const u = new URL(databaseUrl);
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

interface Command { cmd: string; args: string[]; env: NodeJS.ProcessEnv }

/**
 * Gradi komandu za `pg_dump`/`psql`.
 *
 * Dve zamke koje ovo rešava:
 *  1. Kroz `docker exec` se NE sme proslediti URL sa hosta (`localhost:5544`) — unutar
 *     kontejnera taj port ne postoji. Tamo idu `-U`/`-d` preko lokalnog soketa.
 *  2. Lozinka ne ide u argumente (vidljivi su u listi procesa), nego u `PGPASSWORD`.
 */
async function buildCommand(tool: 'pg_dump' | 'psql', o: BackupOptions, toolArgs: string[]): Promise<Command> {
  const c = parseUrl(o.databaseUrl);
  if (await onPath(tool)) {
    return {
      cmd: tool,
      args: [...toolArgs, '-h', c.host, '-p', c.port, '-U', c.user, '-d', c.database],
      env: { ...process.env, PGPASSWORD: c.password },
    };
  }
  if (o.dockerContainer) {
    // lokalni soket u kontejneru je `trust` — lozinka nije potrebna
    return {
      cmd: 'docker',
      args: ['exec', '-i', o.dockerContainer, tool, ...toolArgs, '-U', c.user, '-d', c.database],
      env: process.env,
    };
  }
  throw new Error(`Ni \`${tool}\` na PATH-u ni Docker kontejner nisu dostupni.`);
}

/**
 * Tabele čiji se SADRŽAJ ne snima (šema da, podaci ne):
 *  - `session`    — vraćanje bi oživelo stare, odjavljene sesije (bezbednosni rizik).
 *  - `backup_run` — evidencija mora da opisuje SADAŠNJE stanje mašine, a ne ono iz dumpa.
 *
 * Koristi se `--exclude-table-data`, ne `--exclude-table`: potpuno izbacivanje tabele
 * ostavlja njen sequence u dumpu, pa `DROP SEQUENCE` pukne zbog zavisnosti.
 * Posle vraćanja obe tabele ostaju prazne — pozivalac vraća evidenciju i odjavljuje sve.
 */
const DATA_EXCLUDED_TABLES = ['session', 'backup_run'];

/** Puni logički dump (plain SQL). Vraća putanju fajla i veličinu. */
export async function createBackup(o: BackupOptions, stamp: string): Promise<{ file: string; sizeBytes: number }> {
  const dir = resolve(o.backupDir);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `karton-${stamp}.sql`);
  // --clean --if-exists čini dump ponovo primenjivim nad postojećom bazom
  const { cmd, args, env } = await buildCommand('pg_dump', o, [
    '--clean', '--if-exists', '--no-owner', '--no-privileges',
    ...DATA_EXCLUDED_TABLES.map((t) => `--exclude-table-data=${t}`),
  ]);
  await run(cmd, args, { stdoutTo: file, env });
  const { size } = await stat(file);
  if (size === 0) throw new Error('pg_dump je napravio prazan fajl.');
  return { file, sizeBytes: size };
}

/**
 * Vraća bazu iz dump fajla. RAZORNO — pozivalac mora da traži potvrdu.
 *
 * `--single-transaction` je obavezan: bez njega `psql` sa `ON_ERROR_STOP` stane na pola,
 * pošto je već izvršio DROP naredbe — i baza ostane osakaćena. Ovako je vraćanje
 * sve-ili-ništa: greška ostavlja bazu netaknutom.
 */
export async function restoreBackup(o: BackupOptions, file: string): Promise<void> {
  const dir = resolve(o.backupDir);
  const target = resolve(file);
  // putanja mora da ostane unutar backup direktorijuma (bez ../ izlaska)
  if (!target.startsWith(dir)) throw new Error('Fajl nije u backup direktorijumu.');
  await stat(target);
  const { cmd, args, env } = await buildCommand('psql', o, ['--single-transaction', '-v', 'ON_ERROR_STOP=1']);
  await run(cmd, args, { stdinFrom: target, env });
}

/** Izvrši backup i upiši ishod u `backup_run` — i uspeh i neuspeh ostavljaju trag. */
export async function runBackupWithEvidence(pool: QueryablePool, o: BackupOptions, stamp: string): Promise<{ id: number; ok: boolean; error?: string }> {
  const ins = await pool.query<{ id: number }>(
    `INSERT INTO backup_run (started_at, status) VALUES (now(), 'failed') RETURNING id`);
  const id = ins.rows[0]!.id;
  try {
    const { file, sizeBytes } = await createBackup(o, stamp);
    await pool.query(`UPDATE backup_run SET finished_at=now(), status='success', destination=$1, size_bytes=$2, error=NULL WHERE id=$3`,
      [file, sizeBytes, id]);
    return { id, ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(`UPDATE backup_run SET finished_at=now(), status='failed', error=$1 WHERE id=$2`, [msg, id]);
    return { id, ok: false, error: msg };
  }
}
