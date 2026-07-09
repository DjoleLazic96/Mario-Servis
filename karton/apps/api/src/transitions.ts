import type { WorkOrderStatus } from '@karton/shared';

/** Ko sme tranziciju: 'user' (svi), 'admin' (samo admin, uz audit/razlog), false (zabranjeno). */
export type TransitionRight = 'user' | 'admin' | false;

const WO_ACTIVE: WorkOrderStatus[] = ['open', 'in_progress', 'waiting_parts'];

/**
 * Dozvoljene tranzicije radnog naloga (spec §6).
 * Aktivni statusi se slobodno menjaju; → completed/cancelled korisnik;
 * povratak iz completed/cancelled samo admin (uz razlog i audit — BR-34).
 */
export function workOrderTransition(from: WorkOrderStatus, to: WorkOrderStatus): TransitionRight {
  if (from === to) return false;
  const fromActive = WO_ACTIVE.includes(from);
  if (fromActive && WO_ACTIVE.includes(to)) return 'user';
  if (fromActive && (to === 'completed' || to === 'cancelled')) return 'user';
  if (from === 'completed' && (to === 'in_progress' || to === 'open')) return 'admin';
  if (from === 'cancelled' && to === 'open') return 'admin';
  return false;
}

/** Nalog je editabilan (stavke, zaglavlje) samo u aktivnim statusima (BR-08). */
export function isWorkOrderEditable(status: WorkOrderStatus): boolean {
  return WO_ACTIVE.includes(status);
}
