import type { PoolClient } from 'pg';
import type { Document, DocumentDetail, DocumentItem, DocumentChain, DocumentChainRef, MechanicSpecialty } from '@karton/shared';
import { pool } from './db.ts';
import { todayBelgrade, addDays } from './time.ts';

const LABOR_GROUP_NAME: Record<MechanicSpecialty, string> = {
  mechanical: 'Mehaničarski rad',
  electrical: 'Električarski rad',
  other: 'Ostali rad',
};

export interface SnapshotItem {
  itemType: 'labor' | 'part' | 'external';
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
  laborGroup: MechanicSpecialty | null;
  billingUnit: 'hour' | 'km' | 'flat' | null;
}

/**
 * Snapshot stavki iz naloga za dokument (BR-26): interne stavke se izuzimaju;
 * satni rad grupisan po specijalnosti (cena/h samo ako je ista u grupi);
 * km/paušal kao zasebni redovi; delovi i eksterni kako jesu.
 */
export async function buildSnapshot(client: PoolClient, workOrderId: number): Promise<SnapshotItem[]> {
  const items: SnapshotItem[] = [];

  const labor = await client.query<{ specialty: MechanicSpecialty; name: string; billing_unit: 'hour' | 'km' | 'flat'; quantity: string | null; unit_price: string | null; amount: string }>(
    `SELECT m.specialty, li.name, li.billing_unit, li.quantity, li.unit_price, li.amount
     FROM labor_item li JOIN mechanic m ON m.id = li.mechanic_id WHERE li.work_order_id = $1 ORDER BY li.id`,
    [workOrderId],
  );
  const bySpec = new Map<MechanicSpecialty, { hours: number; amount: number; prices: Set<number> }>();
  for (const l of labor.rows) {
    if (l.billing_unit === 'hour') {
      const g = bySpec.get(l.specialty) ?? { hours: 0, amount: 0, prices: new Set<number>() };
      g.hours += Number(l.quantity);
      g.amount += Number(l.amount);
      g.prices.add(Number(l.unit_price));
      bySpec.set(l.specialty, g);
    } else {
      items.push({
        itemType: 'labor', name: l.name,
        quantity: l.billing_unit === 'km' ? Number(l.quantity) : null,
        unitPrice: l.billing_unit === 'km' ? Number(l.unit_price) : null,
        amount: Number(l.amount), laborGroup: null, billingUnit: l.billing_unit,
      });
    }
  }
  for (const [spec, g] of bySpec) {
    items.push({
      itemType: 'labor', name: LABOR_GROUP_NAME[spec], quantity: g.hours,
      unitPrice: g.prices.size === 1 ? [...g.prices][0]! : null,
      amount: g.amount, laborGroup: spec, billingUnit: 'hour',
    });
  }

  const parts = await client.query<{ name: string; quantity: string; unit_price: string; amount: string }>(
    `SELECT name, quantity, unit_price, amount FROM part_item WHERE work_order_id = $1 AND internal_no_charge = false ORDER BY id`,
    [workOrderId],
  );
  for (const p of parts.rows) {
    items.push({ itemType: 'part', name: p.name, quantity: Number(p.quantity), unitPrice: Number(p.unit_price), amount: Number(p.amount), laborGroup: null, billingUnit: null });
  }

  const ext = await client.query<{ vendor_name: string; description: string | null; price: string }>(
    `SELECT vendor_name, description, price FROM external_service_item WHERE work_order_id = $1 AND internal_no_charge = false ORDER BY id`,
    [workOrderId],
  );
  for (const e of ext.rows) {
    items.push({ itemType: 'external', name: e.description ? `${e.vendor_name} — ${e.description}` : e.vendor_name, quantity: null, unitPrice: null, amount: Number(e.price), laborGroup: null, billingUnit: null });
  }

  return items;
}

export async function insertItems(client: PoolClient, documentId: number, items: SnapshotItem[]): Promise<void> {
  for (const it of items) {
    await client.query(
      `INSERT INTO document_item (document_id, item_type, name, quantity, unit_price, amount, labor_group, billing_unit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [documentId, it.itemType, it.name, it.quantity, it.unitPrice, it.amount, it.laborGroup, it.billingUnit],
    );
  }
}

/** Kopira stavke jednog dokumenta u drugi (za konverziju, ispravku, kopiju). */
export async function copyItems(client: PoolClient, fromDocId: number, toDocId: number): Promise<void> {
  await client.query(
    `INSERT INTO document_item (document_id, item_type, name, quantity, unit_price, amount, labor_group, billing_unit)
     SELECT $1, item_type, name, quantity, unit_price, amount, labor_group, billing_unit FROM document_item WHERE document_id = $2 ORDER BY id`,
    [toDocId, fromDocId],
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const DOC_SELECT = `
  SELECT d.id, d.number, d.type, d.status, d.work_order_id, d.customer_id, d.vehicle_id,
    to_char(d.issued_on,'YYYY-MM-DD') issued_on, to_char(d.due_on,'YYYY-MM-DD') due_on,
    to_char(d.valid_until,'YYYY-MM-DD') valid_until, to_char(d.paid_on,'YYYY-MM-DD') paid_on,
    d.payment_method, d.source_document_id, d.source_relation_type, d.note, d.amount_eur, d.version,
    c.name customer_name, c.type customer_type,
    v.vin, v.make, v.model,
    (SELECT rh.plate FROM registration_history rh WHERE rh.vehicle_id=v.id AND rh.valid_to IS NULL LIMIT 1) plate
  FROM document d JOIN customer c ON c.id=d.customer_id JOIN vehicle v ON v.id=d.vehicle_id`;

export function toDocument(r: any, totalAmount: number): Document {
  return {
    id: r.id, number: r.number, type: r.type, status: r.status, workOrderId: r.work_order_id,
    customer: { id: r.customer_id, name: r.customer_name, type: r.customer_type },
    vehicle: { id: r.vehicle_id, vin: r.vin, make: r.make, model: r.model, plate: r.plate },
    issuedOn: r.issued_on, dueOn: r.due_on, validUntil: r.valid_until, paidOn: r.paid_on,
    paymentMethod: r.payment_method, sourceDocumentId: r.source_document_id, sourceRelationType: r.source_relation_type,
    note: r.note, amountEur: r.amount_eur === null ? null : Number(r.amount_eur), totalAmount, version: r.version,
  };
}

async function docRef(exec: PoolClient | typeof pool, sql: string, params: unknown[]): Promise<DocumentChainRef | null> {
  const { rows } = await exec.query<{ id: number; number: string; status: string }>(sql, params);
  return rows[0] ? { id: rows[0].id, number: rows[0].number, status: rows[0].status } : null;
}

async function computeChain(exec: PoolClient | typeof pool, doc: Document): Promise<DocumentChain> {
  // sidrišni nalog: dokumentov work_order_id, ili (za ponudu) prvi vezani nalog
  let woId = doc.workOrderId;
  if (!woId && doc.type === 'quote') {
    const o = await exec.query<{ id: number }>(`SELECT id FROM work_order WHERE source_quote_id=$1 ORDER BY id LIMIT 1`, [doc.id]);
    woId = o.rows[0]?.id ?? null;
  }
  let workOrder: DocumentChainRef | null = null;
  let quote: DocumentChainRef | null = doc.type === 'quote' ? { id: doc.id, number: doc.number, status: doc.status } : null;
  let proforma: DocumentChainRef | null = null;
  let invoice: DocumentChainRef | null = null;

  if (woId) {
    const w = await exec.query<{ number: string; status: string; source_quote_id: number | null }>(
      `SELECT number, status, source_quote_id FROM work_order WHERE id=$1`, [woId]);
    if (w.rows[0]) {
      workOrder = { id: woId, number: w.rows[0].number, status: w.rows[0].status };
      if (!quote && w.rows[0].source_quote_id) {
        quote = await docRef(exec, `SELECT id, number, status FROM document WHERE id=$1`, [w.rows[0].source_quote_id]);
      }
    }
    proforma = await docRef(exec, `SELECT id, number, status FROM document WHERE type='proforma' AND work_order_id=$1 ORDER BY (status='valid') DESC, id DESC LIMIT 1`, [woId]);
    invoice = await docRef(exec, `SELECT id, number, status FROM document WHERE type='invoice' AND work_order_id=$1 ORDER BY (status IN ('unpaid','paid')) DESC, id DESC LIMIT 1`, [woId]);
  }
  return { quote, workOrder, proforma, invoice };
}

export async function loadDocument(id: number, client?: PoolClient): Promise<DocumentDetail | null> {
  const exec = client ?? pool;
  const head = await exec.query(`${DOC_SELECT} WHERE d.id=$1`, [id]);
  if (!head.rows[0]) return null;
  const rows = await exec.query(`SELECT id, item_type, name, quantity, unit_price, amount, labor_group, billing_unit FROM document_item WHERE document_id=$1 ORDER BY item_type, id`, [id]);
  const items: DocumentItem[] = rows.rows.map((r: any) => ({
    id: r.id, itemType: r.item_type, name: r.name,
    quantity: r.quantity === null ? null : Number(r.quantity),
    unitPrice: r.unit_price === null ? null : Number(r.unit_price),
    amount: Number(r.amount), laborGroup: r.labor_group, billingUnit: r.billing_unit,
  }));
  const total = items.reduce((s, i) => s + i.amount, 0);
  const doc = toDocument(head.rows[0], total);
  const chain = await computeChain(exec, doc);
  return { ...doc, items, chain };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Rok važenja: prosleđen ili danas + default_validity_days iz podešavanja. */
export async function defaultValidUntil(client: PoolClient, provided?: string): Promise<string> {
  if (provided) return provided;
  const { rows } = await client.query<{ default_validity_days: number }>('SELECT default_validity_days FROM settings WHERE id=1');
  return addDays(todayBelgrade(), rows[0]?.default_validity_days ?? 15);
}
