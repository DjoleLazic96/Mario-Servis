/**
 * Poslovni datumi se računaju u Europe/Belgrade (spec §4.16), iako proces radi u UTC.
 */
const BELGRADE = 'Europe/Belgrade';

/** Današnji datum u Beogradu kao 'YYYY-MM-DD'. */
export function todayBelgrade(): string {
  // sv-SE format daje ISO-sličan 'YYYY-MM-DD'
  return new Date().toLocaleDateString('sv-SE', { timeZone: BELGRADE });
}

/** Dodaj N dana na 'YYYY-MM-DD' (za rok važenja). Radi po kalendarskom datumu. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
