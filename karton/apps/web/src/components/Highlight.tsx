/**
 * Boji žutim deo teksta koji je pogodio pretragu.
 *
 * Poređenje mora da prati server (`normalizeSearch`: mala slova + izbačeni razmaci),
 * inače bi „marko mark" pronašlo red ali ne bi obojilo ništa — što izgleda kao pokvareno
 * bojenje, a zapravo je nesklad dve različite pretrage. Zato se traži nad normalizovanim
 * tekstom, pa se pogodak vraća na položaj u originalu preko mape indeksa.
 */
export function Highlight({ text, q }: { text: string | null | undefined; q: string }): React.JSX.Element {
  const src = String(text ?? '');
  const needle = q.trim().toLowerCase().replace(/\s+/g, '');
  if (!needle || !src) return <>{src}</>;

  // norm[i] potiče od src[map[i]] — razmaci ispadaju, pa se pogodak preko njih preslikava nazad.
  const map: number[] = [];
  let norm = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (/\s/.test(ch)) continue;
    norm += ch.toLowerCase();
    map.push(i);
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let from = 0;
  for (let k = 0; ; k++) {
    const hit = norm.indexOf(needle, from);
    if (hit === -1) break;
    const start = map[hit]!;
    const end = map[hit + needle.length - 1]! + 1;
    if (start > cursor) parts.push(src.slice(cursor, start));
    parts.push(<mark key={k}>{src.slice(start, end)}</mark>);
    cursor = end;
    from = hit + needle.length;
  }
  if (parts.length === 0) return <>{src}</>;
  parts.push(src.slice(cursor));
  return <>{parts}</>;
}
