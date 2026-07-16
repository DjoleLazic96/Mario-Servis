import type { DocumentType, DocumentStatus } from '@karton/shared';
import { labels } from '@karton/shared';

export const docTypeLabel: Record<DocumentType, string> = {
  quote: 'Ponuda',
  proforma: 'Predračun',
  invoice: 'Račun',
};

export function docStatusLabel(type: DocumentType, status: DocumentStatus): string {
  const map =
    type === 'quote' ? labels.quoteStatus : type === 'proforma' ? labels.proformaStatus : labels.invoiceStatus;
  return (map as Record<string, string>)[status] ?? status;
}

export const docStatusClass: Record<string, string> = {
  pending: 'st-open', accepted: 'st-done', rejected: 'st-cancel', expired: 'st-cancel',
  valid: 'st-open', used: 'st-done',
  unpaid: 'st-progress', paid: 'st-done', voided: 'st-cancel',
};

export const money = (n: number): string => n.toLocaleString('sr-RS');

/** ISO 'YYYY-MM-DD' → srpski 'DD.MM.YYYY.'. Čista obrada stringa — bez Date/timezone rizika. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}.`;
}

/** Izvedena UI oznaka dospeća računa (BR-31): „dospeo" nije status. */
/**
 * Oznaka pored datuma dospeća — javlja se SAMO kad račun kasni.
 * Ranije je za nedospeo račun pisala „dospeva 28.07.2026" tačno ispod polja
 * „Datum dospeća 28.07.2026" — isti podatak dvaput, bez ikakve koristi.
 */
export function dueInfo(dueOn: string | null): { text: string; warn: boolean } | null {
  if (!dueOn) return null;
  const today = new Date().toLocaleDateString('sv-SE');
  if (dueOn >= today) return null;
  const days = Math.round((Date.parse(today) - Date.parse(dueOn)) / 86400000);
  return { text: `kasni ${days} ${days === 1 ? 'dan' : 'dana'}`, warn: true };
}

/** Upozorenje ako je rok važenja prošao. */
export function validityWarn(validUntil: string | null): boolean {
  if (!validUntil) return false;
  return validUntil < new Date().toLocaleDateString('sv-SE');
}
