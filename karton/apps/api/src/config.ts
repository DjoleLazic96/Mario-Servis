import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Sve što se razlikuje između lokalnog i servera dolazi iz env-a (pravilo 1, teh. preporuka §10).
 * Validira se pri startu — ako nešto fali, proces pada odmah sa jasnom porukom.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(3000),
  SESSION_SECRET: z.string().min(32),
  // Ključ za šifrovanje tajni u bazi (SMTP lozinka). Ako se izgubi, SMTP lozinka se
  // više ne može pročitati — ponovo se ukuca u Podešavanjima. Zato ide i u backup plan.
  SECRETS_KEY: z.string().min(32),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SENDER_EMAIL: z.string().default('servis@localhost'),
  BACKUP_DIR: z.string().default('./backups'),
  UPLOADS_DIR: z.string().default('./uploads'),
  // fallback kad pg_dump nije na PATH-u (lokalni razvoj: baza je u kontejneru)
  DB_CONTAINER: z.string().default('karton-db'),
  /**
   * Adresa reverse proxy-ja (Caddy) od kojeg smemo da verujemo `X-Forwarded-For`.
   * Bez ovoga bi iza proxy-ja SVI zahtevi izgledali kao 127.0.0.1 — pa bi jedan
   * napadač zaključao prijavu svima. Prazno = nema proxy-ja (lokalni razvoj).
   * NIKAD `true` na otvorenom: tada napadač sam šalje X-Forwarded-For i izbegne kočnicu.
   */
  TRUST_PROXY: z.string().default(''),
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
  // sidrimo na koren monorepoa: API i worker imaju različit cwd, a moraju da dele isti direktorijum
  backupDir: resolve(import.meta.dirname, '../../..', parsed.data.BACKUP_DIR),
  uploadsDir: resolve(import.meta.dirname, '../../..', parsed.data.UPLOADS_DIR),
  dbContainer: parsed.data.DB_CONTAINER,
};
