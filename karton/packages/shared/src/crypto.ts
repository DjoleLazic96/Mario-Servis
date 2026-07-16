/**
 * Šifrovanje tajni koje MORAJU da se vrate u čitljiv oblik (SMTP lozinka — njome se
 * prijavljujemo na tuđi mail server, pa je moramo znati).
 *
 * Ovo NIJE isto što i lozinke korisnika: one se HEŠIRAJU (argon2) i nikad se ne vraćaju.
 * Razlika je namerna — heš se ne može „odšifrovati", a SMTP lozinku moramo poslati Gmail-u.
 *
 * AES-256-GCM: daje poverljivost i proveru integriteta (auth tag), pa se izmenjen zapis
 * u bazi neće tiho dešifrovati u smeće, nego će pući.
 *
 * Zapis: `v1:<iv>:<tag>:<šifrat>` (sve base64). Prefiks je tu da kasnija promena
 * algoritma može da prepozna stare zapise.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';

/** Ključ iz .env je proizvoljan tekst → SHA-256 ga svodi na tačno 32 bajta koje AES traži. */
function keyOf(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12); // GCM standard: 96 bita
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function decryptSecret(blob: string, secret: string): string {
  const [v, iv, tag, data] = blob.split(':');
  if (v !== VERSION || !iv || !tag || !data) {
    throw new Error('Šifrovana tajna nije u očekivanom formatu (v1:iv:tag:šifrat).');
  }
  const decipher = createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  // Ako je ključ pogrešan ili je zapis diran, `final()` baca — bolje pući nego vratiti smeće.
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

/** Da li tekst izgleda kao naš šifrat (za razlikovanje od zatečenog čistog teksta). */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}:`) && value.split(':').length === 4;
}
