import { z } from 'zod';
import { hash } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import { pool } from '../db.ts';
import { sendError } from '../http.ts';
import { requireAuth, requireAdmin } from '../auth-guards.ts';

const TIME = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

const settingsSchema = z.object({
  shopName: z.string().trim().min(1),
  address: z.string().trim().nullish(),
  taxId: z.string().trim().nullish(),
  phone: z.string().trim().nullish(),
  smtpHost: z.string().trim().nullish(),
  smtpPort: z.number().int().nullish(),
  smtpUsername: z.string().trim().nullish(),
  smtpPassword: z.string().nullish(),
  senderEmail: z.string().trim().nullish(),
  workHoursFrom: TIME,
  workHoursTo: TIME,
  defaultValidityDays: z.number().int().positive(),
  reminderSendTime: TIME,
  pageSize: z.number().int().positive(),
  version: z.number().int(),
});

/* eslint-disable @typescript-eslint/no-explicit-any */
function toSettings(r: any): Record<string, unknown> {
  return {
    shopName: r.shop_name, address: r.address, taxId: r.tax_id, phone: r.phone, logo: r.logo,
    smtpHost: r.smtp_host, smtpPort: r.smtp_port, smtpUsername: r.smtp_username, senderEmail: r.sender_email,
    workHoursFrom: r.work_hours_from, workHoursTo: r.work_hours_to, defaultValidityDays: r.default_validity_days,
    reminderSendTime: r.reminder_send_time, pageSize: r.page_size, version: r.version,
  };
}
const SEL = `SELECT shop_name, address, tax_id, phone, logo, smtp_host, smtp_port, smtp_username, sender_email,
  to_char(work_hours_from,'HH24:MI') work_hours_from, to_char(work_hours_to,'HH24:MI') work_hours_to,
  default_validity_days, to_char(reminder_send_time,'HH24:MI') reminder_send_time, page_size, version FROM settings WHERE id=1`;
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // GET dozvoljen svima (front čita page_size, radno vreme); PATCH samo admin
  app.get('/settings', { preHandler: requireAuth }, async () => {
    const { rows } = await pool.query(SEL);
    return toSettings(rows[0]);
  });

  app.patch('/settings', { preHandler: requireAdmin }, async (request, reply) => {
    const b = settingsSchema.parse(request.body);
    const cur = await pool.query<{ version: number }>('SELECT version FROM settings WHERE id=1');
    if (cur.rows[0]!.version !== b.version) return sendError(reply, 409, 'VERSION_CONFLICT', 'Podešavanja su izmenjena u međuvremenu.');
    await pool.query(
      `UPDATE settings SET shop_name=$1, address=$2, tax_id=$3, phone=$4, smtp_host=$5, smtp_port=$6, smtp_username=$7,
        smtp_password=coalesce($8, smtp_password), sender_email=$9, work_hours_from=$10, work_hours_to=$11,
        default_validity_days=$12, reminder_send_time=$13, page_size=$14, version=version+1, updated_at=now() WHERE id=1`,
      [b.shopName, b.address ?? null, b.taxId ?? null, b.phone ?? null, b.smtpHost ?? null, b.smtpPort ?? null,
        b.smtpUsername ?? null, b.smtpPassword || null, b.senderEmail ?? null, b.workHoursFrom, b.workHoursTo,
        b.defaultValidityDays, b.reminderSendTime, b.pageSize]);
    const { rows } = await pool.query(SEL);
    return toSettings(rows[0]);
  });

  // Korisnici (samo admin)
  app.get('/users', { preHandler: requireAdmin }, async () => {
    const { rows } = await pool.query(`SELECT id, name, email, role, status FROM app_user ORDER BY name`);
    return rows;
  });
  app.post('/users', { preHandler: requireAdmin }, async (request, reply) => {
    const b = z.object({ name: z.string().trim().min(1), email: z.string().email(), password: z.string().min(6), role: z.enum(['admin', 'user']) }).parse(request.body);
    const dup = await pool.query('SELECT 1 FROM app_user WHERE email=$1', [b.email]);
    if ((dup.rowCount ?? 0) > 0) return sendError(reply, 409, 'DUPLICATE_EMAIL', 'Korisnik sa tim emailom već postoji.');
    const ph = await hash(b.password);
    const { rows } = await pool.query(`INSERT INTO app_user (name, email, password_hash, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id, name, email, role, status`,
      [b.name, b.email, ph, b.role]);
    return reply.code(201).send(rows[0]);
  });
  app.patch('/users/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const b = z.object({ name: z.string().trim().min(1), role: z.enum(['admin', 'user']), status: z.enum(['active', 'disabled']), password: z.string().min(6).optional() }).parse(request.body);
    await pool.query(`UPDATE app_user SET name=$1, role=$2, status=$3, password_hash=coalesce($4, password_hash), updated_at=now() WHERE id=$5`,
      [b.name, b.role, b.status, b.password ? await hash(b.password) : null, id]);
    const { rows } = await pool.query(`SELECT id, name, email, role, status FROM app_user WHERE id=$1`, [id]);
    if (!rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Korisnik ne postoji.');
    return rows[0];
  });
}
