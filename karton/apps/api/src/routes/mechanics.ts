import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Mechanic, Unavailability } from '@karton/shared';
import { pool } from '../db.ts';
import { sendError } from '../http.ts';
import { requireAuth } from '../auth-guards.ts';
import { orderBy } from '../query.ts';

const mechanicSchema = z.object({
  fullName: z.string().trim().min(1),
  hiredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  hourlyRate: z.number().nonnegative(),
  specialty: z.enum(['mechanical', 'electrical', 'other']),
  status: z.enum(['active', 'inactive']).optional(),
});

const unavailabilitySchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['vacation', 'sick_leave']),
});

interface MechanicRow {
  id: number;
  full_name: string;
  hired_on: string | null;
  hourly_rate: string;
  specialty: 'mechanical' | 'electrical' | 'other';
  status: 'active' | 'inactive';
}
function toMechanic(r: MechanicRow): Mechanic {
  return {
    id: r.id,
    fullName: r.full_name,
    hiredOn: r.hired_on,
    hourlyRate: Number(r.hourly_rate), // numeric → string u pg
    specialty: r.specialty,
    status: r.status,
  };
}

const SORTABLE = { name: 'full_name', specialty: 'specialty', rate: 'hourly_rate', status: 'status' };

export async function mechanicRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/mechanics', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (query['status']) {
      params.push(query['status']);
      conds.push(`status = $${params.length}::mechanic_status`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const order = orderBy(query['sort'], SORTABLE, 'full_name ASC');
    const { rows } = await pool.query<MechanicRow>(
      `SELECT id, full_name, to_char(hired_on,'YYYY-MM-DD') AS hired_on, hourly_rate, specialty, status
       FROM mechanic ${where} ORDER BY ${order}`,
      params,
    );
    return rows.map(toMechanic);
  });

  app.post('/mechanics', async (request, reply) => {
    const b = mechanicSchema.parse(request.body);
    const { rows } = await pool.query<MechanicRow>(
      `INSERT INTO mechanic (full_name, hired_on, hourly_rate, specialty, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, full_name, to_char(hired_on,'YYYY-MM-DD') AS hired_on, hourly_rate, specialty, status`,
      [b.fullName, b.hiredOn ?? null, b.hourlyRate, b.specialty, b.status ?? 'active', request.currentUser!.id],
    );
    return reply.code(201).send(toMechanic(rows[0]!));
  });

  app.patch('/mechanics/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const b = mechanicSchema.parse(request.body);
    const { rows } = await pool.query<MechanicRow>(
      `UPDATE mechanic SET full_name=$1, hired_on=$2, hourly_rate=$3, specialty=$4, status=$5, updated_at=now()
       WHERE id=$6
       RETURNING id, full_name, to_char(hired_on,'YYYY-MM-DD') AS hired_on, hourly_rate, specialty, status`,
      [b.fullName, b.hiredOn ?? null, b.hourlyRate, b.specialty, b.status ?? 'active', id],
    );
    if (!rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Majstor ne postoji.');
    return toMechanic(rows[0]);
  });

  // Nedostupnosti (godišnji / bolovanje)
  app.get('/mechanics/:id/unavailabilities', async (request) => {
    const id = Number((request.params as { id: string }).id);
    const { rows } = await pool.query<{ id: number; from_date: string; to_date: string; kind: 'vacation' | 'sick_leave' }>(
      `SELECT id, to_char(from_date,'YYYY-MM-DD') AS from_date, to_char(to_date,'YYYY-MM-DD') AS to_date, kind
       FROM mechanic_unavailability WHERE mechanic_id = $1 ORDER BY from_date DESC`,
      [id],
    );
    return rows.map<Unavailability>((r) => ({ id: r.id, fromDate: r.from_date, toDate: r.to_date, kind: r.kind }));
  });

  app.post('/mechanics/:id/unavailabilities', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const b = unavailabilitySchema.parse(request.body);
    if (b.toDate < b.fromDate) {
      return sendError(reply, 400, 'VALIDATION_FAILED', 'Datum „do" ne može biti pre datuma „od".', {
        fields: { toDate: 'Mora biti nakon datuma „od".' },
      });
    }
    const exists = await pool.query('SELECT 1 FROM mechanic WHERE id = $1', [id]);
    if (exists.rowCount === 0) return sendError(reply, 404, 'NOT_FOUND', 'Majstor ne postoji.');
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO mechanic_unavailability (mechanic_id, from_date, to_date, kind, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [id, b.fromDate, b.toDate, b.kind, request.currentUser!.id],
    );
    return reply.code(201).send({ id: rows[0]!.id, fromDate: b.fromDate, toDate: b.toDate, kind: b.kind });
  });

  app.delete('/mechanics/:id/unavailabilities/:uid', async (request, reply) => {
    const uid = Number((request.params as { uid: string }).uid);
    await pool.query('DELETE FROM mechanic_unavailability WHERE id = $1', [uid]);
    return reply.code(204).send();
  });
}
