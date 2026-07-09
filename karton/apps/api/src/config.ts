import { z } from 'zod';

/**
 * Sve što se razlikuje između lokalnog i servera dolazi iz env-a (pravilo 1, teh. preporuka §10).
 * Validira se pri startu — ako nešto fali, proces pada odmah sa jasnom porukom.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(3000),
  APP_BASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SENDER_EMAIL: z.string().default('servis@localhost'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Neispravna konfiguracija (.env):');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  /** Secure kolačić samo u produkciji — ne radi na http://localhost (pravilo 3). */
  cookieSecure: parsed.data.NODE_ENV === 'production',
};
