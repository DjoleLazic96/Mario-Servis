import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import type { Appointment, CalendarBlock } from '@karton/shared';
import { pool, tx } from '../db.ts';
import { sendError } from '../http.ts';
import { requireAuth } from '../auth-guards.ts';
import { writeAudit } from '../audit.ts';
import { todayBelgrade } from '../time.ts';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TIME = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

const apptSchema = z.object({
  date: DATE,
  time: TIME,
  durationMin: z.number().int().positive().default(60),
  customerId: z.number().int().positive(),
  vehicleId: z.number().int().positive(),
  mechanicId: z.number().int().positive().nullish(),
  note: z.string().trim().nullish(),
  remindersEnabled: z.boolean().default(true),
  confirmed: z.boolean().default(false),
});

const blockSchema = z.object({ fromDate: DATE, toDate: DATE, reason: z.string().trim().nullish() });

/* eslint-disable @typescript-eslint/no-explicit-any */
function toAppt(r: any): Appointment {
  return {
    id: r.id, date: r.date, time: r.time, durationMin: r.duration_min,
    customer: { id: r.customer_id, name: r.customer_name, type: r.customer_type },
    vehicle: { id: r.vehicle_id, vin: r.vin, make: r.make, model: r.model, plate: r.plate },
    mechanic: r.mechanic_id ? { id: r.mechanic_id, fullName: r.mechanic_name } : null,
    note: r.note, status: r.status, workOrderId: r.work_order_id,
    remindersEnabled: r.reminders_enabled, reminderStatus: r.reminder_status, reminderReason: r.reminder_reason, version: r.version,
  };
}
const APPT_SELECT = `
  SELECT a.id, to_char(a.date,'YYYY-MM-DD') date, to_char(a.time,'HH24:MI') time, a.duration_min,
    a.customer_id, a.vehicle_id, a.mechanic_id, a.note, a.status, a.work_order_id, a.reminders_enabled, a.version,
    c.name customer_name, c.type customer_type, v.vin, v.make, v.model,
    (SELECT rh.plate FROM registration_history rh WHERE rh.vehicle_id=v.id AND rh.valid_to IS NULL LIMIT 1) plate,
    m.full_name mechanic_name,
    (SELECT ar.send_status FROM appointment_reminder ar WHERE ar.appointment_id=a.id ORDER BY ar.id DESC LIMIT 1) reminder_status,
    (SELECT ar.last_error FROM appointment_reminder ar WHERE ar.appointment_id=a.id ORDER BY ar.id DESC LIMIT 1) reminder_reason
  FROM appointment a
  JOIN customer c ON c.id=a.customer_id JOIN vehicle v ON v.id=a.vehicle_id
  LEFT JOIN mechanic m ON m.id=a.mechanic_id`;

async function loadAppt(id: number, client?: PoolClient): Promise<Appointment | null> {
  const { rows } = await (client ?? pool).query(`${APPT_SELECT} WHERE a.id=$1`, [id]);
  return rows[0] ? toAppt(rows[0]) : null;
}

// Podsetnik: jedan po terminu, dan pre u vreme iz podešavanja; samo ako uključen + klijent ima email
async function syncReminder(client: PoolClient, apptId: number): Promise<void> {
  await client.query(`DELETE FROM appointment_reminder WHERE appointment_id=$1 AND send_status IN ('scheduled','failed')`, [apptId]);
  const a = await client.query<{ date: string; enabled: boolean; status: string; has_email: boolean }>(
    `SELECT to_char(a.date,'YYYY-MM-DD') date, a.reminders_enabled enabled, a.status,
      EXISTS(SELECT 1 FROM customer_contact cc WHERE cc.customer_id=a.customer_id AND cc.kind='email') has_email
     FROM appointment a WHERE a.id=$1`, [apptId]);
  const row = a.rows[0];
  // Podsetnik se zakazuje na osnovu namere (uključen + termin zakazan), BEZ obzira na email.
  // Email se proverava tek u trenutku slanja u workeru (pravila podsetnika 4–6): tako
  // email dodat pre vremena slanja stigne na vreme, a onaj dodat posle ne izaziva zakašnjelo slanje.
  if (!row || !row.enabled || row.status !== 'scheduled') return;
  const s = await client.query<{ t: string }>(`SELECT to_char(reminder_send_time,'HH24:MI') t FROM settings WHERE id=1`);
  const sendTime = s.rows[0]?.t ?? '09:00';
  // dan pre termina u sendTime
  const sendAt = `${offsetDay(row.date, -1)} ${sendTime}:00`;
  await client.query(
    `INSERT INTO appointment_reminder (appointment_id, offset_min, scheduled_send_at, send_status)
     VALUES ($1, 1440, $2::timestamptz, 'scheduled')`, [apptId, sendAt]);
}
function offsetDay(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!)); dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Meka/tvrda pravila (BR-27): blokada = tvrda; preklapanje/van radnog vremena = upozorenje
async function checkConstraints(b: z.infer<typeof apptSchema>, excludeId?: number): Promise<{ block: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  const blocked = await pool.query(`SELECT 1 FROM calendar_block WHERE $1::date BETWEEN from_date AND to_date`, [b.date]);
  if ((blocked.rowCount ?? 0) > 0) return { block: true, warnings: ['CALENDAR_BLOCKED'] };

  const wh = await pool.query<{ f: string; t: string }>(`SELECT to_char(work_hours_from,'HH24:MI') f, to_char(work_hours_to,'HH24:MI') t FROM settings WHERE id=1`);
  if (wh.rows[0] && (b.time < wh.rows[0].f || b.time >= wh.rows[0].t)) warnings.push('OUTSIDE_WORK_HOURS');

  if (b.mechanicId) {
    const busy = await pool.query(
      `SELECT 1 FROM appointment WHERE mechanic_id=$1 AND date=$2 AND status='scheduled' AND id <> coalesce($5, 0)
       AND (time, time + (duration_min || ' minutes')::interval) OVERLAPS
           ($3::time, $3::time + ($4 || ' minutes')::interval)`,
      [b.mechanicId, b.date, b.time, b.durationMin, excludeId ?? null]);
    if ((busy.rowCount ?? 0) > 0) warnings.push('MECHANIC_BUSY');

    const away = await pool.query(
      `SELECT 1 FROM mechanic_unavailability WHERE mechanic_id=$1 AND $2::date BETWEEN from_date AND to_date`,
      [b.mechanicId, b.date]);
    if ((away.rowCount ?? 0) > 0) warnings.push('MECHANIC_UNAVAILABLE');
  }

  // Uključen podsetnik, a klijent nema email → meko upozorenje (ne tvrda greška):
  // podsetnik se „naoruža" i poslaće se samo ako se email doda pre vremena slanja (pravilo 5).
  if (b.remindersEnabled) {
    const em = await pool.query(`SELECT 1 FROM customer_contact WHERE customer_id=$1 AND kind='email'`, [b.customerId]);
    if (em.rowCount === 0) warnings.push('NO_CUSTOMER_EMAIL');
  }

  return { block: false, warnings };
}

export async function appointmentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/appointments', async (request) => {
    const q = request.query as Record<string, string | undefined>;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (q['from']) { params.push(q['from']); conds.push(`a.date >= $${params.length}`); }
    if (q['to']) { params.push(q['to']); conds.push(`a.date <= $${params.length}`); }
    if (q['mechanicId']) { params.push(Number(q['mechanicId'])); conds.push(`a.mechanic_id = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await pool.query(`${APPT_SELECT} ${where} ORDER BY a.date, a.time`, params);
    return rows.map(toAppt);
  });

  app.post('/appointments', async (request, reply) => {
    const b = apptSchema.parse(request.body);
    const chk = await checkConstraints(b);
    if (chk.block) return sendError(reply, 422, 'CALENDAR_BLOCKED', 'Taj dan je blokiran u kalendaru.');
    if (chk.warnings.length && !b.confirmed) return sendError(reply, 409, 'CONFIRMATION_REQUIRED', 'Postoje upozorenja — potvrdite.', { warnings: chk.warnings });
    const created = await tx(async (client) => {
      const ins = await client.query<{ id: number }>(
        `INSERT INTO appointment (date, time, duration_min, customer_id, vehicle_id, mechanic_id, note, reminders_enabled, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [b.date, b.time, b.durationMin, b.customerId, b.vehicleId, b.mechanicId ?? null, b.note ?? null, b.remindersEnabled, request.currentUser!.id]);
      const id = ins.rows[0]!.id;
      await syncReminder(client, id);
      return (await loadAppt(id, client))!;
    });
    return reply.code(201).send(created);
  });

  app.patch('/appointments/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const b = apptSchema.extend({ version: z.number().int() }).parse(request.body);
    const cur = await pool.query<{ version: number }>('SELECT version FROM appointment WHERE id=$1', [id]);
    if (!cur.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Termin ne postoji.');
    if (cur.rows[0].version !== b.version) return sendError(reply, 409, 'VERSION_CONFLICT', 'Termin je izmenjen u međuvremenu.');
    const chk = await checkConstraints(b, id);
    if (chk.block) return sendError(reply, 422, 'CALENDAR_BLOCKED', 'Taj dan je blokiran.');
    if (chk.warnings.length && !b.confirmed) return sendError(reply, 409, 'CONFIRMATION_REQUIRED', 'Postoje upozorenja — potvrdite.', { warnings: chk.warnings });
    const updated = await tx(async (client) => {
      await client.query(
        `UPDATE appointment SET date=$1, time=$2, duration_min=$3, customer_id=$4, vehicle_id=$5, mechanic_id=$6, note=$7,
          reminders_enabled=$8, version=version+1, updated_at=now() WHERE id=$9`,
        [b.date, b.time, b.durationMin, b.customerId, b.vehicleId, b.mechanicId ?? null, b.note ?? null, b.remindersEnabled, id]);
      await syncReminder(client, id);
      return (await loadAppt(id, client))!;
    });
    return updated;
  });

  app.post('/appointments/:id/status', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const b = z.object({ status: z.enum(['scheduled', 'completed', 'cancelled', 'no_show']), workOrderId: z.number().int().positive().nullish(), reason: z.string().trim().nullish(), version: z.number().int() }).parse(request.body);
    const cur = await pool.query<{ status: string; version: number; work_order_id: number | null }>('SELECT status, version, work_order_id FROM appointment WHERE id=$1', [id]);
    if (!cur.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Termin ne postoji.');
    if (cur.rows[0].version !== b.version) return sendError(reply, 409, 'VERSION_CONFLICT', 'Termin je izmenjen u međuvremenu.');
    // completed → scheduled samo ako nije vezan za nalog (BR-28); admin sme uz razlog
    const isAdmin = request.currentUser!.role === 'admin';
    const revertLinked = cur.rows[0].status === 'completed' && b.status === 'scheduled' && cur.rows[0].work_order_id !== null;
    if (revertLinked && !isAdmin) {
      return sendError(reply, 422, 'APPOINTMENT_LINKED', 'Termin je vezan za nalog — vraćanje statusa nije moguće.');
    }
    if (revertLinked && !b.reason) {
      return sendError(reply, 422, 'REASON_REQUIRED', 'Razlog je obavezan za ovu korekciju.');
    }
    await tx(async (client) => {
      await client.query(
        `UPDATE appointment SET status=$1, work_order_id = CASE WHEN $4 THEN NULL ELSE coalesce($2, work_order_id) END,
          version=version+1, updated_at=now() WHERE id=$3`,
        [b.status, b.workOrderId ?? null, id, revertLinked]);
      // termin van statusa 'scheduled' ne šalje podsetnik (BR-30)
      if (b.status !== 'scheduled') {
        await client.query(`DELETE FROM appointment_reminder WHERE appointment_id=$1 AND send_status IN ('scheduled','failed')`, [id]);
      } else {
        await syncReminder(client, id);
      }
      if (revertLinked) {
        await writeAudit({ userId: request.currentUser!.id, entityType: 'appointment', entityId: id, action: 'appointment.corrected',
          oldValue: { status: cur.rows[0]!.status, workOrderId: cur.rows[0]!.work_order_id },
          newValue: { status: b.status, workOrderId: null }, reason: b.reason }, client);
      }
    });
    return loadAppt(id);
  });

  app.delete('/appointments/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const cur = await pool.query<{ date: string; time: string }>(`SELECT to_char(date,'YYYY-MM-DD') date, to_char(time,'HH24:MI') time FROM appointment WHERE id=$1`, [id]);
    if (!cur.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Termin ne postoji.');
    // fizičko brisanje samo dok nije počeo (BR-29)
    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Belgrade' }).slice(0, 16);
    if (`${cur.rows[0].date} ${cur.rows[0].time}` <= now) return sendError(reply, 422, 'APPOINTMENT_STARTED', 'Termin koji je počeo se ne briše — otkažite ga.');
    await pool.query('DELETE FROM appointment WHERE id=$1', [id]);
    return reply.code(204).send();
  });

  // Blokade dana
  app.get('/calendar-blocks', async () => {
    const { rows } = await pool.query<{ id: number; from_date: string; to_date: string; reason: string | null }>(
      `SELECT id, to_char(from_date,'YYYY-MM-DD') from_date, to_char(to_date,'YYYY-MM-DD') to_date, reason FROM calendar_block ORDER BY from_date DESC`);
    return rows.map<CalendarBlock>((r) => ({ id: r.id, fromDate: r.from_date, toDate: r.to_date, reason: r.reason }));
  });
  app.post('/calendar-blocks', async (request, reply) => {
    const b = blockSchema.parse(request.body);
    const { rows } = await pool.query<{ id: number }>(`INSERT INTO calendar_block (from_date, to_date, reason, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
      [b.fromDate, b.toDate, b.reason ?? null, request.currentUser!.id]);
    return reply.code(201).send({ id: rows[0]!.id, fromDate: b.fromDate, toDate: b.toDate, reason: b.reason ?? null });
  });
  app.delete('/calendar-blocks/:id', async (request, reply) => {
    await pool.query('DELETE FROM calendar_block WHERE id=$1', [Number((request.params as { id: string }).id)]);
    return reply.code(204).send();
  });

}
