import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import type {
  WorkOrder,
  WorkOrderDetail,
  LaborItem,
  PartItem,
  ExternalItem,
} from '@karton/shared';
import { pool, tx } from '../db.ts';
import { sendError } from '../http.ts';
import { requireAuth } from '../auth-guards.ts';
import { writeAudit } from '../audit.ts';
import { nextNumber } from '../numbering.ts';
import { todayBelgrade } from '../time.ts';
import { parseListParams, offset, orderBy, normalizeSearch } from '../query.ts';
import { workOrderTransition, isWorkOrderEditable } from '../transitions.ts';
import { chainForWorkOrder } from '../documents-lib.ts';
import { defaultPageSize } from '../settings-cache.ts';

// ---------- validacija ----------
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TIME = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

const fieldVisitSchema = {
  fieldVisit: z.boolean().optional(),
  fieldVisitDate: DATE.nullish(),
  fieldVisitTime: TIME.nullish(),
  fieldVisitLocation: z.string().trim().nullish(),
  fieldVisitKm: z.number().int().nonnegative().nullish(),
  vehicleDrivable: z.boolean().nullish(),
  fieldVisitOutcome: z.enum(['solved_on_site', 'arrives_driving', 'arrives_towed', 'customer_declined']).nullish(),
};

const createSchema = z.object({
  vehicleId: z.number().int().positive(),
  customerId: z.number().int().positive().nullish(),
  receivedOn: DATE.optional(),
  receivedTime: TIME.nullish(),
  odometerKm: z.number().int().nonnegative().nullish(),
  requestedWork: z.string().trim().nullish(),
  note: z.string().trim().nullish(),
  sourceQuoteId: z.number().int().positive().nullish(),
  ...fieldVisitSchema,
});

const updateSchema = z.object({
  receivedOn: DATE.optional(),
  receivedTime: TIME.nullish(),
  completedOn: DATE.nullish(),
  completedTime: TIME.nullish(),
  odometerKm: z.number().int().nonnegative().nullish(),
  requestedWork: z.string().trim().nullish(),
  findings: z.string().trim().nullish(),
  note: z.string().trim().nullish(),
  partsExpectedOn: DATE.nullish(),
  partsNote: z.string().trim().nullish(),
  reason: z.string().trim().nullish(), // uz ručnu ispravku datuma završetka (BR-11)
  version: z.number().int(),
  ...fieldVisitSchema,
});

const statusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'waiting_parts', 'completed', 'cancelled']),
  reason: z.string().trim().nullish(),
  // Kad se prelazi na „Čeka delove", odmah se unosi kad se očekuju + napomena (jedan poziv).
  partsExpectedOn: DATE.nullish(),
  partsNote: z.string().trim().nullish(),
  version: z.number().int(),
});

const laborSchema = z.object({
  mechanicId: z.number().int().positive(),
  name: z.string().trim().min(1),
  billingUnit: z.enum(['hour', 'km', 'flat']),
  quantity: z.number().nonnegative().nullish(),
  unitPrice: z.number().nonnegative().nullish(),
  amount: z.number().nonnegative().optional(),
});
const partSchema = z.object({
  name: z.string().trim().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  internalNoCharge: z.boolean().optional(),
});
const externalSchema = z.object({
  vendorName: z.string().trim().min(1),
  description: z.string().trim().nullish(),
  price: z.number().nonnegative(),
  note: z.string().trim().nullish(),
  internalNoCharge: z.boolean().optional(),
});

// ---------- mapiranje + učitavanje ----------
const WO_SELECT = `
  SELECT wo.id, wo.number, wo.status, wo.customer_id, wo.vehicle_id,
    to_char(wo.received_on,'YYYY-MM-DD') AS received_on, to_char(wo.received_time,'HH24:MI') AS received_time,
    to_char(wo.completed_on,'YYYY-MM-DD') AS completed_on, to_char(wo.completed_time,'HH24:MI') AS completed_time,
    wo.odometer_km, wo.requested_work, wo.findings, wo.note, wo.source_quote_id,
    wo.source_work_order_id, (SELECT o.number FROM work_order o WHERE o.id = wo.source_work_order_id) AS source_work_order_number,
    to_char(wo.parts_expected_on,'YYYY-MM-DD') AS parts_expected_on, wo.parts_note,
    wo.field_visit, to_char(wo.field_visit_date,'YYYY-MM-DD') AS field_visit_date,
    to_char(wo.field_visit_time,'HH24:MI') AS field_visit_time, wo.field_visit_location, wo.field_visit_km,
    wo.vehicle_drivable, wo.field_visit_outcome, wo.version,
    v.vin, v.make, v.model,
    (SELECT rh.plate FROM registration_history rh WHERE rh.vehicle_id = v.id AND rh.valid_to IS NULL LIMIT 1) AS plate,
    c.name AS customer_name, c.type AS customer_type
  FROM work_order wo
  JOIN vehicle v ON v.id = wo.vehicle_id
  JOIN customer c ON c.id = wo.customer_id`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function toWorkOrder(r: any): WorkOrder {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    vehicle: { id: r.vehicle_id, vin: r.vin, make: r.make, model: r.model, plate: r.plate },
    customer: { id: r.customer_id, name: r.customer_name, type: r.customer_type },
    receivedOn: r.received_on,
    receivedTime: r.received_time,
    completedOn: r.completed_on,
    completedTime: r.completed_time,
    odometerKm: r.odometer_km,
    requestedWork: r.requested_work,
    findings: r.findings,
    note: r.note,
    sourceQuoteId: r.source_quote_id,
    sourceWorkOrderId: r.source_work_order_id,
    sourceWorkOrderNumber: r.source_work_order_number,
    partsExpectedOn: r.parts_expected_on,
    partsNote: r.parts_note,
    fieldVisit: r.field_visit,
    fieldVisitDate: r.field_visit_date,
    fieldVisitTime: r.field_visit_time,
    fieldVisitLocation: r.field_visit_location,
    fieldVisitKm: r.field_visit_km,
    vehicleDrivable: r.vehicle_drivable,
    fieldVisitOutcome: r.field_visit_outcome,
    version: r.version,
  };
}

async function loadDetail(id: number, client?: PoolClient): Promise<WorkOrderDetail | null> {
  const exec = client ?? pool;
  const head = await exec.query(`${WO_SELECT} WHERE wo.id = $1`, [id]);
  if (!head.rows[0]) return null;
  const wo = toWorkOrder(head.rows[0]);

  const labor = await exec.query(
    `SELECT li.id, li.mechanic_id, m.full_name, m.specialty, li.name, li.billing_unit, li.quantity, li.unit_price, li.amount
     FROM labor_item li JOIN mechanic m ON m.id = li.mechanic_id WHERE li.work_order_id = $1 ORDER BY li.id`,
    [id],
  );
  const parts = await exec.query(
    `SELECT id, name, quantity, unit_price, amount, internal_no_charge FROM part_item WHERE work_order_id = $1 ORDER BY id`,
    [id],
  );
  const external = await exec.query(
    `SELECT id, vendor_name, description, price, note, internal_no_charge FROM external_service_item WHERE work_order_id = $1 ORDER BY id`,
    [id],
  );

  const laborItems: LaborItem[] = labor.rows.map((r: any) => ({
    id: r.id, mechanicId: r.mechanic_id, mechanicName: r.full_name, specialty: r.specialty,
    name: r.name, billingUnit: r.billing_unit,
    quantity: r.quantity === null ? null : Number(r.quantity),
    unitPrice: r.unit_price === null ? null : Number(r.unit_price),
    amount: Number(r.amount),
  }));
  const partItems: PartItem[] = parts.rows.map((r: any) => ({
    id: r.id, name: r.name, quantity: Number(r.quantity), unitPrice: Number(r.unit_price),
    amount: Number(r.amount), internalNoCharge: r.internal_no_charge,
  }));
  const externalItems: ExternalItem[] = external.rows.map((r: any) => ({
    id: r.id, vendorName: r.vendor_name, description: r.description, price: Number(r.price),
    note: r.note, internalNoCharge: r.internal_no_charge,
  }));

  // Iznosi za klijenta — interne stavke se izuzimaju (BR-09)
  const laborTotal = laborItems.reduce((s, i) => s + i.amount, 0);
  const partsTotal = partItems.filter((i) => !i.internalNoCharge).reduce((s, i) => s + i.amount, 0);
  const externalTotal = externalItems.filter((i) => !i.internalNoCharge).reduce((s, i) => s + i.price, 0);
  const chain = await chainForWorkOrder(exec, id);

  // Nalozi koji su reklamacija OVOG naloga (na starom nalogu se vidi „Reklamiran nalogom …").
  const rek = await exec.query<{ id: number; number: string }>(
    `SELECT id, number FROM work_order WHERE source_work_order_id = $1 ORDER BY id`, [id]);

  return {
    ...wo,
    chain,
    laborItems,
    partItems,
    externalItems,
    totals: {
      labor: laborTotal,
      parts: partsTotal,
      external: externalTotal,
      total: laborTotal + partsTotal + externalTotal,
    },
    reklamacije: rek.rows.map((r) => ({ id: r.id, number: r.number })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Obračun stavke rada (BR-43): hour/km → quantity×unitPrice; flat → samo amount.
function computeLabor(b: z.infer<typeof laborSchema>): { quantity: number | null; unitPrice: number | null; amount: number } | null {
  if (b.billingUnit === 'flat') {
    if (b.quantity != null || b.unitPrice != null || b.amount == null) return null;
    return { quantity: null, unitPrice: null, amount: b.amount };
  }
  if (b.quantity == null || b.unitPrice == null) return null;
  return { quantity: b.quantity, unitPrice: b.unitPrice, amount: Math.round(b.quantity * b.unitPrice * 100) / 100 };
}

async function ensureEditable(id: number, reply: FastifyReply): Promise<boolean> {
  const { rows } = await pool.query<{ status: WorkOrder['status'] }>('SELECT status FROM work_order WHERE id = $1', [id]);
  if (!rows[0]) {
    await sendError(reply, 404, 'NOT_FOUND', 'Nalog ne postoji.');
    return false;
  }
  if (!isWorkOrderEditable(rows[0].status)) {
    await sendError(reply, 422, 'ENTITY_LOCKED', 'Nalog je zaključan (završen ili otkazan) i ne može se menjati.');
    return false;
  }
  return true;
}

const SORTABLE = {
  number: 'wo.number', received: 'wo.received_on', status: 'wo.status', customer: 'c.name',
  plate: `(SELECT rh.plate FROM registration_history rh WHERE rh.vehicle_id = v.id AND rh.valid_to IS NULL LIMIT 1)`,
};

export async function workOrderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // GET /work-orders
  app.get('/work-orders', async (request) => {
    const p = parseListParams(request.query as Record<string, unknown>, await defaultPageSize());
    const query = request.query as Record<string, string | undefined>;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (query['status']) { params.push(query['status']); conds.push(`wo.status = $${params.length}::work_order_status`); }
    // Ekran „Nezavršeni": samo aktivni nalozi (Otvoren/U radu/Čeka delove).
    if (query['active'] === 'true') conds.push(`wo.status IN ('open','in_progress','waiting_parts')`);
    if (query['vehicleId']) { params.push(Number(query['vehicleId'])); conds.push(`wo.vehicle_id = $${params.length}`); }
    if (query['customerId']) { params.push(Number(query['customerId'])); conds.push(`wo.customer_id = $${params.length}`); }
    if (p.q) {
      params.push(normalizeSearch(p.q)); const norm = `$${params.length}`;
      params.push(p.q.toLowerCase()); const low = `$${params.length}`;
      conds.push(`(lower(wo.number) LIKE '%'||${low}||'%'
        OR regexp_replace(lower(c.name),'\\s','','g') LIKE '%'||${norm}||'%'
        OR EXISTS (SELECT 1 FROM registration_history rh WHERE rh.vehicle_id = wo.vehicle_id
                   AND regexp_replace(lower(rh.plate),'\\s','','g') LIKE '%'||${norm}||'%'))`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const order = orderBy(p.sort, SORTABLE, 'wo.received_on DESC, wo.id DESC');
    params.push(p.pageSize); const limit = `$${params.length}`;
    params.push(offset(p)); const off = `$${params.length}`;
    const { rows } = await pool.query(
      `${WO_SELECT.replace('SELECT wo.id', 'SELECT count(*) OVER() AS total_count, wo.id')} ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${off}`,
      params,
    );
    const total = rows[0] ? parseInt(rows[0].total_count, 10) : 0;
    return { data: rows.map(toWorkOrder), meta: { page: p.page, pageSize: p.pageSize, total } };
  });

  // GET /work-orders/:id
  app.get('/work-orders/:id', async (request, reply) => {
    const wo = await loadDetail(Number((request.params as { id: string }).id));
    if (!wo) return sendError(reply, 404, 'NOT_FOUND', 'Nalog ne postoji.');
    return wo;
  });

  // POST /work-orders — transakcioni RN- broj (BR-24); klijent podrazumevano iz vlasnika (BR-06)
  app.post('/work-orders', async (request, reply) => {
    const b = createSchema.parse(request.body);
    const veh = await pool.query<{ status: string }>('SELECT status FROM vehicle WHERE id = $1', [b.vehicleId]);
    if (!veh.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Vozilo ne postoji.');
    if (veh.rows[0].status !== 'active') return sendError(reply, 422, 'ENTITY_ARCHIVED', 'Vozilo je arhivirano.');

    // klijent: prosleđen ili trenutni vlasnik
    let customerId = b.customerId ?? null;
    if (!customerId) {
      const owner = await pool.query<{ customer_id: number }>(
        `SELECT customer_id FROM ownership_history WHERE vehicle_id = $1 AND valid_to IS NULL LIMIT 1`, [b.vehicleId]);
      customerId = owner.rows[0]?.customer_id ?? null;
    }
    if (!customerId) return sendError(reply, 422, 'VALIDATION_FAILED', 'Vozilo nema vlasnika — izaberite klijenta.', { fields: { customerId: 'Obavezno.' } });

    if (b.sourceQuoteId) {
      const q = await pool.query<{ type: string; status: string }>('SELECT type, status FROM document WHERE id = $1', [b.sourceQuoteId]);
      if (!q.rows[0] || q.rows[0].type !== 'quote' || q.rows[0].status !== 'accepted') {
        return sendError(reply, 422, 'QUOTE_NOT_ACCEPTED', 'Nalog se može vezati samo za prihvaćenu ponudu.');
      }
    }

    const fv = b.fieldVisit === true;
    const created = await tx(async (client) => {
      const number = await nextNumber(client, 'work_order');
      const ins = await client.query<{ id: number }>(
        `INSERT INTO work_order
          (number, vehicle_id, customer_id, received_on, received_time, odometer_km, requested_work, note,
           source_quote_id, field_visit, field_visit_date, field_visit_time, field_visit_location,
           field_visit_km, vehicle_drivable, field_visit_outcome, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
        [
          number, b.vehicleId, customerId, b.receivedOn ?? todayBelgrade(), b.receivedTime ?? null,
          b.odometerKm ?? null, b.requestedWork ?? null, b.note ?? null, b.sourceQuoteId ?? null,
          fv, fv ? b.fieldVisitDate ?? null : null, fv ? b.fieldVisitTime ?? null : null,
          fv ? b.fieldVisitLocation ?? null : null, fv ? b.fieldVisitKm ?? null : null,
          fv ? b.vehicleDrivable ?? null : null, fv ? b.fieldVisitOutcome ?? null : null, request.currentUser!.id,
        ],
      );
      return (await loadDetail(ins.rows[0]!.id, client))!;
    });
    return reply.code(201).send(created);
  });

  // POST /work-orders/:id/reklamacija — nov nalog vezan za stari.
  // Mušterija se vratila sa istim problemom: stari nalog je završen i ne dira se,
  // pravi se NOV sa vezom unazad. Vozilo i klijent se preuzimaju sa starog (bez prekucavanja).
  // Otvara se prazan (bez stavki) — garancija; stavke se dodaju samo ako ima dodatnog posla.
  app.post('/work-orders/:id/reklamacija', async (request, reply) => {
    const sourceId = Number((request.params as { id: string }).id);
    const b = z.object({ requestedWork: z.string().trim().nullish() }).parse(request.body ?? {});
    const src = await pool.query<{ vehicle_id: number; customer_id: number; vstatus: string }>(
      `SELECT wo.vehicle_id, wo.customer_id, v.status AS vstatus
       FROM work_order wo JOIN vehicle v ON v.id = wo.vehicle_id WHERE wo.id = $1`, [sourceId]);
    if (!src.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Originalni nalog ne postoji.');
    if (src.rows[0].vstatus !== 'active') return sendError(reply, 422, 'ENTITY_ARCHIVED', 'Vozilo je arhivirano.');

    const created = await tx(async (client) => {
      const number = await nextNumber(client, 'work_order');
      const ins = await client.query<{ id: number }>(
        `INSERT INTO work_order (number, vehicle_id, customer_id, received_on, requested_work, source_work_order_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [number, src.rows[0]!.vehicle_id, src.rows[0]!.customer_id, todayBelgrade(),
          b.requestedWork ?? null, sourceId, request.currentUser!.id]);
      await writeAudit({ userId: request.currentUser!.id, entityType: 'work_order', entityId: ins.rows[0]!.id,
        action: 'work_order.reklamacija_created', newValue: { sourceWorkOrderId: sourceId } }, client);
      return (await loadDetail(ins.rows[0]!.id, client))!;
    });
    return reply.code(201).send(created);
  });

  // PATCH /work-orders/:id — zaglavlje (BR-08 editable, version)
  app.patch('/work-orders/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const b = updateSchema.parse(request.body);
    const cur = await pool.query<{ status: WorkOrder['status']; version: number; completed_on: string | null }>(
      `SELECT status, version, to_char(completed_on,'YYYY-MM-DD') completed_on FROM work_order WHERE id = $1`, [id]);
    if (!cur.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Nalog ne postoji.');
    if (cur.rows[0].version !== b.version) return sendError(reply, 409, 'VERSION_CONFLICT', 'Neko je izmenio nalog u međuvremenu.');
    if (!isWorkOrderEditable(cur.rows[0].status)) return sendError(reply, 422, 'ENTITY_LOCKED', 'Nalog je zaključan.');

    const fv = b.fieldVisit === true;
    const oldCompleted = cur.rows[0].completed_on;
    const newCompleted = b.completedOn ?? null;
    // BR-11: automatski datum završetka sme da se ručno ispravi — obeleži i upiši u audit.
    const completedChanged = oldCompleted !== newCompleted;

    await tx(async (client) => {
      await client.query(
        `UPDATE work_order SET received_on=$1, received_time=$2, completed_on=$3, completed_time=$4,
          odometer_km=$5, requested_work=$6, findings=$7, note=$8,
          field_visit=$9, field_visit_date=$10, field_visit_time=$11, field_visit_location=$12,
          field_visit_km=$13, vehicle_drivable=$14, field_visit_outcome=$15,
          parts_expected_on=$16, parts_note=$17,
          completed_on_manual = completed_on_manual OR $18,
          version = version + 1, updated_at = now() WHERE id = $19`,
        [
          b.receivedOn ?? todayBelgrade(), b.receivedTime ?? null, newCompleted, b.completedTime ?? null,
          b.odometerKm ?? null, b.requestedWork ?? null, b.findings ?? null, b.note ?? null,
          fv, fv ? b.fieldVisitDate ?? null : null, fv ? b.fieldVisitTime ?? null : null,
          fv ? b.fieldVisitLocation ?? null : null, fv ? b.fieldVisitKm ?? null : null,
          fv ? b.vehicleDrivable ?? null : null, fv ? b.fieldVisitOutcome ?? null : null,
          b.partsExpectedOn ?? null, b.partsNote ?? null,
          completedChanged, id,
        ],
      );
      if (completedChanged) {
        await writeAudit({ userId: request.currentUser!.id, entityType: 'work_order', entityId: id,
          action: 'work_order.completed_on_changed', oldValue: { completedOn: oldCompleted },
          newValue: { completedOn: newCompleted }, reason: b.reason ?? null }, client);
      }
    });
    return (await loadDetail(id))!;
  });

  // POST /work-orders/:id/status — tranzicija (§6) + version + audit
  app.post('/work-orders/:id/status', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const b = statusSchema.parse(request.body);
    const cur = await pool.query<{ status: WorkOrder['status']; version: number; completed_on: string | null; manual: boolean }>(
      'SELECT status, version, completed_on, completed_on_manual AS manual FROM work_order WHERE id = $1', [id]);
    if (!cur.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Nalog ne postoji.');
    if (cur.rows[0].version !== b.version) return sendError(reply, 409, 'VERSION_CONFLICT', 'Neko je izmenio nalog u međuvremenu.');

    const right = workOrderTransition(cur.rows[0].status, b.status);
    if (right === false) return sendError(reply, 422, 'TRANSITION_NOT_ALLOWED', `Prelaz ${cur.rows[0].status} → ${b.status} nije dozvoljen.`);
    if (right === 'admin') {
      if (request.currentUser!.role !== 'admin') return sendError(reply, 403, 'FORBIDDEN', 'Ovu izmenu može samo administrator.');
      if (!b.reason) return sendError(reply, 422, 'REASON_REQUIRED', 'Razlog je obavezan za ovu korekciju.');
    }

    await tx(async (client) => {
      const setCompleted = b.status === 'completed' && !cur.rows[0]!.completed_on;
      const clearCompleted = right === 'admin' && (cur.rows[0]!.status === 'completed');
      // Rok za delove ima smisla samo dok nalog čeka delove — izlaskom se briše.
      const waitingParts = b.status === 'waiting_parts';
      await client.query(
        `UPDATE work_order SET status=$1, version=version+1, updated_at=now(),
          completed_on = CASE WHEN $2 THEN $3::date WHEN $4 THEN NULL ELSE completed_on END,
          parts_expected_on = CASE WHEN $5 THEN $6::date ELSE NULL END,
          parts_note        = CASE WHEN $5 THEN $7        ELSE NULL END
         WHERE id=$8`,
        [b.status, setCompleted, todayBelgrade(), clearCompleted,
          waitingParts, waitingParts ? b.partsExpectedOn ?? null : null, waitingParts ? b.partsNote ?? null : null, id],
      );
      if (right === 'admin') {
        const action = cur.rows[0]!.status === 'completed' ? 'work_order.reopened' : 'work_order.status_corrected';
        await writeAudit({ userId: request.currentUser!.id, entityType: 'work_order', entityId: id, action,
          oldValue: { status: cur.rows[0]!.status }, newValue: { status: b.status }, reason: b.reason }, client);
      }
    });
    return (await loadDetail(id))!;
  });

  // POST /work-orders/:id/link-quote — samo prihvaćena ponuda (BR-11); jedna ponuda može hraniti više naloga (1:N)
  app.post('/work-orders/:id/link-quote', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const b = z.object({ quoteId: z.number().int().positive(), version: z.number().int() }).parse(request.body);
    const cur = await pool.query<{ status: WorkOrder['status']; version: number }>('SELECT status, version FROM work_order WHERE id=$1', [id]);
    if (!cur.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Nalog ne postoji.');
    if (cur.rows[0].version !== b.version) return sendError(reply, 409, 'VERSION_CONFLICT', 'Neko je izmenio nalog u međuvremenu.');
    if (!isWorkOrderEditable(cur.rows[0].status)) return sendError(reply, 422, 'ENTITY_LOCKED', 'Nalog je zaključan.');

    const q = await pool.query<{ type: string; status: string; vehicle_id: number }>(
      'SELECT type, status, vehicle_id FROM document WHERE id=$1', [b.quoteId]);
    if (!q.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Ponuda ne postoji.');
    if (q.rows[0].type !== 'quote' || q.rows[0].status !== 'accepted') {
      return sendError(reply, 422, 'QUOTE_NOT_ACCEPTED', 'Nalog se može vezati samo za prihvaćenu ponudu.');
    }
    const wov = await pool.query<{ vehicle_id: number }>('SELECT vehicle_id FROM work_order WHERE id=$1', [id]);
    if (wov.rows[0]!.vehicle_id !== q.rows[0].vehicle_id) {
      return sendError(reply, 422, 'VALIDATION_FAILED', 'Ponuda je za drugo vozilo.');
    }
    await pool.query('UPDATE work_order SET source_quote_id=$1, version=version+1, updated_at=now() WHERE id=$2', [b.quoteId, id]);
    return (await loadDetail(id))!;
  });

  // POST /work-orders/:id/unlink-quote — ne dira druge naloge iste ponude
  app.post('/work-orders/:id/unlink-quote', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const b = z.object({ version: z.number().int() }).parse(request.body);
    const cur = await pool.query<{ status: WorkOrder['status']; version: number }>('SELECT status, version FROM work_order WHERE id=$1', [id]);
    if (!cur.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Nalog ne postoji.');
    if (cur.rows[0].version !== b.version) return sendError(reply, 409, 'VERSION_CONFLICT', 'Neko je izmenio nalog u međuvremenu.');
    if (!isWorkOrderEditable(cur.rows[0].status)) return sendError(reply, 422, 'ENTITY_LOCKED', 'Nalog je zaključan.');
    await pool.query('UPDATE work_order SET source_quote_id=NULL, version=version+1, updated_at=now() WHERE id=$1', [id]);
    return (await loadDetail(id))!;
  });

  // ---------- Stavke rada ----------
  app.post('/work-orders/:id/labor-items', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!(await ensureEditable(id, reply))) return;
    const b = laborSchema.parse(request.body);
    const computed = computeLabor(b);
    if (!computed) return sendError(reply, 422, 'LABOR_BILLING_INVALID', 'Neispravan obračun: sat/km traže količinu i cenu; paušal samo iznos.');
    await pool.query(
      `INSERT INTO labor_item (work_order_id, mechanic_id, name, billing_unit, quantity, unit_price, amount, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, b.mechanicId, b.name, b.billingUnit, computed.quantity, computed.unitPrice, computed.amount, request.currentUser!.id]);
    return reply.code(201).send(await loadDetail(id));
  });
  app.patch('/work-orders/:id/labor-items/:iid', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!(await ensureEditable(id, reply))) return;
    const iid = Number((request.params as { iid: string }).iid);
    const b = laborSchema.parse(request.body);
    const computed = computeLabor(b);
    if (!computed) return sendError(reply, 422, 'LABOR_BILLING_INVALID', 'Neispravan obračun.');
    await pool.query(
      `UPDATE labor_item SET mechanic_id=$1, name=$2, billing_unit=$3, quantity=$4, unit_price=$5, amount=$6, updated_at=now()
       WHERE id=$7 AND work_order_id=$8`,
      [b.mechanicId, b.name, b.billingUnit, computed.quantity, computed.unitPrice, computed.amount, iid, id]);
    return loadDetail(id);
  });
  app.delete('/work-orders/:id/labor-items/:iid', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!(await ensureEditable(id, reply))) return;
    await pool.query('DELETE FROM labor_item WHERE id=$1 AND work_order_id=$2', [Number((request.params as { iid: string }).iid), id]);
    return loadDetail(id);
  });

  // ---------- Delovi ----------
  app.post('/work-orders/:id/part-items', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!(await ensureEditable(id, reply))) return;
    const b = partSchema.parse(request.body);
    const amount = Math.round(b.quantity * b.unitPrice * 100) / 100;
    await pool.query(
      `INSERT INTO part_item (work_order_id, name, quantity, unit_price, amount, internal_no_charge, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, b.name, b.quantity, b.unitPrice, amount, b.internalNoCharge ?? false, request.currentUser!.id]);
    return reply.code(201).send(await loadDetail(id));
  });
  app.patch('/work-orders/:id/part-items/:iid', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!(await ensureEditable(id, reply))) return;
    const iid = Number((request.params as { iid: string }).iid);
    const b = partSchema.parse(request.body);
    const amount = Math.round(b.quantity * b.unitPrice * 100) / 100;
    await pool.query(
      `UPDATE part_item SET name=$1, quantity=$2, unit_price=$3, amount=$4, internal_no_charge=$5, updated_at=now()
       WHERE id=$6 AND work_order_id=$7`,
      [b.name, b.quantity, b.unitPrice, amount, b.internalNoCharge ?? false, iid, id]);
    return loadDetail(id);
  });
  app.delete('/work-orders/:id/part-items/:iid', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!(await ensureEditable(id, reply))) return;
    await pool.query('DELETE FROM part_item WHERE id=$1 AND work_order_id=$2', [Number((request.params as { iid: string }).iid), id]);
    return loadDetail(id);
  });

  // ---------- Eksterni servis ----------
  app.post('/work-orders/:id/external-items', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!(await ensureEditable(id, reply))) return;
    const b = externalSchema.parse(request.body);
    await pool.query(
      `INSERT INTO external_service_item (work_order_id, vendor_name, description, price, note, internal_no_charge, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, b.vendorName, b.description ?? null, b.price, b.note ?? null, b.internalNoCharge ?? false, request.currentUser!.id]);
    return reply.code(201).send(await loadDetail(id));
  });
  app.patch('/work-orders/:id/external-items/:iid', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!(await ensureEditable(id, reply))) return;
    const iid = Number((request.params as { iid: string }).iid);
    const b = externalSchema.parse(request.body);
    await pool.query(
      `UPDATE external_service_item SET vendor_name=$1, description=$2, price=$3, note=$4, internal_no_charge=$5, updated_at=now()
       WHERE id=$6 AND work_order_id=$7`,
      [b.vendorName, b.description ?? null, b.price, b.note ?? null, b.internalNoCharge ?? false, iid, id]);
    return loadDetail(id);
  });
  app.delete('/work-orders/:id/external-items/:iid', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!(await ensureEditable(id, reply))) return;
    await pool.query('DELETE FROM external_service_item WHERE id=$1 AND work_order_id=$2', [Number((request.params as { iid: string }).iid), id]);
    return loadDetail(id);
  });
}
