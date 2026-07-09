import type { FastifyReply, FastifyRequest } from 'fastify';
import { pool } from './db.ts';
import { sendError } from './http.ts';
import type { CurrentUser } from './fastify.d.ts';

/**
 * preHandler: zahteva prijavljenog i aktivnog korisnika.
 * Učitava korisnika iz baze (ne veruje samo sesiji) i kači ga na request.currentUser.
 * Backend je uvek konačni autoritet (spec §2).
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = request.session.userId;
  if (!userId) {
    await sendError(reply, 401, 'UNAUTHENTICATED', 'Niste prijavljeni.');
    return;
  }
  const { rows } = await pool.query<CurrentUser & { status: string }>(
    `SELECT id, name, email, role, status FROM app_user WHERE id = $1`,
    [userId],
  );
  const user = rows[0];
  if (!user || user.status !== 'active') {
    await request.session.destroy();
    await sendError(reply, 401, 'UNAUTHENTICATED', 'Sesija više nije važeća.');
    return;
  }
  request.currentUser = { id: user.id, name: user.name, email: user.email, role: user.role };
}

/** preHandler: samo admin (Podešavanja, korisnici, backup — spec §4.14). */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;
  if (request.currentUser?.role !== 'admin') {
    await sendError(reply, 403, 'FORBIDDEN', 'Potrebna su administratorska prava.');
  }
}
