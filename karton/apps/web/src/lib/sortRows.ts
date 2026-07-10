/**
 * Sortiranje na klijentu — samo za male, nepaginirane liste (majstori, usluge, korisnici).
 * Velike liste (klijenti, vozila, nalozi, dokumenti) sortira server, jer se sortira cela
 * tabela a ne samo tekuća strana.
 */
export type SortSpec = string | undefined; // "polje:asc" | "polje:desc"

const collator = new Intl.Collator('sr-RS', { sensitivity: 'base', numeric: true });

export function sortRows<T>(rows: T[], sort: SortSpec, pick: (row: T, field: string) => unknown): T[] {
  if (!sort) return rows;
  const [field, dir] = sort.split(':');
  if (!field) return rows;
  const sign = dir === 'desc' ? -1 : 1;

  return [...rows].sort((a, b) => {
    const av = pick(a, field);
    const bv = pick(b, field);
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;   // prazno uvek na dno
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
    return collator.compare(String(av), String(bv)) * sign;
  });
}
