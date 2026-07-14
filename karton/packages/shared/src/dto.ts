import type {
  ArchiveStatus,
  CustomerType,
  MechanicSpecialty,
  MechanicStatus,
  WorkOrderStatus,
  LaborBillingUnit,
  FieldVisitOutcome,
  DocumentType,
  DocumentStatus,
  DocumentRelationType,
} from './statuses.ts';

/** Paginirani odgovor liste (spec §4.17). */
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}
export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export interface Contact {
  id: number;
  kind: 'phone' | 'email';
  value: string;
  isPrimary: boolean;
}

export interface Customer {
  id: number;
  type: CustomerType;
  name: string;
  taxId: string | null;
  address: string | null;
  status: ArchiveStatus;
  contacts: Contact[];
}

/** Unos pri kreiranju/izmeni klijenta (spec §4.2, BR-04). */
export interface CustomerInput {
  type: CustomerType;
  name: string;
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface ContactInput {
  kind: 'phone' | 'email';
  value: string;
  isPrimary?: boolean;
}

/** Lagana referenca na klijenta (bez kontakata) — za prikaz vlasnika i sl. */
export interface CustomerRef {
  id: number;
  name: string;
  type: CustomerType;
}

export interface Vehicle {
  id: number;
  vin: string;
  make: string;
  model: string;
  year: number | null;
  fuel: string | null;
  note: string | null;
  status: ArchiveStatus;
  currentPlate: string | null;
  currentOwner: CustomerRef | null;
}

/** VIN je nepromenljiv (BR-01) — u izmeni se ne šalje. */
export interface VehicleInput {
  vin: string;
  make: string;
  model: string;
  year?: number | null;
  fuel?: string | null;
  plate?: string | null;
  ownerId?: number | null;
  note?: string | null;
}

export interface OwnershipRecord {
  id: number;
  customer: CustomerRef;
  validFrom: string;
  validTo: string | null;
}

export interface RegistrationRecord {
  id: number;
  plate: string;
  validFrom: string;
  validTo: string | null;
  note: string | null;
}

// --- Majstori i cenovnik usluga ---

export type UnavailabilityKind = 'vacation' | 'sick_leave';

export interface Mechanic {
  id: number;
  fullName: string;
  hiredOn: string | null;
  hourlyRate: number;
  specialty: MechanicSpecialty;
  status: MechanicStatus;
}

export interface MechanicInput {
  fullName: string;
  hiredOn?: string | null;
  hourlyRate: number;
  specialty: MechanicSpecialty;
  status?: MechanicStatus;
}

export interface Unavailability {
  id: number;
  fromDate: string;
  toDate: string;
  kind: UnavailabilityKind;
}

export interface UnavailabilityInput {
  fromDate: string;
  toDate: string;
  kind: UnavailabilityKind;
}

/** Cenovnik usluga — paušal ili po km (satni rad ide preko cenovnika majstora). */
export type ServiceBillingUnit = 'km' | 'flat';

export interface Service {
  id: number;
  name: string;
  billingUnit: ServiceBillingUnit;
  defaultPrice: number;
  status: MechanicStatus;
}

export interface ServiceInput {
  name: string;
  billingUnit: ServiceBillingUnit;
  defaultPrice: number;
  status?: MechanicStatus;
}

// --- Radni nalog ---

export interface VehicleRef {
  id: number;
  vin: string;
  make: string;
  model: string;
  plate: string | null;
}

export interface LaborItem {
  id: number;
  mechanicId: number;
  mechanicName: string;
  specialty: MechanicSpecialty;
  name: string;
  billingUnit: LaborBillingUnit;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
}

export interface PartItem {
  id: number;
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  internalNoCharge: boolean;
}

export interface ExternalItem {
  id: number;
  vendorName: string;
  description: string | null;
  price: number;
  note: string | null;
  internalNoCharge: boolean;
}

export interface WorkOrder {
  id: number;
  number: string;
  status: WorkOrderStatus;
  vehicle: VehicleRef;
  customer: CustomerRef;
  receivedOn: string;
  receivedTime: string | null;
  completedOn: string | null;
  completedTime: string | null;
  odometerKm: number | null;
  requestedWork: string | null;
  findings: string | null;
  note: string | null;
  sourceQuoteId: number | null;
  // Izlazak na teren (BR-41/42)
  fieldVisit: boolean;
  fieldVisitDate: string | null;
  fieldVisitTime: string | null;
  fieldVisitLocation: string | null;
  fieldVisitKm: number | null;
  vehicleDrivable: boolean | null;
  fieldVisitOutcome: FieldVisitOutcome | null;
  version: number;
}

/** Iznosi za klijenta — bez internih stavki (BR-09). */
export interface WorkOrderTotals {
  labor: number;
  parts: number;
  external: number;
  total: number;
}

export interface WorkOrderDetail extends WorkOrder {
  laborItems: LaborItem[];
  partItems: PartItem[];
  externalItems: ExternalItem[];
  totals: WorkOrderTotals;
  chain: DocumentChain;
}

/** Fotografija vozila snimljena pri prijemu (spec §4.4). Fajl je na disku; ovo je metapodatak. */
export interface WorkOrderPhoto {
  id: number;
  workOrderId: number;
  sizeBytes: number;
  createdAt: string;
  createdBy: string | null; // ime korisnika koji je slikao
}

/** Galerija na kartonu vozila: jedna grupa = jedna poseta (radni nalog). */
export interface VehiclePhotoGroup {
  workOrderId: number;
  workOrderNumber: string;
  receivedOn: string;
  photos: WorkOrderPhoto[];
}

/** Statistika vozila (spec §3.5). */
export interface VehicleStats {
  orders: number;
  totalSpent: number;
  lastVisit: string | null;
}

export interface BackupRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: 'success' | 'failed';
  destination: string | null;
  sizeBytes: number | null;
  error: string | null;
}

export interface WorkOrderInput {
  vehicleId: number;
  customerId?: number | null;
  receivedOn?: string;
  receivedTime?: string | null;
  completedOn?: string | null;
  completedTime?: string | null;
  odometerKm?: number | null;
  requestedWork?: string | null;
  findings?: string | null;
  note?: string | null;
  sourceQuoteId?: number | null;
  fieldVisit?: boolean;
  fieldVisitDate?: string | null;
  fieldVisitTime?: string | null;
  fieldVisitLocation?: string | null;
  fieldVisitKm?: number | null;
  vehicleDrivable?: boolean | null;
  fieldVisitOutcome?: FieldVisitOutcome | null;
  version?: number;
}

export interface LaborItemInput {
  mechanicId: number;
  name: string;
  billingUnit: LaborBillingUnit;
  quantity?: number | null;
  unitPrice?: number | null;
  amount?: number;
}

export interface PartItemInput {
  name: string;
  quantity: number;
  unitPrice: number;
  internalNoCharge?: boolean;
}

export interface ExternalItemInput {
  vendorName: string;
  description?: string | null;
  price: number;
  note?: string | null;
  internalNoCharge?: boolean;
}

// --- Dokumenti (ponuda / predračun / račun) ---

export interface DocumentItem {
  id: number;
  itemType: 'labor' | 'part' | 'external';
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
  laborGroup: MechanicSpecialty | null; // za satni rad grupisan po specijalnosti (BR-26)
  billingUnit: LaborBillingUnit | null;
}

/** Stavka koju front šalje pri kreiranju ponude (procena). */
export interface DocumentItemDraft {
  itemType: 'labor' | 'part' | 'external';
  name: string;
  quantity?: number | null;
  unitPrice?: number | null;
  amount: number;
  laborGroup?: MechanicSpecialty | null;
}

export interface Document {
  id: number;
  number: string;
  type: DocumentType;
  status: DocumentStatus;
  workOrderId: number | null;
  customer: CustomerRef;
  vehicle: VehicleRef;
  issuedOn: string;
  dueOn: string | null;
  validUntil: string | null;
  paidOn: string | null;
  paymentMethod: string | null;
  sourceDocumentId: number | null;
  sourceRelationType: DocumentRelationType | null;
  note: string | null;
  amountEur: number | null;
  totalAmount: number;
  version: number;
}

/** Referenca u dvorednoj dokument traci (spec §9). */
export interface DocumentChainRef {
  id: number;
  number: string;
  status: string;
}
export interface DocumentChain {
  quote: DocumentChainRef | null;
  workOrder: DocumentChainRef | null; // RN- čvor
  proforma: DocumentChainRef | null;
  invoice: DocumentChainRef | null;
}

export interface DocumentDetail extends Document {
  items: DocumentItem[];
  chain: DocumentChain;
}

export interface CreateQuoteInput {
  customerId: number;
  vehicleId: number;
  workOrderId?: number | null;
  validUntil?: string;
  amountEur?: number | null;
  note?: string | null;
  items: DocumentItemDraft[];
}

export interface CreateProformaInput {
  workOrderId: number;
  validUntil?: string;
  amountEur?: number | null;
  note?: string | null;
}

/** Izmena na valid predračunu — ISKLJUČIVO ova tri polja (BR-16). */
export interface UpdateProformaInput {
  validUntil?: string;
  amountEur?: number | null;
  note?: string | null;
  version: number;
}

// --- Termini / kalendar ---

export type AppointmentStatusT = 'scheduled' | 'completed' | 'cancelled' | 'no_show';
export type ReminderSendStatusT = 'scheduled' | 'processing' | 'sent' | 'failed' | 'skipped';

export interface Appointment {
  id: number;
  date: string;
  time: string;
  durationMin: number;
  customer: CustomerRef;
  vehicle: VehicleRef;
  mechanic: { id: number; fullName: string } | null;
  note: string | null;
  status: AppointmentStatusT;
  workOrderId: number | null;
  remindersEnabled: boolean;
  reminderStatus: ReminderSendStatusT | null;
  reminderReason: string | null; // razlog za skipped/failed (npr. „klijent nema email u trenutku slanja")
  version: number;
}

export interface AppointmentInput {
  date: string;
  time: string;
  durationMin?: number;
  customerId: number;
  vehicleId: number;
  mechanicId?: number | null;
  note?: string | null;
  remindersEnabled?: boolean;
  confirmed?: boolean; // potvrda mekih upozorenja (BR-27)
}

export interface CalendarBlock {
  id: number;
  fromDate: string;
  toDate: string;
  reason: string | null;
}
