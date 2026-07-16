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

/**
 * Izvedena UI oznaka dospeća računa (BR-31): „dospeo" nije status.
 *
 * Javlja se SAMO kad račun kasni — za nedospeo je ranije pisala „dospeva 28.07.2026"
 * tačno ispod polja „Datum dospeća 28.07.2026", isti podatak dvaput.
 */
export function dueInfo(dueOn: string | null): string | null {
  if (!dueOn) return null;
  const today = new Date().toLocaleDateString('sv-SE');
  if (dueOn >= today) return null;
  const days = Math.round((Date.parse(today) - Date.parse(dueOn)) / 86400000);
  return `kasni ${days} ${days === 1 ? 'dan' : 'dana'}`;
}

/** Upozorenje ako je rok važenja prošao. */
export function validityWarn(validUntil: string | null): boolean {
  if (!validUntil) return false;
  return validUntil < new Date().toLocaleDateString('sv-SE');
}
