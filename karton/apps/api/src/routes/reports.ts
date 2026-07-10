import type { FastifyInstance, FastifyReply } from 'fastify';
import ExcelJS from 'exceljs';
import { pool } from '../db.ts';
import { requireAuth } from '../auth-guards.ts';
import { normalizeSearch } from '../query.ts';

/** Isti izveštaj, drugi omot: `?format=xlsx` vraća radni list umesto JSON-a (spec §4.18). */
interface Col { header: string; key: string; width?: number }
async function sendXlsx(reply: FastifyReply, filename: string, sheet: string, columns: Col[], rows: Record<string, unknown>[]): Promise<FastifyReply> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return reply
    .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(Buffer.from(buf));
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // a) Prihod — samo plaćeni računi po datumu plaćanja (BR-31)
  app.get('/reports/revenue', async (request, reply: FastifyReply) => {
    const q = request.query as Record<string, string | undefined>;
    const conds = [`d.type='invoice'`, `d.status='paid'`];
    const params: unknown[] = [];
    if (q['from']) { params.push(q['from']); conds.push(`d.paid_on >= $${params.length}`); }
    if (q['to']) { params.push(q['to']); conds.push(`d.paid_on <= $${params.length}`); }
    const where = `WHERE ${conds.join(' AND ')}`;
    const byMonth = await pool.query<{ month: string; total: string; cnt: string }>(
      `SELECT to_char(d.paid_on,'YYYY-MM') AS month, coalesce(sum(di.amount),0) AS total, count(DISTINCT d.id) AS cnt
       FROM document d JOIN document_item di ON di.document_id=d.id ${where} GROUP BY 1 ORDER BY 1`, params);
    const total = byMonth.rows.reduce((s, r) => s + Number(r.total), 0);
    const count = byMonth.rows.reduce((s, r) => s + Number(r.cnt), 0);
    const rows = byMonth.rows.map((r) => ({ month: r.month, total: Number(r.total), count: Number(r.cnt) }));
    if (q['format'] === 'xlsx') {
      return sendXlsx(reply, 'prihod.xlsx', 'Prihod',
        [{ header: 'Mesec', key: 'month' }, { header: 'Iznos (RSD)', key: 'total' }, { header: 'Broj računa', key: 'count' }],
        [...rows, { month: 'UKUPNO', total, count }]);
    }
    return { total, count, byMonth: rows };
  });

  // b) Pretraga naloga
  app.get('/reports/work-orders', async (request, reply: FastifyReply) => {
    const q = request.query as Record<string, string | undefined>;
    const params: unknown[] = [];
    let where = '';
    if (q['q']) {
      params.push(normalizeSearch(q['q'])); const n = `$1`;
      where = `WHERE regexp_replace(lower(c.name||v.make||v.model||coalesce((SELECT plate FROM registration_history WHERE vehicle_id=v.id AND valid_to IS NULL LIMIT 1),'')),'\\s','','g') LIKE '%'||${n}||'%'`;
    }
    const { rows } = await pool.query(
      `SELECT wo.number, to_char(wo.received_on,'YYYY-MM-DD') received_on, wo.status, c.name customer, v.make, v.model,
        (SELECT plate FROM registration_history WHERE vehicle_id=v.id AND valid_to IS NULL LIMIT 1) plate,
        (SELECT string_agg(name,', ') FROM part_item WHERE work_order_id=wo.id) parts
       FROM work_order wo JOIN customer c ON c.id=wo.customer_id JOIN vehicle v ON v.id=wo.vehicle_id
       ${where} ORDER BY wo.received_on DESC LIMIT 200`, params);
    if (q['format'] === 'xlsx') {
      return sendXlsx(reply, 'nalozi.xlsx', 'Nalozi', [
        { header: 'Broj', key: 'number' }, { header: 'Prijem', key: 'received_on' }, { header: 'Status', key: 'status' },
        { header: 'Klijent', key: 'customer', width: 26 }, { header: 'Marka', key: 'make' }, { header: 'Model', key: 'model' },
        { header: 'Tablica', key: 'plate' }, { header: 'Delovi', key: 'parts', width: 40 },
      ], rows);
    }
    return rows;
  });

  // c) Po majstoru
  app.get('/reports/mechanics/:id', async (request, reply: FastifyReply) => {
    const id = Number((request.params as { id: string }).id);
    const q = request.query as Record<string, string | undefined>;
    const params: unknown[] = [id];
    let dc = '';
    if (q['from']) { params.push(q['from']); dc += ` AND wo.received_on >= $${params.length}`; }
    if (q['to']) { params.push(q['to']); dc += ` AND wo.received_on <= $${params.length}`; }
    const { rows } = await pool.query<{ orders: string; hours: string; value: string }>(
      `SELECT count(DISTINCT li.work_order_id) orders,
        coalesce(sum(CASE WHEN li.billing_unit='hour' THEN li.quantity ELSE 0 END),0) hours,
        coalesce(sum(li.amount),0) value
       FROM labor_item li JOIN work_order wo ON wo.id=li.work_order_id WHERE li.mechanic_id=$1 ${dc}`, params);
    const m = await pool.query(`SELECT full_name, to_char(hired_on,'YYYY-MM-DD') hired_on FROM mechanic WHERE id=$1`, [id]);
    const out = { mechanic: m.rows[0], orders: Number(rows[0]!.orders), hours: Number(rows[0]!.hours), value: Number(rows[0]!.value) };
    if (q['format'] === 'xlsx') {
      return sendXlsx(reply, 'majstor.xlsx', 'Majstor', [
        { header: 'Majstor', key: 'mechanic', width: 26 }, { header: 'Broj naloga', key: 'orders' },
        { header: 'Sati', key: 'hours' }, { header: 'Vrednost (RSD)', key: 'value' },
      ], [{ mechanic: m.rows[0]?.full_name ?? '', orders: out.orders, hours: out.hours, value: out.value }]);
    }
    return out;
  });

  // d) Po tipu vozila
  app.get('/reports/vehicle-types', async (request, reply: FastifyReply) => {
    const q = request.query as Record<string, string | undefined>;
    const conds: string[] = [];
    const params: unknown[] = [];
    for (const [k, col] of [['make', 'v.make'], ['model', 'v.model'], ['fuel', 'v.fuel']] as const) {
      if (q[k]) { params.push(q[k]); conds.push(`${col} ILIKE '%'||$${params.length}||'%'`); }
    }
    if (q['year']) { params.push(Number(q['year'])); conds.push(`v.year=$${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT wo.number, to_char(wo.received_on,'YYYY-MM-DD') AS received_on, v.make, v.model, v.year, v.fuel,
        coalesce(wo.findings, wo.requested_work) AS description, c.name AS customer
       FROM work_order wo JOIN vehicle v ON v.id=wo.vehicle_id JOIN customer c ON c.id=wo.customer_id ${where}
       ORDER BY wo.received_on DESC LIMIT 200`, params);
    if (q['format'] === 'xlsx') {
      return sendXlsx(reply, 'vozila.xlsx', 'Po tipu vozila', [
        { header: 'Broj', key: 'number' }, { header: 'Prijem', key: 'received_on' }, { header: 'Marka', key: 'make' },
        { header: 'Model', key: 'model' }, { header: 'Godište', key: 'year' }, { header: 'Gorivo', key: 'fuel' },
        { header: 'Opis', key: 'description', width: 40 }, { header: 'Klijent', key: 'customer', width: 26 },
      ], rows);
    }
    return rows;
  });

  // Pun Excel izvoz cele baze (spec §4.18)
  app.get('/export/all.xlsx', async (_request, reply: FastifyReply) => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Karton';

    const addSheet = async (name: string, headers: string[], sql: string): Promise<void> => {
      const ws = wb.addWorksheet(name);
      ws.addRow(headers);
      ws.getRow(1).font = { bold: true };
      const { rows } = await pool.query(sql);
      for (const r of rows) ws.addRow(Object.values(r));
      ws.columns.forEach((c) => { c.width = 18; });
    };

    await addSheet('Radni nalozi', ['Broj', 'Status', 'Klijent', 'Vozilo', 'Tablica', 'Prijem', 'Završen', 'Km', 'Zahtevano', 'Utvrđeno', 'Izlazak', 'Ishod', 'Rad', 'Delovi', 'Eksterni'],
      `SELECT wo.number, wo.status, c.name, v.make||' '||v.model,
        (SELECT plate FROM registration_history WHERE vehicle_id=v.id AND valid_to IS NULL LIMIT 1),
        to_char(wo.received_on,'YYYY-MM-DD'), to_char(wo.completed_on,'YYYY-MM-DD'), wo.odometer_km,
        wo.requested_work, wo.findings, wo.field_visit, wo.field_visit_outcome,
        (SELECT coalesce(sum(amount),0) FROM labor_item WHERE work_order_id=wo.id),
        (SELECT coalesce(sum(amount),0) FROM part_item WHERE work_order_id=wo.id AND NOT internal_no_charge),
        (SELECT coalesce(sum(price),0) FROM external_service_item WHERE work_order_id=wo.id AND NOT internal_no_charge)
       FROM work_order wo JOIN customer c ON c.id=wo.customer_id JOIN vehicle v ON v.id=wo.vehicle_id ORDER BY wo.id`);

    for (const [sheet, type] of [['Ponude', 'quote'], ['Predračuni', 'proforma'], ['Računi', 'invoice']] as const) {
      await addSheet(sheet, ['Broj', 'Status', 'Klijent', 'Vozilo', 'Izdato', 'Rok/Dospeće', 'Plaćeno', 'Iznos'],
        `SELECT d.number, d.status, c.name, v.make||' '||v.model, to_char(d.issued_on,'YYYY-MM-DD'),
          to_char(coalesce(d.due_on,d.valid_until),'YYYY-MM-DD'), to_char(d.paid_on,'YYYY-MM-DD'),
          (SELECT coalesce(sum(amount),0) FROM document_item WHERE document_id=d.id)
         FROM document d JOIN customer c ON c.id=d.customer_id JOIN vehicle v ON v.id=d.vehicle_id WHERE d.type='${type}' ORDER BY d.id`);
    }

    await addSheet('Stavke rada', ['Nalog', 'Majstor', 'Naziv', 'Obračun', 'Količina', 'Cena', 'Iznos'],
      `SELECT wo.number, m.full_name, li.name, li.billing_unit, li.quantity, li.unit_price, li.amount
       FROM labor_item li JOIN work_order wo ON wo.id=li.work_order_id JOIN mechanic m ON m.id=li.mechanic_id ORDER BY wo.number, li.id`);
    await addSheet('Delovi', ['Nalog', 'Naziv', 'Količina', 'Cena', 'Iznos', 'Interno'],
      `SELECT wo.number, pi.name, pi.quantity, pi.unit_price, pi.amount, pi.internal_no_charge
       FROM part_item pi JOIN work_order wo ON wo.id=pi.work_order_id ORDER BY wo.number, pi.id`);
    await addSheet('Eksterni servis', ['Nalog', 'Radnja', 'Opis', 'Cena', 'Interno'],
      `SELECT wo.number, e.vendor_name, e.description, e.price, e.internal_no_charge
       FROM external_service_item e JOIN work_order wo ON wo.id=e.work_order_id ORDER BY wo.number, e.id`);

    const buf = await wb.xlsx.writeBuffer();
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="karton-izvoz.xlsx"')
      .send(Buffer.from(buf));
  });
}
