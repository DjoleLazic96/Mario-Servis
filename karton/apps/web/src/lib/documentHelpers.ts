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

/** Izvedena UI oznaka dospeća računa (BR-31): „dospeo" nije status. */
export function dueInfo(dueOn: string | null): { text: string; warn: boolean } | null {
  if (!dueOn) return null;
  const today = new Date().toLocaleDateString('sv-SE');
  if (dueOn < today) {
    const days = Math.round((Date.parse(today) - Date.parse(dueOn)) / 86400000);
    return { text: `kasni ${days} ${days === 1 ? 'dan' : 'dana'}`, warn: true };
  }
  return { text: `dospeva ${dueOn}`, warn: false };
}

/** Upozorenje ako je rok važenja prošao. */
export function validityWarn(validUntil: string | null): boolean {
  if (!validUntil) return false;
  return validUntil < new Date().toLocaleDateString('sv-SE');
}
