import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Document, Paginated } from '@karton/shared';
import { api } from '../api.ts';
import { Modal } from '../components/Modal.tsx';
import { QuoteForm } from '../components/QuoteForm.tsx';
import { docTypeLabel, docStatusLabel, docStatusClass, money, formatDate } from '../lib/documentHelpers.ts';
import { SortableTh } from '../components/SortableTh.tsx';

type Tab = 'all' | 'quote' | 'proforma' | 'invoice' | 'unpaid';
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'Svi' },
  { key: 'quote', label: 'Ponude' },
  { key: 'proforma', label: 'Predračuni' },
  { key: 'invoice', label: 'Računi' },
  { key: 'unpaid', label: 'Neplaćeno' },
];

function params(tab: Tab): string {
  if (tab === 'unpaid') return 'unpaid=true';
  if (tab === 'all') return '';
  return `type=${tab}`;
}

export function Documents(): React.JSX.Element {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<string | undefined>();
  const [result, setResult] = useState<Paginated<Document> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams(params(tab));
    p.set('page', String(page));
    if (sort) p.set('sort', sort);
    if (q.trim()) p.set('q', q.trim());
    try { setResult(await api.get<Paginated<Document>>(`/documents?${p.toString()}`)); }
    finally { setLoading(false); }
  }, [tab, page, q, sort]);

  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  const doSort = (next: string): void => { setSort(next); setPage(1); };

  const meta = result?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="page">
      <header className="page-head row">
        <div><h1>Dokumenti</h1>{meta && <p className="page-sub">{meta.total} ukupno</p>}</div>
        <button className="btn-primary" onClick={() => setShowNew(true)}>+ Nova ponuda</button>
      </header>

      <div className="toolbar">
        <div className="tabs">
          {TABS.map((t) => <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => { setTab(t.key); setPage(1); }}>{t.label}</button>)}
        </div>
        <input className="search" placeholder="Broj dokumenta, klijent…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>
            <SortableTh field="number" label="Broj" sort={sort} onSort={doSort} />
            <SortableTh field="type" label="Tip" sort={sort} onSort={doSort} />
            <SortableTh field="customer" label="Klijent" sort={sort} onSort={doSort} />
            <th>Vozilo</th>
            <SortableTh field="issued" label="Datum" sort={sort} onSort={doSort} />
            <SortableTh field="total" label="Iznos" sort={sort} onSort={doSort} right />
            <SortableTh field="status" label="Status" sort={sort} onSort={doSort} />
          </tr></thead>
          <tbody>
            {result?.data.map((d) => (
              <tr key={d.id} className="clickable" onClick={() => navigate(`/dokumenti/${d.id}`)}>
                <td className="mono strong" data-label="Broj">{d.number}</td>
                <td data-label="Tip">{docTypeLabel[d.type]}</td>
                <td data-label="Klijent">{d.customer.name}</td>
                <td data-label="Vozilo"><span className="mono">{d.vehicle.plate ?? '—'}</span> {d.vehicle.make} {d.vehicle.model}</td>
                <td className="mono" data-label="Datum">{formatDate(d.issuedOn)}</td>
                <td className="ta-r mono" data-label="Iznos">{money(d.totalAmount)}</td>
                <td data-label="Status"><span className={`badge ${docStatusClass[d.status]}`}>{docStatusLabel(d.type, d.status)}</span></td>
              </tr>
            ))}
            {!loading && result?.data.length === 0 && <tr><td colSpan={7} className="table-empty">Nema dokumenata.</td></tr>}
          </tbody>
        </table>
      </div>

      {meta && totalPages > 1 && (
        <div className="pager">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prethodna</button>
          <span>Strana {page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Sledeća ›</button>
        </div>
      )}

      {showNew && (
        <Modal title="Nova ponuda" onClose={() => setShowNew(false)} width={560}>
          <QuoteForm onCreated={(id) => { setShowNew(false); navigate(`/dokumenti/${id}`); }} />
        </Modal>
      )}
    </div>
  );
}
