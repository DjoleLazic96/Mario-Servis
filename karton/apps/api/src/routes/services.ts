import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Service } from '@karton/shared';
import { pool } from '../db.ts';
import { sendError } from '../http.ts';
import { requireAuth } from '../auth-guards.ts';

// Cenovnik usluga: paušal ili po km (satni rad ide preko cenovnika majstora — BR-07)
const serviceSchema = z.object({
  name: z.string().trim().min(1),
  billingUnit: z.enum(['km', 'flat']),
  defaultPrice: z.number().nonnegative(),
  status: z.enum(['active', 'inactive']).optional(),
});

interface ServiceRow {
  id: number;
  name: string;
  billing_unit: 'km' | 'flat';
  default_price: string;
  status: 'active' | 'inactive';
}
function toService(r: ServiceRow): Service {
  return {
    id: r.id,
    name: r.name,
    billingUnit: r.billing_unit,
    defaultPrice: Number(r.default_price),
    status: r.status,
  };
}

export async function serviceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/services', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (query['status']) {
      params.push(query['status']);
      conds.push(`status = $${params.length}::service_status`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await pool.query<ServiceRow>(
      `SELECT id, name, billing_unit, default_price, status FROM service_catalog ${where} ORDER BY name ASC`,
      params,
    );
    return rows.map(toService);
  });

  app.post('/services', async (request, reply) => {
    const b = serviceSchema.parse(request.body);
    const { rows } = await pool.query<ServiceRow>(
      `INSERT INTO service_catalog (name, billing_unit, default_price, status, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, name, billing_unit, default_price, status`,
      [b.name, b.billingUnit, b.defaultPrice, b.status ?? 'active', request.currentUser!.id],
    );
    return reply.code(201).send(toService(rows[0]!));
  });

  app.patch('/services/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const b = serviceSchema.parse(request.body);
    const { rows } = await pool.query<ServiceRow>(
      `UPDATE service_catalog SET name=$1, billing_unit=$2, default_price=$3, status=$4, updated_at=now()
       WHERE id=$5 RETURNING id, name, billing_unit, default_price, status`,
      [b.name, b.billingUnit, b.defaultPrice, b.status ?? 'active', id],
    );
    if (!rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Usluga ne postoji.');
    return toService(rows[0]);
  });
}
