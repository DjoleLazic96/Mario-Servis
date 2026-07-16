import { z } from 'zod';
import { hash } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import { pool } from '../db.ts';
import { config } from '../config.ts';
import { sendError } from '../http.ts';
import { requireAuth, requireAdmin } from '../auth-guards.ts';
import { writeAudit } from '../audit.ts';
import { invalidateSettingsCache } from '../settings-cache.ts';
import { encryptSecret } from '@karton/shared/crypto';
import { buildTransport, fromHeader, loadSmtp } from '@karton/shared/mailer';

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

/** Logo se čuva kao data URI u `settings.logo` — bez zavisnosti od fajl-sistema (bitno za VPS/kontejner). */
const MAX_LOGO_BYTES = 400 * 1024;
const logoSchema = z.object({
  dataUrl: z.string().regex(/^data:image\/(png|jpeg|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/, 'Dozvoljeni formati: PNG, JPEG, SVG, WebP.'),
});

/* eslint-disable @typescript-eslint/no-explicit-any */
function toSettings(r: any): Record<string, unknown> {
  return {
    shopName: r.shop_name, address: r.address, taxId: r.tax_id, phone: r.phone, logo: r.logo,
    smtpHost: r.smtp_host, smtpPort: r.smtp_port, smtpUsername: r.smtp_username, senderEmail: r.sender_email,
    hasSmtpPassword: r.has_smtp_password,
    workHoursFrom: r.work_hours_from, workHoursTo: r.work_hours_to, defaultValidityDays: r.default_validity_days,
    reminderSendTime: r.reminder_send_time, pageSize: r.page_size, version: r.version,
  };
}
const SEL = `SELECT shop_name, address, tax_id, phone, logo, smtp_host, smtp_port, smtp_username, sender_email,
  (smtp_password IS NOT NULL) has_smtp_password,
  to_char(work_hours_from,'HH24:MI') work_hours_from, to_char(work_hours_to,'HH24:MI') work_hours_to,
  default_validity_days, to_char(reminder_send_time,'HH24:MI') reminder_send_time, page_size, version FROM settings WHERE id=1`;
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // GET dozvoljen svima (front čita page_size, radno vreme, logo); PATCH samo admin
  app.get('/settings', { preHandler: requireAuth }, async () => {
    const { rows } = await pool.query(SEL);
    return toSettings(rows[0]);
  });

  app.patch('/settings', { preHandler: requireAdmin }, async (request, reply) => {
    const b = settingsSchema.parse(request.body);
    const cur = await pool.query(SEL);
    if (cur.rows[0]!.version !== b.version) return sendError(reply, 409, 'VERSION_CONFLICT', 'Podešavanja su izmenjena u međuvremenu.');
    // Lozinka se ŠIFRUJE pre upisa (ključ je SECRETS_KEY iz .env, nije u bazi).
    // Prazno polje = „ne diram lozinku" → coalesce zadržava postojeću.
    const password = b.smtpPassword ? encryptSecret(b.smtpPassword, config.SECRETS_KEY) : null;
    await pool.query(
      `UPDATE settings SET shop_name=$1, address=$2, tax_id=$3, phone=$4, smtp_host=$5, smtp_port=$6, smtp_username=$7,
        smtp_password=coalesce($8, smtp_password), sender_email=$9, work_hours_from=$10, work_hours_to=$11,
        default_validity_days=$12, reminder_send_time=$13, page_size=$14, version=version+1, updated_at=now() WHERE id=1`,
      [b.shopName, b.address ?? null, b.taxId ?? null, b.phone ?? null, b.smtpHost ?? null, b.smtpPort ?? null,
        b.smtpUsername ?? null, password, b.senderEmail ?? null, b.workHoursFrom, b.workHoursTo,
        b.defaultValidityDays, b.reminderSendTime, b.pageSize]);
    invalidateSettingsCache();
    const { rows } = await pool.query(SEL);
    // Lozinka ne može da procuri u audit: SEL je i ne čita, vraća samo `has_smtp_password`.
    await writeAudit({ userId: request.currentUser!.id, entityType: 'settings', entityId: 1, action: 'settings.changed',
      oldValue: toSettings(cur.rows[0]), newValue: toSettings(rows[0]) });
    return toSettings(rows[0]);
  });

  /**
   * POST /settings/test-email — „Pošalji probni mejl".
   * Bez ovoga se SMTP podešava naslepo: greška bi se videla tek kad podsetnik tiho ne stigne.
   * Koristi ISTI put kao pravi podsetnik (loadSmtp + buildTransport), da test ne laže.
   */
  app.post('/settings/test-email', { preHandler: requireAdmin }, async (request, reply) => {
    const b = z.object({ to: z.string().email('Unesite ispravnu email adresu.') }).parse(request.body);
    const smtp = await loadSmtp(pool, config.SECRETS_KEY);
    try {
      await buildTransport(smtp).sendMail({
        from: fromHeader(smtp),
        to: b.to,
        subject: `Probni mejl — ${smtp.shopName}`,
        text: `Ovo je probni mejl iz aplikacije ${smtp.shopName}.\n\n`
          + `Ako ga vidite, slanje podsetnika radi.\n\n`
          + `Server: ${smtp.host}:${smtp.port}\n`
          + `Prijava: ${smtp.username ?? '(bez prijave)'}\n`
          + `Izvor podešavanja: ${smtp.source === 'settings' ? 'ekran Podešavanja' : '.env (rezerva)'}\n`,
      });
    } catch (err) {
      // Poruka provajdera je ovde najkorisnija stvar — vraćamo je kakva jeste.
      const msg = err instanceof Error ? err.message : String(err);
      return sendError(reply, 422, 'SMTP_FAILED', `Slanje nije uspelo: ${msg}`);
    }
    await writeAudit({ userId: request.currentUser!.id, entityType: 'settings', entityId: 1, action: 'settings.changed',
      newValue: { probniMejl: b.to, smtpHost: smtp.host, izvor: smtp.source } });
    return { sentTo: b.to, host: smtp.host, port: smtp.port, source: smtp.source };
  });

  // PUT /settings/logo — data URI, do 400 KB
  app.put('/settings/logo', { preHandler: requireAdmin }, async (request, reply) => {
    const b = logoSchema.parse(request.body);
    const base64 = b.dataUrl.slice(b.dataUrl.indexOf(',') + 1);
    if (Buffer.byteLength(base64, 'base64') > MAX_LOGO_BYTES) {
      return sendError(reply, 422, 'VALIDATION_FAILED', 'Logo je veći od 400 KB.');
    }
    await pool.query(`UPDATE settings SET logo=$1, version=version+1, updated_at=now() WHERE id=1`, [b.dataUrl]);
    await writeAudit({ userId: request.currentUser!.id, entityType: 'settings', entityId: 1, action: 'settings.changed',
      newValue: { logo: 'postavljen' } });
    const { rows } = await pool.query(SEL);
    return toSettings(rows[0]);
  });

  app.delete('/settings/logo', { preHandler: requireAdmin }, async (request) => {
    await pool.query(`UPDATE settings SET logo=NULL, version=version+1, updated_at=now() WHERE id=1`);
    await writeAudit({ userId: request.currentUser!.id, entityType: 'settings', entityId: 1, action: 'settings.changed',
      newValue: { logo: 'obrisan' } });
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
    await writeAudit({ userId: request.currentUser!.id, entityType: 'user', entityId: rows[0]!.id, action: 'user.created',
      newValue: { name: b.name, email: b.email, role: b.role } });
    return reply.code(201).send(rows[0]);
  });

  app.patch('/users/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const b = z.object({ name: z.string().trim().min(1), role: z.enum(['admin', 'user']), status: z.enum(['active', 'disabled']), password: z.string().min(6).optional() }).parse(request.body);
    const before = await pool.query(`SELECT name, role, status FROM app_user WHERE id=$1`, [id]);
    if (!before.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Korisnik ne postoji.');
    await pool.query(`UPDATE app_user SET name=$1, role=$2, status=$3, password_hash=coalesce($4, password_hash), updated_at=now() WHERE id=$5`,
      [b.name, b.role, b.status, b.password ? await hash(b.password) : null, id]);
    const { rows } = await pool.query(`SELECT id, name, email, role, status FROM app_user WHERE id=$1`, [id]);
    await writeAudit({ userId: request.currentUser!.id, entityType: 'user', entityId: id, action: 'user.updated',
      oldValue: before.rows[0], newValue: { name: b.name, role: b.role, status: b.status, passwordChanged: Boolean(b.password) } });
    return rows[0];
  });
}
