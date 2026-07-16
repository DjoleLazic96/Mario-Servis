/**
 * Katalog mašinskih kodova poslovnih grešaka (spec §8).
 * Backend vraća { code, message, ... }; front prepoznaje po `code`.
 */
export const ERROR_CODE = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'TOO_MANY_ATTEMPTS',
  'FORBIDDEN',
  'CSRF_FAILED',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'DUPLICATE_VIN',
  'DUPLICATE_TAX_ID',
  'DUPLICATE_EMAIL',
  'CONFIRMATION_REQUIRED',
  'TRANSITION_NOT_ALLOWED',
  'ENTITY_LOCKED',
  'ENTITY_ARCHIVED',
  'LABOR_BILLING_INVALID',
  'QUOTE_NOT_PENDING',
  'QUOTE_NOT_ACCEPTED',
  'QUOTE_EXPIRED',
  'ACTIVE_PROFORMA_EXISTS',
  'PROFORMA_NOT_VALID',
  'WORK_ORDER_CANCELLED',
  'ACTIVE_INVOICE_EXISTS',
  'INVOICE_NOT_UNPAID',
  'INVOICE_NOT_PAID',
  'INVOICE_DIRECT_CREATE_FORBIDDEN',
  'COPY_NOT_ALLOWED',
  'SNAPSHOT_IMMUTABLE',
  'APPOINTMENT_LINKED',
  'APPOINTMENT_STARTED',
  'CALENDAR_BLOCKED',
  'REASON_REQUIRED',
  'NO_CUSTOMER_EMAIL',
  'BACKUP_FAILED',
  'BACKUP_UNUSABLE',
  'RESTORE_FAILED',
  'SMTP_FAILED',
  'PHOTO_LIMIT_REACHED',
  'PHOTO_NOT_FOUND',
] as const;
export type ErrorCode = (typeof ERROR_CODE)[number];

export interface ApiError {
  code: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  warnings?: string[];
  existingId?: number;
}
