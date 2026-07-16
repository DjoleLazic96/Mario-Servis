/**
 * Slanje pošte. Modul je u `shared` jer ga koriste i worker (podsetnici) i API
 * (dugme „Pošalji probni mejl" u Podešavanjima) — ista pravila na oba mesta.
 *
 * Izvor podataka je ekran Podešavanja (tabela `settings`). Ako tamo nema hosta,
 * pada na SMTP_* iz .env — tako lokalni Mailpit radi bez ikakvog podešavanja.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { decryptSecret, isEncrypted } from './crypto.ts';
import type { QueryablePool } from './backup.ts';

export interface SmtpSettings {
  host: string;
  port: number;
  username: string | null;
  /** Već dešifrovana lozinka (ili null kad server ne traži prijavu, npr. Mailpit). */
  password: string | null;
  senderEmail: string | null;
  shopName: string;
  /** Odakle su podaci — za jasnu poruku u „probnom mejlu". */
  source: 'settings' | 'env';
}

/**
 * TLS se bira po portu, jer se provajderi drže dogovora:
 *   465 → veza je šifrovana od prve sekunde (secure: true)
 *   587 → veza kreće čista pa se podiže na TLS (STARTTLS) — Gmail koristi ovo
 *   ostalo (1025 Mailpit) → bez TLS-a; samo za lokalni test
 */
export function buildTransport(s: SmtpSettings): Transporter {
  const secure = s.port === 465;
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure,
    // Na 587 zahtevamo TLS izričito — bez ovoga bi lozinka mogla da ode nešifrovana.
    requireTLS: s.port === 587,
    auth: s.username && s.password ? { user: s.username, pass: s.password } : undefined,
  });
}

/**
 * Adresa pošiljaoca.
 * PAŽNJA (Gmail): Gmail prepisuje adresu na onu kojom se prijavljuješ. Ako se
 * `senderEmail` razlikuje od `username`, mušterija će ipak videti username adresu
 * (osim ako je alias posebno verifikovan u Gmail-u). Zato username ima prednost
 * kad sender nije upisan.
 */
export function fromHeader(s: SmtpSettings): string {
  const address = s.senderEmail || s.username || 'servis@localhost';
  return `${s.shopName} <${address}>`;
}

/** Učita SMTP iz Podešavanja; ako host nije upisan, vrati .env (lokalni Mailpit). */
export async function loadSmtp(pool: QueryablePool, secretsKey: string): Promise<SmtpSettings> {
  const { rows } = await pool.query<{
    smtp_host: string | null; smtp_port: number | null; smtp_username: string | null;
    smtp_password: string | null; sender_email: string | null; shop_name: string;
  }>(`SELECT smtp_host, smtp_port, smtp_username, smtp_password, sender_email, shop_name FROM settings WHERE id=1`);
  const r = rows[0];

  if (r?.smtp_host) {
    return {
      host: r.smtp_host,
      port: r.smtp_port ?? 587,
      username: r.smtp_username,
      password: r.smtp_password ? decryptPassword(r.smtp_password, secretsKey) : null,
      senderEmail: r.sender_email,
      shopName: r.shop_name,
      source: 'settings',
    };
  }
  return {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
    username: null,
    password: null,
    senderEmail: process.env.SENDER_EMAIL ?? 'servis@localhost',
    shopName: r?.shop_name ?? 'Servis',
    source: 'env',
  };
}

/**
 * Zatečene lozinke su mogle biti upisane u čistom tekstu (pre nego što je šifrovanje
 * postojalo). Takve prihvatamo kakve jesu — sledeći upis kroz Podešavanja ih šifruje.
 */
function decryptPassword(stored: string, secretsKey: string): string {
  return isEncrypted(stored) ? decryptSecret(stored, secretsKey) : stored;
}
