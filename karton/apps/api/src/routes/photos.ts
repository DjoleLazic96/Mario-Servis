import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { WorkOrderPhoto, VehiclePhotoGroup } from '@karton/shared';
import { pool } from '../db.ts';
import { config } from '../config.ts';
import { sendError } from '../http.ts';
import { requireAuth } from '../auth-guards.ts';
import { writeAudit } from '../audit.ts';
import { isWorkOrderEditable } from '../transitions.ts';

/**
 * Fotografije vozila pri prijemu (spec §4.4).
 *
 * Fajl ide na disk (UPLOADS_DIR), u bazi je samo metapodatak. Putanju gradi SERVER
 * (nikad klijent) — VIN / datum_RN-broj / uuid.jpg. VIN je ključ jer je nepromenljiv;
 * tablica se menja i razbila bi folder istog vozila na dva.
 *
 * Slike su lični podaci klijenta: serviraju se ISKLJUČIVO kroz prijavljenu rutu,
 * nikad kao javni statički folder.
 */
const MAX_PHOTOS_PER_ORDER = 10;
const MAX_PHOTO_BYTES = 1_500_000; // ~1.5 MB posle kompresije u browseru (šaljemo ~250 KB)
const BODY_LIMIT = 4 * 1024 * 1024; // base64 naduva ~33%; ostavljamo zazor

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const uploadSchema = z.object({
  dataUrl: z.string().regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/,
    'Dozvoljeni formati: JPEG, PNG, WebP.'),
});

/* eslint-disable @typescript-eslint/no-explicit-any */
function toPhoto(r: any): WorkOrderPhoto {
  return {
    id: r.id, workOrderId: r.work_order_id, sizeBytes: r.size_bytes,
    createdAt: r.created_at, createdBy: r.created_by_name ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const PHOTO_SELECT = `
  SELECT p.id, p.work_order_id, p.size_bytes, p.created_at, u.name AS created_by_name
  FROM work_order_photo p LEFT JOIN app_user u ON u.id = p.created_by`;

async function listPhotos(workOrderId: number): Promise<WorkOrderPhoto[]> {
  const { rows } = await pool.query(`${PHOTO_SELECT} WHERE p.work_order_id=$1 ORDER BY p.id`, [workOrderId]);
  return rows.map(toPhoto);
}

/** Apsolutna putanja fajla; štiti od izlaska van UPLOADS_DIR (path traversal). */
function absolutePath(relative: string): string {
  const base = resolve(config.uploadsDir);
  const abs = resolve(base, relative);
  if (!abs.startsWith(base)) throw new Error('Putanja izvan uploads direktorijuma.');
  return abs;
}

export async function photoRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // POST /work-orders/:id/photos — slika sa prijema (data URI; browser je već smanjio/kompresovao)
  app.post('/work-orders/:id/photos', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const b = uploadSchema.parse(request.body);

    const wo = await pool.query<{ status: string; number: string; received_on: string; vin: string }>(
      `SELECT wo.status, wo.number, to_char(wo.received_on,'YYYY-MM-DD') received_on, v.vin
       FROM work_order wo JOIN vehicle v ON v.id = wo.vehicle_id WHERE wo.id=$1`, [id]);
    if (!wo.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Nalog ne postoji.');

    // Slike se dodaju SAMO dok je nalog otvoren/u radu — završen nalog je dokaz i zaključan je.
    if (!isWorkOrderEditable(wo.rows[0].status as never)) {
      return sendError(reply, 422, 'ENTITY_LOCKED', 'Nalog je završen — slike se više ne mogu dodavati.');
    }

    const count = await pool.query<{ n: string }>('SELECT count(*) n FROM work_order_photo WHERE work_order_id=$1', [id]);
    if (Number(count.rows[0]!.n) >= MAX_PHOTOS_PER_ORDER) {
      return sendError(reply, 422, 'PHOTO_LIMIT_REACHED', `Najviše ${MAX_PHOTOS_PER_ORDER} slika po prijemu.`);
    }

    const mime = b.dataUrl.slice(5, b.dataUrl.indexOf(';'));
    const base64 = b.dataUrl.slice(b.dataUrl.indexOf(',') + 1);
    const buf = Buffer.from(base64, 'base64');
    if (buf.byteLength > MAX_PHOTO_BYTES) {
      return sendError(reply, 422, 'VALIDATION_FAILED', 'Slika je prevelika (max 1.5 MB posle kompresije).');
    }

    const { vin, received_on, number } = wo.rows[0];
    const relative = join('vozila', vin, `${received_on}_${number}`, `${randomUUID()}.${MIME_EXT[mime] ?? 'jpg'}`);
    const abs = absolutePath(relative);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, buf);

    const ins = await pool.query<{ id: number }>(
      `INSERT INTO work_order_photo (work_order_id, file_path, mime, size_bytes, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [id, relative.split('\\').join('/'), mime, buf.byteLength, request.currentUser!.id]);

    await writeAudit({ userId: request.currentUser!.id, entityType: 'work_order', entityId: id,
      action: 'photo.added', newValue: { photoId: ins.rows[0]!.id, sizeBytes: buf.byteLength } });

    return reply.code(201).send(await listPhotos(id));
  });

  app.get('/work-orders/:id/photos', async (request) => {
    return listPhotos(Number((request.params as { id: string }).id));
  });

  // GET /photos/:id — sam fajl (iza prijave; <img src> šalje session cookie automatski)
  app.get('/photos/:id', async (request, reply) => {
    const pid = Number((request.params as { id: string }).id);
    const { rows } = await pool.query<{ file_path: string; mime: string }>(
      'SELECT file_path, mime FROM work_order_photo WHERE id=$1', [pid]);
    if (!rows[0]) return sendError(reply, 404, 'PHOTO_NOT_FOUND', 'Slika ne postoji.');

    let abs: string;
    try { abs = absolutePath(rows[0].file_path); }
    catch { return sendError(reply, 404, 'PHOTO_NOT_FOUND', 'Slika nije dostupna.'); }

    // Fajl može da fali (npr. posle rebuild-a servera pre sinhronizacije) — ne rušimo se.
    try { await stat(abs); }
    catch { return sendError(reply, 404, 'PHOTO_NOT_FOUND', 'Slika nije dostupna na disku.'); }

    return reply.type(rows[0].mime).header('Cache-Control', 'private, max-age=86400').send(createReadStream(abs));
  });

  app.delete('/work-orders/:id/photos/:pid', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const pid = Number((request.params as { pid: string }).pid);

    const wo = await pool.query<{ status: string }>('SELECT status FROM work_order WHERE id=$1', [id]);
    if (!wo.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Nalog ne postoji.');
    if (!isWorkOrderEditable(wo.rows[0].status as never)) {
      return sendError(reply, 422, 'ENTITY_LOCKED', 'Nalog je završen — slike se više ne mogu brisati.');
    }

    const { rows } = await pool.query<{ file_path: string }>(
      'SELECT file_path FROM work_order_photo WHERE id=$1 AND work_order_id=$2', [pid, id]);
    if (!rows[0]) return sendError(reply, 404, 'PHOTO_NOT_FOUND', 'Slika ne postoji.');

    await pool.query('DELETE FROM work_order_photo WHERE id=$1', [pid]);
    // fajl brišemo posle reda u bazi; ako fajl već fali, to ne sme da obori brisanje
    try { await unlink(absolutePath(rows[0].file_path)); } catch { /* fajl već ne postoji */ }

    await writeAudit({ userId: request.currentUser!.id, entityType: 'work_order', entityId: id,
      action: 'photo.deleted', oldValue: { photoId: pid } });

    return listPhotos(id);
  });

  // GET /vehicles/:id/photos — galerija na kartonu vozila, grupisana po posetama (nalozima)
  app.get('/vehicles/:id/photos', async (request) => {
    const vehicleId = Number((request.params as { id: string }).id);
    const { rows } = await pool.query(
      `${PHOTO_SELECT.replace('SELECT p.id', 'SELECT wo.number AS wo_number, to_char(wo.received_on,\'YYYY-MM-DD\') AS received_on, p.id')}
       JOIN work_order wo ON wo.id = p.work_order_id
       WHERE wo.vehicle_id = $1
       ORDER BY wo.received_on DESC, wo.id DESC, p.id`,
      [vehicleId]);

    const groups = new Map<number, VehiclePhotoGroup>();
    for (const r of rows) {
      let g = groups.get(r.work_order_id);
      if (!g) {
        g = { workOrderId: r.work_order_id, workOrderNumber: r.wo_number, receivedOn: r.received_on, photos: [] };
        groups.set(r.work_order_id, g);
      }
      g.photos.push(toPhoto(r));
    }
    return [...groups.values()];
  });
}
