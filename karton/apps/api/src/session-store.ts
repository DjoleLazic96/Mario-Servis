import type { SessionStore } from '@fastify/session';
import { pool } from './db.ts';

/**
 * Sesijski store za @fastify/session, oslonjen na postojeću `session` tabelu
 * (sid / sess json / expire) — connect-pg-simple kompatibilna šema.
 * Sesija u Postgresu (teh. preporuka §6): preživljava restart, deli je api i worker.
 */
export class PgSessionStore implements SessionStore {
  set(sessionId: string, session: any, callback: (err?: unknown) => void): void {
    const expire: Date = session?.cookie?.expires
      ? new Date(session.cookie.expires)
      : new Date(Date.now() + THIRTY_DAYS);
    pool
      .query(
        `INSERT INTO "session" (sid, sess, expire) VALUES ($1, $2, $3)
         ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
        [sessionId, JSON.stringify(session), expire],
      )
      .then(() => callback())
      .catch((err) => callback(err));
  }

  get(sessionId: string, callback: (err?: unknown, result?: any) => void): void {
    pool
      .query<{ sess: Record<string, unknown>; expire: Date }>(
        `SELECT sess, expire FROM "session" WHERE sid = $1`,
        [sessionId],
      )
      .then(async ({ rows }) => {
        const row = rows[0];
        if (!row) return callback();
        if (new Date(row.expire).getTime() < Date.now()) {
          await pool.query(`DELETE FROM "session" WHERE sid = $1`, [sessionId]);
          return callback();
        }
        callback(undefined, row.sess); // json kolona — pg vraća već parsiran objekat
      })
      .catch((err) => callback(err));
  }

  destroy(sessionId: string, callback: (err?: unknown) => void): void {
    pool
      .query(`DELETE FROM "session" WHERE sid = $1`, [sessionId])
      .then(() => callback())
      .catch((err) => callback(err));
  }
}

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
