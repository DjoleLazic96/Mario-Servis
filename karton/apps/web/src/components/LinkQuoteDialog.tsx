import { useEffect, useState } from 'react';
import type { Document, Paginated } from '@karton/shared';
import { api } from '../api.ts';
import { money, formatDate } from '../lib/documentHelpers.ts';

/**
 * Bira prihvaćenu ponudu istog vozila. Filtriramo na serveru po vozilu,
 * a status „prihvaćena" je jedini koji backend prima (BR-11) — pa ga ne nudimo ni ovde.
 */
export function LinkQuoteDialog({ vehicleId, onPick, busy }: {
  vehicleId: number;
  onPick: (quote: Document) => void;
  busy: boolean;
}): React.JSX.Element {
  const [quotes, setQuotes] = useState<Document[] | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await api.get<Paginated<Document>>(`/documents?type=quote&status=accepted&vehicleId=${vehicleId}&pageSize=50`);
      setQuotes(res.data);
    })();
  }, [vehicleId]);

  if (!quotes) return <p className="card-empty">Učitavanje…</p>;
  if (quotes.length === 0) {
    return <p className="card-empty">Nema prihvaćenih ponuda za ovo vozilo. Ponuda mora prvo da bude prihvaćena.</p>;
  }

  return (
    <table className="data-table">
      <thead><tr><th>Broj</th><th>Datum</th><th className="ta-r">Iznos</th><th></th></tr></thead>
      <tbody>
        {quotes.map((q) => (
          <tr key={q.id}>
            <td className="mono strong">{q.number}</td>
            <td className="mono">{formatDate(q.issuedOn)}</td>
            <td className="ta-r mono">{money(q.totalAmount)}</td>
            <td className="ta-r">
              <button className="btn-secondary" disabled={busy} onClick={() => onPick(q)}>Veži</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
