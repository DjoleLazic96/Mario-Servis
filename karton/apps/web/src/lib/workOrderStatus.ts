import type { WorkOrderStatus } from '@karton/shared';

const ACTIVE: WorkOrderStatus[] = ['open', 'in_progress', 'waiting_parts'];

/** Ogledalo backend mašine (§6) — samo za UX; backend je konačni autoritet. */
export function allowedTransitions(from: WorkOrderStatus, isAdmin: boolean): { to: WorkOrderStatus; adminOnly: boolean }[] {
  const out: { to: WorkOrderStatus; adminOnly: boolean }[] = [];
  if (ACTIVE.includes(from)) {
    for (const s of ACTIVE) if (s !== from) out.push({ to: s, adminOnly: false });
    out.push({ to: 'completed', adminOnly: false });
    out.push({ to: 'cancelled', adminOnly: false });
  }
  if (from === 'completed') { out.push({ to: 'in_progress', adminOnly: true }); out.push({ to: 'open', adminOnly: true }); }
  if (from === 'cancelled') { out.push({ to: 'open', adminOnly: true }); }
  return out.filter((t) => isAdmin || !t.adminOnly);
}

export const isEditable = (s: WorkOrderStatus): boolean => ACTIVE.includes(s);

export const statusClass: Record<WorkOrderStatus, string> = {
  open: 'st-open',
  in_progress: 'st-progress',
  waiting_parts: 'st-wait',
  completed: 'st-done',
  cancelled: 'st-cancel',
};
