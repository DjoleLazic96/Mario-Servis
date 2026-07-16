import { verify } from '@node-rs/argon2';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { pool } from '../db.ts';
import { sendError } from '../http.ts';
import { requireAuth, requireAdmin } from '../auth-guards.ts';
import { checkLock, clearFailures, listLocks, recordFailure, unlock, throttleLimits } from '../login-throttle.ts';
import { writeAudit } from '../audit.ts';
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
    const ip = request.ip;

    // Kočnica ide PRE provere lozinke — zaključana adresa ne sme ni da pogađa.
    const lock = await checkLock(ip);
    if (lock.locked) {
      return sendError(reply, 429, 'TOO_MANY_ATTEMPTS',
        `Previše neuspešnih pokušaja. Pokušajte ponovo za ${Math.ceil(lock.secondsLeft / 60)} min.`);
    }

    const { rows } = await pool.query<UserRow>(
      `SELECT id, name, email, role, status, password_hash FROM app_user WHERE email = $1`,
      [body.email],
    );
    const user = rows[0];

    // Ista poruka za „nema korisnika" i „pogrešna lozinka" — ne odajemo koji nalog postoji.
    const invalid = async (): Promise<void> => {
      const after = await recordFailure(ip);
      if (after.locked) {
        void sendError(reply, 429, 'TOO_MANY_ATTEMPTS',
          `Previše neuspešnih pokušaja. Pokušajte ponovo za ${throttleLimits.LOCK_MINUTES} min.`);
        return;
      }
      void sendError(reply, 401, 'UNAUTHENTICATED', 'Pogrešno korisničko ime ili lozinka.');
    };

    if (!user || user.status !== 'active') {
      await invalid();
      return;
    }
    if (!await verify(user.password_hash, body.password)) {
      await invalid();
      return;
    }

    await clearFailures(ip); // pošten korisnik ne nosi stare omaške
    request.session.userId = user.id;
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  });

  // Zaključane adrese — admin ih vidi i može da pusti ranije (spec §6).
  app.get('/login-locks', { preHandler: requireAdmin }, async () => listLocks());

  app.delete('/login-locks/:ip', { preHandler: requireAdmin }, async (request, reply) => {
    const ip = decodeURIComponent((request.params as { ip: string }).ip);
    if (!await unlock(ip)) return sendError(reply, 404, 'NOT_FOUND', 'Ta adresa nije zaključana.');
    await writeAudit({ userId: request.currentUser!.id, entityType: 'settings', entityId: 1,
      action: 'settings.changed', newValue: { otkljucanaAdresa: ip } });
    return reply.code(204).send();
  });

  // POST /auth/logout — poništava sesiju
  app.post('/auth/logout', async (request, reply) => {
    await request.session.destroy();
    return reply.code(204).send();
  });

  // GET /auth/me — trenutno prijavljeni korisnik
  app.get('/auth/me', { preHandler: requireAuth }, async (request) => request.currentUser);
}
