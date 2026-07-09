import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from './config.ts';
import { sendError } from './http.ts';

/**
 * CSRF — double-submit cookie (OpenAPI ugovor):
 * svaki odgovor postavlja/osvežava XSRF-TOKEN cookie (čitljiv iz JS),
 * a svaki non-GET zahtev mora poslati isti u X-CSRF-Token headeru.
 * Neslaganje ili izostanak → 403 CSRF_FAILED.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const COOKIE = 'XSRF-TOKEN';

export function registerCsrf(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    let token = request.cookies[COOKIE];
    if (!token) {
      token = randomBytes(24).toString('base64url');
      reply.setCookie(COOKIE, token, {
        httpOnly: false, // front mora da ga pročita da bi ga vratio u headeru
        sameSite: 'lax',
        secure: config.cookieSecure,
        path: '/',
      });
    }
    if (SAFE_METHODS.has(request.method)) return;

    const header = request.headers['x-csrf-token'];
    if (!header || header !== token) {
      return sendError(reply, 403, 'CSRF_FAILED', 'CSRF token nije validan ili nedostaje.');
    }
  });
}
