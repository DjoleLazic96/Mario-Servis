/**
 * Centralni spisak statusa — jedini izvor istine (spec §5).
 * Isti nazivi u bazi, kodu i API-ju (engleski); prevod za UI je u `labels`.
 * Vrednosti se NE menjaju bez migracije baze (enum tipovi u baza-shema.sql).
 */

export const WORK_ORDER_STATUS = ['open', 'in_progress', 'waiting_parts', 'completed', 'cancelled'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUS)[number];

export const QUOTE_STATUS = ['pending', 'accepted', 'rejected', 'expired'] as const;
export type QuoteStatus = (typeof QUOTE_STATUS)[number];

export const PROFORMA_STATUS = ['valid', 'used', 'expired'] as const;
export type ProformaStatus = (typeof PROFORMA_STATUS)[number];

export const INVOICE_STATUS = ['unpaid', 'paid', 'voided'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[number];

export const DOCUMENT_TYPE = ['quote', 'proforma', 'invoice'] as const;
export type DocumentType = (typeof DOCUMENT_TYPE)[number];

/** Svi statusi dokumenta (unija po tipu — spec §5). */
export type DocumentStatus = QuoteStatus | ProformaStatus | InvoiceStatus;

export const APPOINTMENT_STATUS = ['scheduled', 'completed', 'cancelled', 'no_show'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUS)[number];

export const REMINDER_SEND_STATUS = ['scheduled', 'processing', 'sent', 'failed'] as const;
export type ReminderSendStatus = (typeof REMINDER_SEND_STATUS)[number];

export const ARCHIVE_STATUS = ['active', 'archived'] as const;
export type ArchiveStatus = (typeof ARCHIVE_STATUS)[number];

export const MECHANIC_STATUS = ['active', 'inactive'] as const;
export type MechanicStatus = (typeof MECHANIC_STATUS)[number];

export const MECHANIC_SPECIALTY = ['mechanical', 'electrical', 'other'] as const;
export type MechanicSpecialty = (typeof MECHANIC_SPECIALTY)[number];

export const USER_ROLE = ['admin', 'user'] as const;
export type UserRole = (typeof USER_ROLE)[number];

export const USER_STATUS = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export const CUSTOMER_TYPE = ['individual', 'company'] as const;
export type CustomerType = (typeof CUSTOMER_TYPE)[number];

/** Način obračuna stavke rada (BR-43). */
export const LABOR_BILLING_UNIT = ['hour', 'km', 'flat'] as const;
export type LaborBillingUnit = (typeof LABOR_BILLING_UNIT)[number];

/** Ishod izlaska na teren (BR-42). customer_declined NIJE status naloga. */
export const FIELD_VISIT_OUTCOME = ['solved_on_site', 'arrives_driving', 'arrives_towed', 'customer_declined'] as const;
export type FieldVisitOutcome = (typeof FIELD_VISIT_OUTCOME)[number];

export const DOCUMENT_RELATION_TYPE = ['copied_from', 'converted_from', 'correction_of'] as const;
export type DocumentRelationType = (typeof DOCUMENT_RELATION_TYPE)[number];

/**
 * Srpski nazivi za UI (spec §3, §5). Baza/kod ostaju engleski.
 */
export const labels = {
  workOrderStatus: {
    open: 'Otvoren',
    in_progress: 'U radu',
    waiting_parts: 'Čeka delove',
    completed: 'Završeno',
    cancelled: 'Otkazano',
  } satisfies Record<WorkOrderStatus, string>,
  quoteStatus: {
    pending: 'Na čekanju',
    accepted: 'Prihvaćena',
    rejected: 'Odbijena',
    expired: 'Istekla',
  } satisfies Record<QuoteStatus, string>,
  proformaStatus: {
    valid: 'Važi',
    used: 'Iskorišćen',
    expired: 'Istekao',
  } satisfies Record<ProformaStatus, string>,
  invoiceStatus: {
    unpaid: 'Neplaćeno',
    paid: 'Plaćeno',
    voided: 'Neispravan',
  } satisfies Record<InvoiceStatus, string>,
  appointmentStatus: {
    scheduled: 'Zakazano',
    completed: 'Realizovano',
    cancelled: 'Otkazano',
    no_show: 'Nije se pojavio',
  } satisfies Record<AppointmentStatus, string>,
  reminderStatus: {
    scheduled: 'Zakazan',
    processing: 'Šalje se',
    sent: 'Poslat',
    failed: 'Neuspeo',
    skipped: 'Preskočen (bez emaila)',
  } as Record<string, string>,
  documentType: {
    quote: 'Ponuda',
    proforma: 'Predračun',
    invoice: 'Račun',
  } satisfies Record<DocumentType, string>,
  laborBillingUnit: {
    hour: 'Po satu',
    km: 'Po kilometru',
    flat: 'Paušalno',
  } satisfies Record<LaborBillingUnit, string>,
  fieldVisitOutcome: {
    solved_on_site: 'Rešeno na terenu',
    arrives_driving: 'Dolazi na točkovima',
    arrives_towed: 'Dolazi na šlepu',
    customer_declined: 'Klijent odustao',
  } satisfies Record<FieldVisitOutcome, string>,
  specialty: {
    mechanical: 'Mehaničar',
    electrical: 'Električar',
    other: 'Drugo',
  } satisfies Record<MechanicSpecialty, string>,
  unavailabilityKind: {
    vacation: 'Godišnji',
    sick_leave: 'Bolovanje',
  } satisfies Record<'vacation' | 'sick_leave', string>,
} as const;

/** Poslovni prefiksi brojeva dokumenata (spec §4.7). */
export const NUMBER_PREFIX = {
  quote: 'P',
  work_order: 'RN',
  proforma: 'PR',
  invoice: 'R',
} as const;
