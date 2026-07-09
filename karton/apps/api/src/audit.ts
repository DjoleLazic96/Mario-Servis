import type { PoolClient } from 'pg';
import { pool } from './db.ts';

/**
 * Upis u audit log (BR-34, spec §11). Za osetljive admin akcije `reason` je obavezan
 * (proverava pozivalac). Audit se nikad ne briše.
 */
export interface AuditEntry {
  userId: number;
  entityType: string;
  entityId: number;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}

export async function writeAudit(entry: AuditEntry, client?: PoolClient): Promise<void> {
  const exec = client ?? pool;
  await exec.query(
    `INSERT INTO audit_log (user_id, entity_type, entity_id, action, old_value, new_value, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.userId,
      entry.entityType,
      entry.entityId,
      entry.action,
      entry.oldValue === undefined ? null : JSON.stringify(entry.oldValue),
      entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
      entry.reason ?? null,
    ],
  );
}
