import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import type { Vehicle, OwnershipRecord, RegistrationRecord } from '@karton/shared';
import { pool, tx } from '../db.ts';
import { sendError } from '../http.ts';
import { requireAuth } from '../auth-guards.ts';
import { writeAudit } from '../audit.ts';
import { parseListParams, offset, orderBy, normalizeSearch } from '../query.ts';
import { todayBelgrade } from '../time.ts';

const createSchema = z.object({
  vin: z.string().trim().min(1),
  make: z.string().trim().min(1),
  model: z.string().trim().min(1),
  year: z.number().int().min(1900).max(2100).nullish(),
  fuel: z.string().trim().nullish(),
  plate: z.string().trim().min(1).nullish(),
  ownerId: z.number().int().positive().nullish(),
  note: z.string().trim().nullish(),
});

const updateSchema = z.object({
  make: z.string().trim().min(1),
  model: z.string().trim().min(1),
  year: z.number().int().min(1900).max(2100).nullish(),
  fuel: z.string().trim().nullish(),
  note: z.string().trim().nullish(),
});

const ownershipSchema = z.object({
  customerId: z.number().int().positive(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const registrationSchema = z.object({
  plate: z.string().trim().min(1),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().trim().nullish(),
});

interface VehicleRow {
  id: number;
  vin: string;
  make: string;
  model: string;
  year: number | null;
  fuel: string | null;
  note: string | null;
  status: 'active' | 'archived';
  current_plate: string | null;
  owner_id: number | null;
  owner_name: string | null;
  owner_type: 'individual' | 'company' | null;
}

function toVehicle(r: VehicleRow): Vehicle {
  return {
    id: r.id,
    vin: r.vin,
    make: r.make,
    model: r.model,
    year: r.year,
    fuel: r.fuel,
    note: r.note,
    status: r.status,
    currentPlate: r.current_plate,
    currentOwner: r.owner_id ? { id: r.owner_id, name: r.owner_name!, type: r.owner_type! } : null,
  };
}

// SELECT sa izvedenim trenutnim vlasnikom i tablicom (aktivni zapisi: valid_to IS NULL)
const VEHICLE_SELECT = `
  SELECT v.id, v.vin, v.make, v.model, v.year, v.fuel, v.note, v.status,
    (SELECT rh.plate FROM registration_history rh
      WHERE rh.vehicle_id = v.id AND rh.valid_to IS NULL LIMIT 1) AS current_plate,
    co.id AS owner_id, co.name AS owner_name, co.type AS owner_type
  FROM vehicle v
  LEFT JOIN LATERAL (
    SELECT c.id, c.name, c.type FROM ownership_history oh
    JOIN customer c ON c.id = oh.customer_id
    WHERE oh.vehicle_id = v.id AND oh.valid_to IS NULL LIMIT 1
  ) co ON true`;

async function getVehicle(id: number, client?: PoolClient): Promise<Vehicle | null> {
  const exec = client ?? pool;
  const { rows } = await exec.query<VehicleRow>(`${VEHICLE_SELECT} WHERE v.id = $1`, [id]);
  return rows[0] ? toVehicle(rows[0]) : null;
}

const SORTABLE = {
  vin: 'v.vin', make: 'v.make', model: 'v.model', year: 'v.year', status: 'v.status',
  plate: `(SELECT rh.plate FROM registration_history rh WHERE rh.vehicle_id = v.id AND rh.valid_to IS NULL LIMIT 1)`,
  owner: 'co.name',
};

export async function vehicleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // GET /vehicles — pretraga pogađa i staru tablicu (BR-03)
  app.get('/vehicles', async (request) => {
    const p = parseListParams(request.query as Record<string, unknown>);
    const query = request.query as Record<string, string | undefined>;
    const conds: string[] = [];
    const params: unknown[] = [];

    if (query['status']) {
      params.push(query['status']);
      conds.push(`v.status = $${params.length}::archive_status`);
    }
    if (query['customerId']) {
      params.push(Number(query['customerId']));
      conds.push(
        `EXISTS (SELECT 1 FROM ownership_history oh WHERE oh.vehicle_id = v.id
                 AND oh.valid_to IS NULL AND oh.customer_id = $${params.length})`,
      );
    }
    if (p.q) {
      params.push(normalizeSearch(p.q));
      const norm = `$${params.length}`;
      params.push(p.q.toLowerCase());
      const low = `$${params.length}`;
      conds.push(`(
        lower(v.vin) LIKE '%' || ${low} || '%'
        OR regexp_replace(lower(v.make || v.model), '\\s', '', 'g') LIKE '%' || ${norm} || '%'
        OR EXISTS (SELECT 1 FROM registration_history rh WHERE rh.vehicle_id = v.id
                   AND regexp_replace(lower(rh.plate), '\\s', '', 'g') LIKE '%' || ${norm} || '%')
      )`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const order = orderBy(p.sort, SORTABLE, 'v.make ASC, v.model ASC');
    params.push(p.pageSize);
    const limit = `$${params.length}`;
    params.push(offset(p));
    const off = `$${params.length}`;

    const { rows } = await pool.query<VehicleRow & { total_count: string }>(
      `${VEHICLE_SELECT.replace('SELECT v.id', 'SELECT count(*) OVER() AS total_count, v.id')}
       ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${off}`,
      params,
    );
    const total = rows[0] ? parseInt(rows[0].total_count, 10) : 0;
    return { data: rows.map(toVehicle), meta: { page: p.page, pageSize: p.pageSize, total } };
  });

  // GET /vehicles/:id
  app.get('/vehicles/:id', async (request, reply) => {
    const v = await getVehicle(Number((request.params as { id: string }).id));
    if (!v) return sendError(reply, 404, 'NOT_FOUND', 'Vozilo ne postoji.');
    return v;
  });

  // POST /vehicles — VIN duplikat → 409; otvara istoriju vlasnika i tablice
  app.post('/vehicles', async (request, reply) => {
    const body = createSchema.parse(request.body);
    const dup = await pool.query<{ id: number }>('SELECT id FROM vehicle WHERE vin = $1', [body.vin]);
    if (dup.rows[0]) {
      return sendError(reply, 409, 'DUPLICATE_VIN', 'Vozilo sa istim VIN brojem već postoji.', {
        existingId: dup.rows[0].id,
      });
    }
    const from = todayBelgrade();
    const created = await tx(async (client) => {
      const ins = await client.query<{ id: number }>(
        `INSERT INTO vehicle (vin, make, model, year, fuel, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [body.vin, body.make, body.model, body.year ?? null, body.fuel ?? null, body.note ?? null, request.currentUser!.id],
      );
      const id = ins.rows[0]!.id;
      if (body.ownerId) {
        await client.query(
          `INSERT INTO ownership_history (vehicle_id, customer_id, valid_from, created_by) VALUES ($1,$2,$3,$4)`,
          [id, body.ownerId, from, request.currentUser!.id],
        );
      }
      if (body.plate) {
        await client.query(
          `INSERT INTO registration_history (vehicle_id, plate, valid_from, created_by) VALUES ($1,$2,$3,$4)`,
          [id, body.plate, from, request.currentUser!.id],
        );
      }
      return (await getVehicle(id, client))!;
    });
    return reply.code(201).send(created);
  });

  // PATCH /vehicles/:id — VIN se ne menja
  app.patch('/vehicles/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = updateSchema.parse(request.body);
    const exists = await pool.query('SELECT 1 FROM vehicle WHERE id = $1', [id]);
    if (exists.rowCount === 0) return sendError(reply, 404, 'NOT_FOUND', 'Vozilo ne postoji.');
    await pool.query(
      `UPDATE vehicle SET make=$1, model=$2, year=$3, fuel=$4, note=$5, updated_at=now() WHERE id=$6`,
      [body.make, body.model, body.year ?? null, body.fuel ?? null, body.note ?? null, id],
    );
    return (await getVehicle(id))!;
  });

  // Istorija vlasništva
  app.get('/vehicles/:id/ownership', async (request) => {
    const id = Number((request.params as { id: string }).id);
    const { rows } = await pool.query<{ id: number; customer_id: number; customer_name: string; customer_type: 'individual' | 'company'; valid_from: string; valid_to: string | null }>(
      `SELECT oh.id, oh.customer_id, c.name AS customer_name, c.type AS customer_type,
              to_char(oh.valid_from,'YYYY-MM-DD') AS valid_from,
              to_char(oh.valid_to,'YYYY-MM-DD') AS valid_to
       FROM ownership_history oh JOIN customer c ON c.id = oh.customer_id
       WHERE oh.vehicle_id = $1 ORDER BY oh.valid_from DESC, oh.id DESC`,
      [id],
    );
    return rows.map<OwnershipRecord>((r) => ({
      id: r.id,
      customer: { id: r.customer_id, name: r.customer_name, type: r.customer_type },
      validFrom: r.valid_from,
      validTo: r.valid_to,
    }));
  });

  // Promena vlasnika — zatvara aktivni, otvara novi (BR-02, transakciono)
  app.post('/vehicles/:id/ownership', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = ownershipSchema.parse(request.body);
    const from = body.validFrom ?? todayBelgrade();
    const exists = await pool.query('SELECT 1 FROM vehicle WHERE id = $1', [id]);
    if (exists.rowCount === 0) return sendError(reply, 404, 'NOT_FOUND', 'Vozilo ne postoji.');
    await tx(async (client) => {
      await client.query(
        `UPDATE ownership_history SET valid_to = $1 WHERE vehicle_id = $2 AND valid_to IS NULL`,
        [from, id],
      );
      await client.query(
        `INSERT INTO ownership_history (vehicle_id, customer_id, valid_from, created_by) VALUES ($1,$2,$3,$4)`,
        [id, body.customerId, from, request.currentUser!.id],
      );
    });
    return reply.code(201).send(await getVehicle(id));
  });

  // Istorija registracije
  app.get('/vehicles/:id/registrations', async (request) => {
    const id = Number((request.params as { id: string }).id);
    const { rows } = await pool.query<{ id: number; plate: string; valid_from: string; valid_to: string | null; note: string | null }>(
      `SELECT id, plate, to_char(valid_from,'YYYY-MM-DD') AS valid_from,
              to_char(valid_to,'YYYY-MM-DD') AS valid_to, note
       FROM registration_history WHERE vehicle_id = $1 ORDER BY valid_from DESC, id DESC`,
      [id],
    );
    return rows.map<RegistrationRecord>((r) => ({
      id: r.id,
      plate: r.plate,
      validFrom: r.valid_from,
      validTo: r.valid_to,
      note: r.note,
    }));
  });

  // Nova tablica — zatvara aktivnu, otvara novu
  app.post('/vehicles/:id/registrations', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = registrationSchema.parse(request.body);
    const from = body.validFrom ?? todayBelgrade();
    const exists = await pool.query('SELECT 1 FROM vehicle WHERE id = $1', [id]);
    if (exists.rowCount === 0) return sendError(reply, 404, 'NOT_FOUND', 'Vozilo ne postoji.');
    await tx(async (client) => {
      await client.query(
        `UPDATE registration_history SET valid_to = $1 WHERE vehicle_id = $2 AND valid_to IS NULL`,
        [from, id],
      );
      await client.query(
        `INSERT INTO registration_history (vehicle_id, plate, valid_from, note, created_by) VALUES ($1,$2,$3,$4,$5)`,
        [id, body.plate, from, body.note ?? null, request.currentUser!.id],
      );
    });
    return reply.code(201).send(await getVehicle(id));
  });

  // Arhiviranje (audit: vehicle.archived/.unarchived)
  app.post('/vehicles/:id/archive', archiveHandler('archived', 'vehicle.archived'));
  app.post('/vehicles/:id/unarchive', archiveHandler('active', 'vehicle.unarchived'));

  function archiveHandler(target: 'archived' | 'active', action: string) {
    return async (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
      const id = Number((request.params as { id: string }).id);
      const cur = await pool.query<{ status: string }>('SELECT status FROM vehicle WHERE id = $1', [id]);
      if (!cur.rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Vozilo ne postoji.');
      await tx(async (client) => {
        await client.query('UPDATE vehicle SET status = $1, updated_at = now() WHERE id = $2', [target, id]);
        await writeAudit(
          { userId: request.currentUser!.id, entityType: 'vehicle', entityId: id, action, oldValue: { status: cur.rows[0]!.status }, newValue: { status: target } },
          client,
        );
      });
      return getVehicle(id);
    };
  }
}
