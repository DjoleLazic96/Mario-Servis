import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { runBackupWithEvidence, restoreBackup } from '@karton/shared/backup';
import { pool } from '../db.ts';
import { config } from '../config.ts';
import { sendError } from '../http.ts';
import { requireAdmin } from '../auth-guards.ts';
import { writeAudit } from '../audit.ts';

const opts = { databaseUrl: config.DATABASE_URL, backupDir: config.backupDir, dockerContainer: config.dbContainer };

/** Vremenska oznaka u nazivu fajla — lokalno beogradsko vreme, bez dvotačaka (Windows). */
function stamp(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Belgrade' }).replace(/[: ]/g, '-');
}

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  app.get('/backup/runs', async () => {
    const { rows } = await pool.query(
      `SELECT id, started_at, finished_at, status, destination, size_bytes, error
       FROM backup_run ORDER BY started_at DESC LIMIT 50`);
    return rows.map((r) => ({
      id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, status: r.status,
      destination: r.destination, sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes), error: r.error,
    }));
  });

  app.post('/backup/run', async (request, reply) => {
    const res = await runBackupWithEvidence(pool, opts, stamp());
    await writeAudit({ userId: request.currentUser!.id, entityType: 'backup', entityId: res.id,
      action: 'backup.run', newValue: { ok: res.ok, error: res.error ?? null } });
    if (!res.ok) return sendError(reply, 500, 'BACKUP_FAILED', res.error ?? 'Backup nije uspeo.');
    const { rows } = await pool.query(`SELECT id, started_at, finished_at, status, destination, size_bytes FROM backup_run WHERE id=$1`, [res.id]);
    return reply.code(201).send(rows[0]);
  });

  // POST /backup/restore — RAZORNO: prepisuje celu bazu. Admin + eksplicitna potvrda + razlog.
  app.post('/backup/restore', async (request, reply) => {
    const b = z.object({
      runId: z.number().int().positive(),
      confirm: z.literal('VRATI IZ BACKUPA'),
      reason: z.string().trim().min(1),
    }).parse(request.body);

    const run = await pool.query<{ destination: string | null; status: string }>(
      `SELECT destination, status FROM backup_run WHERE id=$1`, [b.runId]);
    if (!run.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Backup ne postoji.');
    if (run.rows[0].status !== 'success' || !run.rows[0].destination) {
      return sendError(reply, 422, 'BACKUP_UNUSABLE', 'Taj backup nije uspešno završen.');
    }

    const userId = request.currentUser!.id;
    // Dump ne nosi podatke `backup_run`, pa evidenciju sami prenosimo preko vraćanja.
    const evidence = await pool.query(`SELECT id, started_at, finished_at, status, destination, size_bytes, error FROM backup_run ORDER BY id`);

    try {
      await restoreBackup(opts, run.rows[0].destination);
    } catch (err) {
      return sendError(reply, 500, 'RESTORE_FAILED', err instanceof Error ? err.message : 'Vraćanje nije uspelo.');
    }

    for (const r of evidence.rows) {
      await pool.query(
        `INSERT INTO backup_run (id, started_at, finished_at, status, destination, size_bytes, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [r.id, r.started_at, r.finished_at, r.status, r.destination, r.size_bytes, r.error]);
    }
    await pool.query(`SELECT setval('backup_run_id_seq', coalesce((SELECT max(id) FROM backup_run), 1))`);

    // audit tek POSLE vraćanja — zapis upisan ranije bi bio prepisan starim audit_log-om
    await writeAudit({ userId, entityType: 'backup', entityId: b.runId,
      action: 'backup.restored', newValue: { file: run.rows[0].destination }, reason: b.reason });

    // Vraćena baza može imati druge korisnike i lozinke — niko ne sme da ostane prijavljen.
    // Sesiju pozivaoca gasimo izričito, jer bi je `@fastify/session` na kraju ovog
    // zahteva ponovo upisao u tek ispražnjenu tabelu.
    await pool.query('DELETE FROM "session"');
    await request.session.destroy();

    return { restored: true, file: run.rows[0].destination, loggedOut: true };
  });
}
