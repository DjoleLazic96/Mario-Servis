/**
 * Pomoćnici za server-side liste (spec §4.17): paginacija, sortiranje, pretraga.
 * Sortiranje koristi whitelist kolona (bez SQL injekcije).
 */

export interface ListParams {
  page: number;
  pageSize: number;
  sort: string | undefined;
  q: string | undefined;
}

export function parseListParams(query: Record<string, unknown>, defaultPageSize = 20): ListParams {
  const page = Math.max(1, toInt(query['page'], 1));
  const pageSize = Math.min(200, Math.max(1, toInt(query['pageSize'], defaultPageSize)));
  const sort = typeof query['sort'] === 'string' ? query['sort'] : undefined;
  const q = typeof query['q'] === 'string' && query['q'].trim() !== '' ? query['q'] : undefined;
  return { page, pageSize, sort, q };
}

export function offset(p: ListParams): number {
  return (p.page - 1) * p.pageSize;
}

/**
 * ORDER BY iz `field:dir`, samo nad dozvoljenim kolonama.
 * `allowed` mapira javno ime → SQL izraz. Fallback kad sort nije prosleđen/nedozvoljen.
 */
export function orderBy(
  sort: string | undefined,
  allowed: Record<string, string>,
  fallback: string,
): string {
  if (!sort) return fallback;
  const [field, dirRaw] = sort.split(':');
  const col = field ? allowed[field] : undefined;
  if (!col) return fallback;
  const dir = dirRaw?.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return `${col} ${dir}`;
}

/** Normalizacija za pretragu: mala slova, bez razmaka (spec §4.17: `golf7` = „Golf 7"). */
export function normalizeSearch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

function toInt(v: unknown, dflt: number): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : dflt;
}
