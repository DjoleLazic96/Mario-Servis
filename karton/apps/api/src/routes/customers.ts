import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import type { Customer, Contact } from '@karton/shared';
import { pool, tx } from '../db.ts';
import { sendError } from '../http.ts';
import { requireAuth } from '../auth-guards.ts';
import { writeAudit } from '../audit.ts';
import { parseListParams, offset, orderBy, normalizeSearch } from '../query.ts';
import { defaultPageSize } from '../settings-cache.ts';

// --- validacija ---
const createSchema = z
  .object({
    type: z.enum(['individual', 'company']),
    name: z.string().trim().min(1),
    taxId: z.string().trim().min(1).nullish(),
    address: z.string().trim().nullish(),
    phone: z.string().trim().min(1).nullish(),
    email: z.string().trim().email().nullish(),
  })
  .refine((d) => d.type !== 'company' || !!d.taxId, {
    message: 'PIB je obavezan za pravna lica.',
    path: ['taxId'],
  });

const updateSchema = z
  .object({
    type: z.enum(['individual', 'company']),
    name: z.string().trim().min(1),
    taxId: z.string().trim().min(1).nullish(),
    address: z.string().trim().nullish(),
  })
  .refine((d) => d.type !== 'company' || !!d.taxId, {
    message: 'PIB je obavezan za pravna lica.',
    path: ['taxId'],
  });

const contactSchema = z.object({
  kind: z.enum(['phone', 'email']),
  value: z.string().trim().min(1),
  isPrimary: z.boolean().optional(),
});

// --- mapiranje reda u DTO ---
interface CustomerRow {
  id: number;
  type: 'individual' | 'company';
  name: string;
  tax_id: string | null;
  address: string | null;
  status: 'active' | 'archived';
}
function toCustomer(row: CustomerRow, contacts: Contact[]): Customer {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    taxId: row.tax_id,
    address: row.address,
    status: row.status,
    contacts,
  };
}

async function loadContacts(customerId: number, client?: PoolClient): Promise<Contact[]> {
  const exec = client ?? pool;
  const { rows } = await exec.query<{ id: number; kind: 'phone' | 'email'; value: string; is_primary: boolean }>(
    `SELECT id, kind, value, is_primary FROM customer_contact WHERE customer_id = $1 ORDER BY is_primary DESC, id`,
    [customerId],
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, value: r.value, isPrimary: r.is_primary }));
}

async function getFullCustomer(id: number, client?: PoolClient): Promise<Customer | null> {
  const exec = client ?? pool;
  const { rows } = await exec.query<CustomerRow>(
    `SELECT id, type, name, tax_id, address, status FROM customer WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  return toCustomer(rows[0], await loadContacts(id, client));
}

const SORTABLE = { name: 'name', type: 'type', taxId: 'tax_id', status: 'status' };

export async function customerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // GET /customers — lista (filter type/status, pretraga, sort, paginacija)
  app.get('/customers', async (request) => {
    const p = parseListParams(request.query as Record<string, unknown>, await defaultPageSize());
    const query = request.query as Record<string, string | undefined>;

    const conds: string[] = [];
    const params: unknown[] = [];
    if (query['type']) {
      params.push(query['type']);
      conds.push(`type = $${params.length}::customer_type`);
    }
    if (query['status']) {
      params.push(query['status']);
      conds.push(`status = $${params.length}::archive_status`);
    }
    if (p.q) {
      params.push(normalizeSearch(p.q));
      const norm = `$${params.length}`;
      params.push(p.q.toLowerCase());
      const raw = `$${params.length}`;
      // Klijenta se traži i po onome što nije na njemu samom: po telefonu/mejlu i po
      // vozilu koje vozi. Mario zna tablicu, a ne uvek prezime.
      conds.push(
        `(regexp_replace(lower(name), '\\s', '', 'g') LIKE '%' || ${norm} || '%'
          OR lower(coalesce(tax_id, '')) LIKE '%' || ${raw} || '%'
          OR EXISTS (SELECT 1 FROM customer_contact cc WHERE cc.customer_id = customer.id
                     AND regexp_replace(lower(cc.value), '\\s', '', 'g') LIKE '%' || ${norm} || '%')
          OR EXISTS (SELECT 1 FROM ownership_history oh JOIN vehicle veh ON veh.id = oh.vehicle_id
                     WHERE oh.customer_id = customer.id AND oh.valid_to IS NULL
                     AND (regexp_replace(lower(veh.make || veh.model), '\\s', '', 'g') LIKE '%' || ${norm} || '%'
                          OR EXISTS (SELECT 1 FROM registration_history rh WHERE rh.vehicle_id = veh.id
                                     AND regexp_replace(lower(rh.plate), '\\s', '', 'g') LIKE '%' || ${norm} || '%'))))`,
      );
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const order = orderBy(p.sort, SORTABLE, 'name ASC');

    params.push(p.pageSize);
    const limit = `$${params.length}`;
    params.push(offset(p));
    const off = `$${params.length}`;

    const { rows } = await pool.query<CustomerRow & { total_count: string }>(
      `SELECT id, type, name, tax_id, address, status, count(*) OVER() AS total_count
       FROM customer ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${off}`,
      params,
    );
    const total = rows[0] ? parseInt(rows[0].total_count, 10) : 0;
    // kontakti se učitavaju za prikaz primarnih u listi
    const data = await Promise.all(rows.map(async (r) => toCustomer(r, await loadContacts(r.id))));
    return { data, meta: { page: p.page, pageSize: p.pageSize, total } };
  });

  // GET /customers/:id
  app.get('/customers/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const customer = await getFullCustomer(id);
    if (!customer) return sendError(reply, 404, 'NOT_FOUND', 'Klijent ne postoji.');
    return customer;
  });

  // POST /customers — kreiranje (BR-04: duplikat PIB/JMBG → 409 sa existingId)
  app.post('/customers', async (request, reply) => {
    const body = createSchema.parse(request.body);
    if (body.taxId) {
      const dup = await pool.query<{ id: number }>('SELECT id FROM customer WHERE tax_id = $1', [body.taxId]);
      if (dup.rows[0]) {
        return sendError(reply, 409, 'DUPLICATE_TAX_ID', 'Klijent sa istim PIB/JMBG već postoji.', {
          existingId: dup.rows[0].id,
        });
      }
    }
    const created = await tx(async (client) => {
      const ins = await client.query<{ id: number }>(
        `INSERT INTO customer (type, name, tax_id, address, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [body.type, body.name, body.taxId ?? null, body.address ?? null, request.currentUser!.id],
      );
      const id = ins.rows[0]!.id;
      if (body.phone) {
        await client.query(
          `INSERT INTO customer_contact (customer_id, kind, value, is_primary, created_by) VALUES ($1,'phone',$2,true,$3)`,
          [id, body.phone, request.currentUser!.id],
        );
      }
      if (body.email) {
        await client.query(
          `INSERT INTO customer_contact (customer_id, kind, value, is_primary, created_by) VALUES ($1,'email',$2,true,$3)`,
          [id, body.email, request.currentUser!.id],
        );
      }
      return (await getFullCustomer(id, client))!;
    });
    return reply.code(201).send(created);
  });

  // PATCH /customers/:id
  app.patch('/customers/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = updateSchema.parse(request.body);
    const existing = await pool.query<{ id: number }>('SELECT id FROM customer WHERE id = $1', [id]);
    if (!existing.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Klijent ne postoji.');
    if (body.taxId) {
      const dup = await pool.query<{ id: number }>(
        'SELECT id FROM customer WHERE tax_id = $1 AND id <> $2',
        [body.taxId, id],
      );
      if (dup.rows[0]) {
        return sendError(reply, 409, 'DUPLICATE_TAX_ID', 'Drugi klijent već koristi taj PIB/JMBG.', {
          existingId: dup.rows[0].id,
        });
      }
    }
    await pool.query(
      `UPDATE customer SET type=$1, name=$2, tax_id=$3, address=$4, updated_at=now() WHERE id=$5`,
      [body.type, body.name, body.taxId ?? null, body.address ?? null, id],
    );
    return (await getFullCustomer(id))!;
  });

  // POST /customers/:id/contacts — dodaj/zameni telefon ili email
  app.post('/customers/:id/contacts', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = contactSchema.parse(request.body);
    const exists = await pool.query('SELECT 1 FROM customer WHERE id = $1', [id]);
    if (exists.rowCount === 0) return sendError(reply, 404, 'NOT_FOUND', 'Klijent ne postoji.');
    await tx(async (client) => {
      if (body.isPrimary) {
        await client.query(
          `UPDATE customer_contact SET is_primary = false WHERE customer_id = $1 AND kind = $2`,
          [id, body.kind],
        );
      }
      await client.query(
        `INSERT INTO customer_contact (customer_id, kind, value, is_primary, created_by) VALUES ($1,$2,$3,$4,$5)`,
        [id, body.kind, body.value, body.isPrimary ?? false, request.currentUser!.id],
      );
    });
    return reply.code(201).send(await getFullCustomer(id));
  });

  // POST /customers/:id/archive  i  /unarchive (audit: customer.archived/.unarchived)
  app.post('/customers/:id/archive', archiveHandler('archived', 'customer.archived'));
  app.post('/customers/:id/unarchive', archiveHandler('active', 'customer.unarchived'));

  function archiveHandler(target: 'archived' | 'active', action: string) {
    return async (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
      const id = Number((request.params as { id: string }).id);
      const cur = await pool.query<{ status: string }>('SELECT status FROM customer WHERE id = $1', [id]);
      if (!cur.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Klijent ne postoji.');
      await tx(async (client) => {
        await client.query('UPDATE customer SET status = $1, updated_at = now() WHERE id = $2', [target, id]);
        await writeAudit(
          { userId: request.currentUser!.id, entityType: 'customer', entityId: id, action, oldValue: { status: cur.rows[0]!.status }, newValue: { status: target } },
          client,
        );
      });
      return getFullCustomer(id);
    };
  }
}
