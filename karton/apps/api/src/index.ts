// Proces uvek radi u UTC (pravilo 5, teh. preporuka §10) — poslovna logika prevodi u Europe/Belgrade.
process.env.TZ = 'UTC';

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import { ZodError } from 'zod';
import { config } from './config.ts';
import { pool } from './db.ts';
import { PgSessionStore } from './session-store.ts';
import { registerCsrf } from './csrf.ts';
import { sendError } from './http.ts';
import { authRoutes } from './routes/auth.ts';
import { customerRoutes } from './routes/customers.ts';
import { vehicleRoutes } from './routes/vehicles.ts';
import { mechanicRoutes } from './routes/mechanics.ts';
import { serviceRoutes } from './routes/services.ts';
import { workOrderRoutes } from './routes/work-orders.ts';
import { documentRoutes } from './routes/documents.ts';
import { appointmentRoutes } from './routes/appointments.ts';
import { reportRoutes } from './routes/reports.ts';
import { settingsRoutes } from './routes/settings.ts';
import { dashboardRoutes } from './routes/dashboard.ts';
import { backupRoutes } from './routes/backup.ts';
import { photoRoutes } from './routes/photos.ts';

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

const app = Fastify({
  logger: {
    level: config.isProduction ? 'info' : 'debug',
    transport: config.isProduction ? undefined : { target: 'pino-pretty' },
  },
  // Verujemo X-Forwarded-For SAMO od našeg Caddy-ja (TRUST_PROXY iz .env), da bi
  // `request.ip` bila prava adresa posetioca — od nje zavisi kočnica na prijavi.
  trustProxy: config.TRUST_PROXY || false,
});

// Redosled registracije je bitan: cookie → session → CSRF.
await app.register(cookie);
await app.register(session, {
  secret: config.SESSION_SECRET,
  store: new PgSessionStore(),
  cookieName: 'karton_session',
  rolling: true, // svaka aktivnost produžava sesiju — QR sa štampe otvara nalog bez login koraka
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: config.cookieSecure, // samo u produkciji (pravilo 3)
    sameSite: 'lax',
    maxAge: THIRTY_DAYS,
    path: '/',
  },
});
registerCsrf(app);

// Jedinstveni oblik greške za sve neuhvaćene izuzetke.
app.setErrorHandler((err, request, reply) => {
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) fields[issue.path.join('.')] = issue.message;
    return sendError(reply, 400, 'VALIDATION_FAILED', 'Neispravni podaci.', { fields });
  }
  request.log.error(err);
  return reply.code(500).send({ code: 'INTERNAL', message: 'Neočekivana greška na serveru.' });
});

// Infrastrukturni health (bez /api prefiksa) — za deploy provere.
app.get('/health', async () => {
  const { rows } = await pool.query<{ now: Date; db: string }>(
    'SELECT now() AS now, current_database() AS db',
  );
  return { status: 'ok', time: rows[0]?.now, database: rows[0]?.db, env: config.NODE_ENV };
});

// Poslovne rute pod /api/v1 (OpenAPI ugovor).
await app.register(authRoutes, { prefix: '/api/v1' });
await app.register(customerRoutes, { prefix: '/api/v1' });
await app.register(vehicleRoutes, { prefix: '/api/v1' });
await app.register(mechanicRoutes, { prefix: '/api/v1' });
await app.register(serviceRoutes, { prefix: '/api/v1' });
await app.register(workOrderRoutes, { prefix: '/api/v1' });
await app.register(documentRoutes, { prefix: '/api/v1' });
await app.register(appointmentRoutes, { prefix: '/api/v1' });
await app.register(reportRoutes, { prefix: '/api/v1' });
await app.register(settingsRoutes, { prefix: '/api/v1' });
await app.register(dashboardRoutes, { prefix: '/api/v1' });
await app.register(backupRoutes, { prefix: '/api/v1' });
await app.register(photoRoutes, { prefix: '/api/v1' });

try {
  await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
