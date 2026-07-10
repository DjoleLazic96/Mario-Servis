import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { pool, tx } from '../db.ts';
import { sendError } from '../http.ts';
import { requireAuth } from '../auth-guards.ts';
import { writeAudit } from '../audit.ts';
import { nextNumber } from '../numbering.ts';
import { todayBelgrade } from '../time.ts';
import { parseListParams, offset, orderBy, normalizeSearch } from '../query.ts';
import { defaultPageSize } from '../settings-cache.ts';
import {
  buildSnapshot, insertItems, copyItems, loadDocument, defaultValidUntil,
  type SnapshotItem,
} from '../documents-lib.ts';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const itemDraft = z.object({
  itemType: z.enum(['labor', 'part', 'external']),
  name: z.string().trim().min(1),
  quantity: z.number().nullish(),
  unitPrice: z.number().nullish(),
  amount: z.number(),
  laborGroup: z.enum(['mechanical', 'electrical', 'other']).nullish(),
});
const createQuoteSchema = z.object({
  type: z.literal('quote'),
  customerId: z.number().int().positive(),
  vehicleId: z.number().int().positive(),
  workOrderId: z.number().int().positive().nullish(),
  validUntil: DATE.optional(),
  amountEur: z.number().nullish(),
  note: z.string().trim().nullish(),
  items: z.array(itemDraft).default([]),
});
const createProformaSchema = z.object({
  type: z.literal('proforma'),
  workOrderId: z.number().int().positive(),
  validUntil: DATE.optional(),
  amountEur: z.number().nullish(),
  note: z.string().trim().nullish(),
});
const createSchema = z.discriminatedUnion('type', [createQuoteSchema, createProformaSchema]);

async function activeInvoiceExists(workOrderId: number): Promise<boolean> {
  const r = await pool.query(`SELECT 1 FROM document WHERE type='invoice' AND work_order_id=$1 AND status IN ('unpaid','paid')`, [workOrderId]);
  return (r.rowCount ?? 0) > 0;
}
async function activeProformaExists(workOrderId: number): Promise<boolean> {
  const r = await pool.query(`SELECT 1 FROM document WHERE type='proforma' AND work_order_id=$1 AND status='valid'`, [workOrderId]);
  return (r.rowCount ?? 0) > 0;
}

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // GET /documents
  app.get('/documents', async (request) => {
    const p = parseListParams(request.query as Record<string, unknown>, await defaultPageSize());
    const q = request.query as Record<string, string | undefined>;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (q['type']) { params.push(q['type']); conds.push(`d.type = $${params.length}::document_type`); }
    if (q['status']) { params.push(q['status']); conds.push(`d.status = $${params.length}::document_status`); }
    if (q['workOrderId']) { params.push(Number(q['workOrderId'])); conds.push(`d.work_order_id = $${params.length}`); }
    if (q['customerId']) { params.push(Number(q['customerId'])); conds.push(`d.customer_id = $${params.length}`); }
    if (q['vehicleId']) { params.push(Number(q['vehicleId'])); conds.push(`d.vehicle_id = $${params.length}`); }
    if (q['unpaid'] === 'true') conds.push(`d.type='invoice' AND d.status='unpaid'`);
    if (p.q) {
      params.push(normalizeSearch(p.q)); const norm = `$${params.length}`;
      params.push(p.q.toLowerCase()); const low = `$${params.length}`;
      conds.push(`(lower(d.number) LIKE '%'||${low}||'%' OR regexp_replace(lower(c.name),'\\s','','g') LIKE '%'||${norm}||'%')`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const order = orderBy(p.sort, {
      number: 'd.number', issued: 'd.issued_on', type: 'd.type', status: 'd.status',
      customer: 'c.name', total: 'total_amount',
    }, 'd.issued_on DESC, d.id DESC');
    params.push(p.pageSize); const limit = `$${params.length}`;
    params.push(offset(p)); const off = `$${params.length}`;
    const { rows } = await pool.query(
      `SELECT count(*) OVER() total_count, d.id,
        (SELECT coalesce(sum(amount),0) FROM document_item di WHERE di.document_id=d.id) total_amount,
        d.number, d.type, d.status, d.work_order_id, d.customer_id, d.vehicle_id,
        to_char(d.issued_on,'YYYY-MM-DD') issued_on, to_char(d.due_on,'YYYY-MM-DD') due_on,
        to_char(d.valid_until,'YYYY-MM-DD') valid_until, to_char(d.paid_on,'YYYY-MM-DD') paid_on,
        d.payment_method, d.source_document_id, d.source_relation_type, d.note, d.amount_eur, d.version,
        c.name customer_name, c.type customer_type, v.vin, v.make, v.model,
        (SELECT rh.plate FROM registration_history rh WHERE rh.vehicle_id=v.id AND rh.valid_to IS NULL LIMIT 1) plate
       FROM document d JOIN customer c ON c.id=d.customer_id JOIN vehicle v ON v.id=d.vehicle_id
       ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${off}`,
      params,
    );
    const total = rows[0] ? parseInt(rows[0].total_count, 10) : 0;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const data = rows.map((r: any) => ({
      id: r.id, number: r.number, type: r.type, status: r.status, workOrderId: r.work_order_id,
      customer: { id: r.customer_id, name: r.customer_name, type: r.customer_type },
      vehicle: { id: r.vehicle_id, vin: r.vin, make: r.make, model: r.model, plate: r.plate },
      issuedOn: r.issued_on, dueOn: r.due_on, validUntil: r.valid_until, paidOn: r.paid_on,
      paymentMethod: r.payment_method, sourceDocumentId: r.source_document_id, sourceRelationType: r.source_relation_type,
      note: r.note, amountEur: r.amount_eur === null ? null : Number(r.amount_eur), totalAmount: Number(r.total_amount), version: r.version,
    }));
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { data, meta: { page: p.page, pageSize: p.pageSize, total } };
  });

  // GET /documents/:id
  app.get('/documents/:id', async (request, reply) => {
    const doc = await loadDocument(Number((request.params as { id: string }).id));
    if (!doc) return sendError(reply, 404, 'NOT_FOUND', 'Dokument ne postoji.');
    return doc;
  });

  // POST /documents — ponuda ili predračun (račun se ne kreira direktno)
  app.post('/documents', async (request, reply) => {
    // Bez ove provere Zod bi `type: 'invoice'` odbio kao VALIDATION_FAILED, pa dokumentovana
    // šifra iz spec §8 nikad ne bi stigla do klijenta (BR-17: račun nastaje samo konverzijom).
    if ((request.body as { type?: unknown } | undefined)?.type === 'invoice') {
      return sendError(reply, 422, 'INVOICE_DIRECT_CREATE_FORBIDDEN', 'Račun nastaje isključivo pretvaranjem predračuna.');
    }
    const body = createSchema.parse(request.body);

    if (body.type === 'quote') {
      const cust = await pool.query('SELECT 1 FROM customer WHERE id=$1', [body.customerId]);
      if (cust.rowCount === 0) return sendError(reply, 404, 'NOT_FOUND', 'Klijent ne postoji.');
      const veh = await pool.query('SELECT 1 FROM vehicle WHERE id=$1', [body.vehicleId]);
      if (veh.rowCount === 0) return sendError(reply, 404, 'NOT_FOUND', 'Vozilo ne postoji.');
      const created = await tx(async (client) => {
        const number = await nextNumber(client, 'quote');
        const validUntil = await defaultValidUntil(client, body.validUntil);
        const ins = await client.query<{ id: number }>(
          `INSERT INTO document (number, type, work_order_id, customer_id, vehicle_id, issued_on, valid_until, status, amount_eur, note, created_by)
           VALUES ($1,'quote',$2,$3,$4,$5,$6,'pending',$7,$8,$9) RETURNING id`,
          [number, body.workOrderId ?? null, body.customerId, body.vehicleId, todayBelgrade(), validUntil, body.amountEur ?? null, body.note ?? null, request.currentUser!.id]);
        const id = ins.rows[0]!.id;
        const items: SnapshotItem[] = body.items.map((it) => ({
          itemType: it.itemType, name: it.name, quantity: it.quantity ?? null, unitPrice: it.unitPrice ?? null,
          amount: it.amount, laborGroup: it.laborGroup ?? null, billingUnit: null,
        }));
        await insertItems(client, id, items);
        return (await loadDocument(id, client))!;
      });
      return reply.code(201).send(created);
    }

    // proforma — iz naloga
    const wo = await pool.query<{ status: string; customer_id: number; vehicle_id: number }>(
      'SELECT status, customer_id, vehicle_id FROM work_order WHERE id=$1', [body.workOrderId]);
    if (!wo.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Nalog ne postoji.');
    if (wo.rows[0].status === 'cancelled') return sendError(reply, 422, 'WORK_ORDER_CANCELLED', 'Predračun se ne izdaje iz otkazanog naloga.');
    if (await activeProformaExists(body.workOrderId)) return sendError(reply, 422, 'ACTIVE_PROFORMA_EXISTS', 'Nalog već ima važeći predračun.');
    if (await activeInvoiceExists(body.workOrderId)) return sendError(reply, 422, 'ACTIVE_INVOICE_EXISTS', 'Nalog već ima račun — novi predračun nije moguć.');

    const created = await tx(async (client) => {
      const number = await nextNumber(client, 'proforma');
      const validUntil = await defaultValidUntil(client, body.validUntil);
      const snapshot = await buildSnapshot(client, body.workOrderId);
      const ins = await client.query<{ id: number }>(
        `INSERT INTO document (number, type, work_order_id, customer_id, vehicle_id, issued_on, valid_until, status, amount_eur, note, created_by)
         VALUES ($1,'proforma',$2,$3,$4,$5,$6,'valid',$7,$8,$9) RETURNING id`,
        [number, body.workOrderId, wo.rows[0]!.customer_id, wo.rows[0]!.vehicle_id, todayBelgrade(), validUntil, body.amountEur ?? null, body.note ?? null, request.currentUser!.id]);
      const id = ins.rows[0]!.id;
      await insertItems(client, id, snapshot);
      return (await loadDocument(id, client))!;
    });
    return reply.code(201).send(created);
  });

  // PATCH /documents/:id — quote(pending): rok/EUR/napomena/stavke; proforma(valid): samo rok/EUR/napomena (BR-16)
  app.patch('/documents/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const cur = await pool.query<{ type: string; status: string; version: number }>('SELECT type, status, version FROM document WHERE id=$1', [id]);
    if (!cur.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Dokument ne postoji.');
    const { type, status } = cur.rows[0];

    if (type === 'quote') {
      if (status !== 'pending') return sendError(reply, 422, 'QUOTE_NOT_PENDING', 'Ponuda se menja samo dok je na čekanju.');
      const b = createQuoteSchema.partial({ type: true, customerId: true, vehicleId: true }).extend({ version: z.number().int() }).parse(request.body);
      if (b.version !== cur.rows[0].version) return sendError(reply, 409, 'VERSION_CONFLICT', 'Ponuda je izmenjena u međuvremenu.');
      await tx(async (client) => {
        await client.query(`UPDATE document SET valid_until=coalesce($1,valid_until), amount_eur=$2, note=$3, version=version+1, updated_at=now() WHERE id=$4`,
          [b.validUntil ?? null, b.amountEur ?? null, b.note ?? null, id]);
        if (b.items) {
          await client.query('DELETE FROM document_item WHERE document_id=$1', [id]);
          await insertItems(client, id, b.items.map((it) => ({ itemType: it.itemType, name: it.name, quantity: it.quantity ?? null, unitPrice: it.unitPrice ?? null, amount: it.amount, laborGroup: it.laborGroup ?? null, billingUnit: null })));
        }
      });
      return loadDocument(id);
    }
    if (type === 'proforma') {
      if (status !== 'valid') return sendError(reply, 422, 'SNAPSHOT_IMMUTABLE', 'Predračun nije u statusu koji dozvoljava izmenu.');
      const b = z.object({ validUntil: DATE.optional(), amountEur: z.number().nullish(), note: z.string().trim().nullish(), version: z.number().int() }).parse(request.body);
      if (b.version !== cur.rows[0].version) return sendError(reply, 409, 'VERSION_CONFLICT', 'Predračun je izmenjen u međuvremenu.');
      await pool.query(`UPDATE document SET valid_until=coalesce($1,valid_until), amount_eur=$2, note=$3, version=version+1, updated_at=now() WHERE id=$4`,
        [b.validUntil ?? null, b.amountEur ?? null, b.note ?? null, id]);
      return loadDocument(id);
    }
    return sendError(reply, 422, 'SNAPSHOT_IMMUTABLE', 'Račun se ne menja direktno.');
  });

  // POST /documents/:id/accept  (ponuda pending → accepted)
  app.post('/documents/:id/accept', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const b = z.object({ version: z.number().int() }).parse(request.body);
    const cur = await pool.query<{ type: string; status: string; version: number }>('SELECT type, status, version FROM document WHERE id=$1', [id]);
    if (!cur.rows[0] || cur.rows[0].type !== 'quote') return sendError(reply, 404, 'NOT_FOUND', 'Ponuda ne postoji.');
    if (cur.rows[0].version !== b.version) return sendError(reply, 409, 'VERSION_CONFLICT', 'Ponuda je izmenjena u međuvremenu.');
    if (cur.rows[0].status === 'expired') return sendError(reply, 422, 'QUOTE_EXPIRED', 'Istekla ponuda ne može biti prihvaćena — napravite kopiju.');
    if (cur.rows[0].status !== 'pending') return sendError(reply, 422, 'QUOTE_NOT_PENDING', 'Samo ponuda na čekanju može biti prihvaćena.');
    await pool.query(`UPDATE document SET status='accepted', version=version+1, updated_at=now() WHERE id=$1`, [id]);
    return loadDocument(id);
  });

  // POST /documents/:id/reject
  app.post('/documents/:id/reject', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const b = z.object({ version: z.number().int() }).parse(request.body);
    const cur = await pool.query<{ type: string; status: string; version: number }>('SELECT type, status, version FROM document WHERE id=$1', [id]);
    if (!cur.rows[0] || cur.rows[0].type !== 'quote') return sendError(reply, 404, 'NOT_FOUND', 'Ponuda ne postoji.');
    if (cur.rows[0].version !== b.version) return sendError(reply, 409, 'VERSION_CONFLICT', 'Ponuda je izmenjena u međuvremenu.');
    if (cur.rows[0].status !== 'pending') return sendError(reply, 422, 'QUOTE_NOT_PENDING', 'Samo ponuda na čekanju može biti odbijena.');
    await pool.query(`UPDATE document SET status='rejected', version=version+1, updated_at=now() WHERE id=$1`, [id]);
    return loadDocument(id);
  });

  // POST /documents/:id/convert  (predračun valid → račun) — BR-19
  app.post('/documents/:id/convert', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const b = z.object({ dueOn: DATE, version: z.number().int() }).parse(request.body);
    const cur = await pool.query<{ type: string; status: string; version: number; work_order_id: number | null; customer_id: number; vehicle_id: number }>(
      'SELECT type, status, version, work_order_id, customer_id, vehicle_id FROM document WHERE id=$1', [id]);
    if (!cur.rows[0] || cur.rows[0].type !== 'proforma') return sendError(reply, 404, 'NOT_FOUND', 'Predračun ne postoji.');
    if (cur.rows[0].version !== b.version) return sendError(reply, 409, 'VERSION_CONFLICT', 'Predračun je izmenjen u međuvremenu.');
    if (cur.rows[0].status !== 'valid') return sendError(reply, 422, 'PROFORMA_NOT_VALID', 'Samo važeći predračun može u račun.');
    const src = cur.rows[0];
    const invoice = await tx(async (client) => {
      await client.query(`UPDATE document SET status='used', version=version+1, updated_at=now() WHERE id=$1`, [id]);
      const number = await nextNumber(client, 'invoice');
      const ins = await client.query<{ id: number }>(
        `INSERT INTO document (number, type, work_order_id, customer_id, vehicle_id, issued_on, due_on, status, source_document_id, source_relation_type, created_by)
         VALUES ($1,'invoice',$2,$3,$4,$5,$6,'unpaid',$7,'converted_from',$8) RETURNING id`,
        [number, src.work_order_id, src.customer_id, src.vehicle_id, todayBelgrade(), b.dueOn, id, request.currentUser!.id]);
      const newId = ins.rows[0]!.id;
      await copyItems(client, id, newId);
      await writeAudit({ userId: request.currentUser!.id, entityType: 'document', entityId: newId, action: 'document.converted', newValue: { from: id } }, client);
      return (await loadDocument(newId, client))!;
    });
    return reply.code(201).send(invoice);
  });

  // POST /documents/:id/mark-paid
  app.post('/documents/:id/mark-paid', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const b = z.object({ paidOn: DATE, paymentMethod: z.string().trim().min(1), version: z.number().int() }).parse(request.body);
    const cur = await pool.query<{ type: string; status: string; version: number }>('SELECT type, status, version FROM document WHERE id=$1', [id]);
    if (!cur.rows[0] || cur.rows[0].type !== 'invoice') return sendError(reply, 404, 'NOT_FOUND', 'Račun ne postoji.');
    if (cur.rows[0].version !== b.version) return sendError(reply, 409, 'VERSION_CONFLICT', 'Račun je izmenjen u međuvremenu.');
    if (cur.rows[0].status !== 'unpaid') return sendError(reply, 422, 'INVOICE_NOT_UNPAID', 'Samo neplaćen račun se može naznačiti plaćenim.');
    await pool.query(`UPDATE document SET status='paid', paid_on=$1, payment_method=$2, version=version+1, updated_at=now() WHERE id=$3`, [b.paidOn, b.paymentMethod, id]);
    return loadDocument(id);
  });

  // POST /documents/:id/unmark-paid  (ADMIN, razlog) — BR-21
  app.post('/documents/:id/unmark-paid', async (request, reply) => {
    if (request.currentUser!.role !== 'admin') return sendError(reply, 403, 'FORBIDDEN', 'Samo administrator može vratiti plaćen račun.');
    const id = Number((request.params as { id: string }).id);
    const b = z.object({ reason: z.string().trim().min(1), version: z.number().int() }).parse(request.body);
    const cur = await pool.query<{ type: string; status: string; version: number }>('SELECT type, status, version FROM document WHERE id=$1', [id]);
    if (!cur.rows[0] || cur.rows[0].type !== 'invoice') return sendError(reply, 404, 'NOT_FOUND', 'Račun ne postoji.');
    if (cur.rows[0].version !== b.version) return sendError(reply, 409, 'VERSION_CONFLICT', 'Račun je izmenjen u međuvremenu.');
    if (cur.rows[0].status !== 'paid') return sendError(reply, 422, 'INVOICE_NOT_UNPAID', 'Samo plaćen račun se može vratiti na neplaćeno.');
    await tx(async (client) => {
      await client.query(`UPDATE document SET status='unpaid', paid_on=NULL, payment_method=NULL, version=version+1, updated_at=now() WHERE id=$1`, [id]);
      await writeAudit({ userId: request.currentUser!.id, entityType: 'document', entityId: id, action: 'invoice.unmarked_paid', oldValue: { status: 'paid' }, newValue: { status: 'unpaid' }, reason: b.reason }, client);
    });
    return loadDocument(id);
  });

  // POST /documents/:id/correct  (račun unpaid → voided + novi predračun) — BR-20
  app.post('/documents/:id/correct', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const b = z.object({ note: z.string().trim().nullish(), version: z.number().int() }).parse(request.body);
    const cur = await pool.query<{ type: string; status: string; version: number; work_order_id: number | null; customer_id: number; vehicle_id: number }>(
      'SELECT type, status, version, work_order_id, customer_id, vehicle_id FROM document WHERE id=$1', [id]);
    if (!cur.rows[0] || cur.rows[0].type !== 'invoice') return sendError(reply, 404, 'NOT_FOUND', 'Račun ne postoji.');
    if (cur.rows[0].version !== b.version) return sendError(reply, 409, 'VERSION_CONFLICT', 'Račun je izmenjen u međuvremenu.');
    if (cur.rows[0].status !== 'unpaid') return sendError(reply, 422, 'INVOICE_NOT_UNPAID', 'Ispravlja se samo neplaćen račun.');
    const src = cur.rows[0];
    const proforma = await tx(async (client) => {
      await client.query(`UPDATE document SET status='voided', version=version+1, updated_at=now() WHERE id=$1`, [id]);
      const number = await nextNumber(client, 'proforma');
      const validUntil = await defaultValidUntil(client);
      const ins = await client.query<{ id: number }>(
        `INSERT INTO document (number, type, work_order_id, customer_id, vehicle_id, issued_on, valid_until, status, source_document_id, source_relation_type, note, created_by)
         VALUES ($1,'proforma',$2,$3,$4,$5,$6,'valid',$7,'correction_of',$8,$9) RETURNING id`,
        [number, src.work_order_id, src.customer_id, src.vehicle_id, todayBelgrade(), validUntil, id, b.note ?? null, request.currentUser!.id]);
      const newId = ins.rows[0]!.id;
      await copyItems(client, id, newId);
      await writeAudit({ userId: request.currentUser!.id, entityType: 'document', entityId: id, action: 'invoice.voided', newValue: { correctionProforma: newId } }, client);
      return (await loadDocument(newId, client))!;
    });
    return reply.code(201).send(proforma);
  });

  // POST /documents/:id/payment — ADMIN: ispravka datuma/načina plaćanja na plaćenom računu (razlog obavezan)
  app.post('/documents/:id/payment', async (request, reply) => {
    if (request.currentUser!.role !== 'admin') return sendError(reply, 403, 'FORBIDDEN', 'Ovu izmenu može samo administrator.');
    const id = Number((request.params as { id: string }).id);
    const b = z.object({ paidOn: DATE, paymentMethod: z.string().trim().min(1), reason: z.string().trim().min(1), version: z.number().int() }).parse(request.body);
    const cur = await pool.query<{ type: string; status: string; version: number; paid_on: string | null; payment_method: string | null }>(
      `SELECT type, status, version, to_char(paid_on,'YYYY-MM-DD') paid_on, payment_method FROM document WHERE id=$1`, [id]);
    if (!cur.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Dokument ne postoji.');
    if (cur.rows[0].version !== b.version) return sendError(reply, 409, 'VERSION_CONFLICT', 'Neko je izmenio dokument u međuvremenu.');
    if (cur.rows[0].type !== 'invoice' || cur.rows[0].status !== 'paid') return sendError(reply, 422, 'INVOICE_NOT_PAID', 'Ispravka je moguća samo na plaćenom računu.');
    await tx(async (client) => {
      await client.query(`UPDATE document SET paid_on=$1, payment_method=$2, version=version+1, updated_at=now() WHERE id=$3`, [b.paidOn, b.paymentMethod, id]);
      await writeAudit({ userId: request.currentUser!.id, entityType: 'document', entityId: id, action: 'invoice.payment_changed',
        oldValue: { paidOn: cur.rows[0]!.paid_on, paymentMethod: cur.rows[0]!.payment_method },
        newValue: { paidOn: b.paidOn, paymentMethod: b.paymentMethod }, reason: b.reason }, client);
    });
    return (await loadDocument(id))!;
  });

  // POST /documents/:id/copy  (samo ponuda i predračun) — BR-23/39/40
  app.post('/documents/:id/copy', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const cur = await pool.query<{ type: string; work_order_id: number | null; customer_id: number; vehicle_id: number }>(
      'SELECT type, work_order_id, customer_id, vehicle_id FROM document WHERE id=$1', [id]);
    if (!cur.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Dokument ne postoji.');
    const src = cur.rows[0];
    if (src.type === 'invoice') return sendError(reply, 422, 'COPY_NOT_ALLOWED', 'Račun se ne kopira — koristi se „Ispravi račun".');
    if (src.type === 'proforma' && src.work_order_id) {
      if (await activeProformaExists(src.work_order_id)) return sendError(reply, 422, 'ACTIVE_PROFORMA_EXISTS', 'Nalog već ima važeći predračun.');
      if (await activeInvoiceExists(src.work_order_id)) return sendError(reply, 422, 'ACTIVE_INVOICE_EXISTS', 'Nalog već ima račun — kopija predračuna nije moguća.');
    }
    const copy = await tx(async (client) => {
      const kind = src.type === 'quote' ? 'quote' : 'proforma';
      const number = await nextNumber(client, kind);
      const validUntil = await defaultValidUntil(client);
      const status = src.type === 'quote' ? 'pending' : 'valid';
      const ins = await client.query<{ id: number }>(
        `INSERT INTO document (number, type, work_order_id, customer_id, vehicle_id, issued_on, valid_until, status, source_document_id, source_relation_type, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'copied_from',$10) RETURNING id`,
        [number, src.type, src.work_order_id, src.customer_id, src.vehicle_id, todayBelgrade(), validUntil, status, id, request.currentUser!.id]);
      const newId = ins.rows[0]!.id;
      await copyItems(client, id, newId);
      await writeAudit({ userId: request.currentUser!.id, entityType: 'document', entityId: newId,
        action: 'document.copied', oldValue: { sourceId: id }, newValue: { id: newId, number } }, client);
      return (await loadDocument(newId, client))!;
    });
    return reply.code(201).send(copy);
  });
}
