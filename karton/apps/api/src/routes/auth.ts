import { verify } from '@node-rs/argon2';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { pool } from '../db.ts';
import { sendError } from '../http.ts';
import { requireAuth } from '../auth-guards.ts';
import type { CurrentUser } from '../fastify.d.ts';

const loginSchema = z.object({
  // Korisničko ime (identifikator). Ne mora biti email — dozvoljava npr. „admin".
  email: z.string().min(1),
  password: z.string().min(1),
});

interface UserRow extends CurrentUser {
  password_hash: string;
  status: string;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /auth/login — email + lozinka; postavlja sesiju (spec §6, §4.14)
  app.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const { rows } = await pool.query<UserRow>(
      `SELECT id, name, email, role, status, password_hash FROM app_user WHERE email = $1`,
      [body.email],
    );
    const user = rows[0];

    // Ista poruka za "nema korisnika" i "pogrešna lozinka" — ne odajemo koji nalog postoji.
    const invalid = (): void => void sendError(reply, 401, 'UNAUTHENTICATED', 'Pogrešno korisničko ime ili lozinka.');

    if (!user || user.status !== 'active') {
      invalid();
      return;
    }
    const ok = await verify(user.password_hash, body.password);
    if (!ok) {
      invalid();
      return;
    }

    request.session.userId = user.id;
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  });

  // POST /auth/logout — poništava sesiju
  app.post('/auth/logout', async (request, reply) => {
    await request.session.destroy();
    return reply.code(204).send();
  });

  // GET /auth/me — trenutno prijavljeni korisnik
  app.get('/auth/me', { preHandler: requireAuth }, async (request) => request.currentUser);
}
