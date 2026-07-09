import type { PoolClient } from 'pg';
import { NUMBER_PREFIX } from '@karton/shared';
import { todayBelgrade } from './time.ts';

type DocKind = keyof typeof NUMBER_PREFIX; // quote | work_order | proforma | invoice

/**
 * Sledeći poslovni broj (BR-24): transakciono, preko number_sequence, uz atomski
 * upsert (bez MAX+1). Godišnja sekvenca po tipu; format PREFIX-GODINA-NNNN.
 * MORA se pozvati unutar iste transakcije kao INSERT dokumenta/naloga.
 */
export async function nextNumber(client: PoolClient, kind: DocKind): Promise<string> {
  const year = Number(todayBelgrade().slice(0, 4));
  const { rows } = await client.query<{ last_number: number }>(
    `INSERT INTO number_sequence (doc_type, year, last_number) VALUES ($1, $2, 1)
     ON CONFLICT (doc_type, year) DO UPDATE SET last_number = number_sequence.last_number + 1
     RETURNING last_number`,
    [kind, year],
  );
  const n = rows[0]!.last_number;
  return `${NUMBER_PREFIX[kind]}-${year}-${String(n).padStart(4, '0')}`;
}
