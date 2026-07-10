import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkOrder, WorkOrderInput, WorkOrderStatus, Paginated } from '@karton/shared';
import { labels } from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { Modal } from '../components/Modal.tsx';
import { WorkOrderForm } from '../components/WorkOrderForm.tsx';
import { statusClass } from '../lib/workOrderStatus.ts';
import { SortableTh } from '../components/SortableTh.tsx';

const TABS: { key: WorkOrderStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'Svi' },
  { key: 'open', label: 'Otvoren' },
  { key: 'in_progress', label: 'U radu' },
  { key: 'waiting_parts', label: 'Čeka delove' },
  { key: 'completed', label: 'Završeno' },
  { key: 'cancelled', label: 'Otkazano' },
];

export function WorkOrders(): React.JSX.Element {
  const navigate = useNavigate();
  const [tab, setTab] = useState<WorkOrderStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<string | undefined>();
  const [result, setResult] = useState<Paginated<WorkOrder> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (sort) params.set('sort', sort);
    if (tab !== 'all') params.set('status', tab);
    if (q.trim()) params.set('q', q.trim());
    try { setResult(await api.get<Paginated<WorkOrder>>(`/work-orders?${params.toString()}`)); }
    finally { setLoading(false); }
  }, [tab, page, q, sort]);

  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  async function create(input: WorkOrderInput): Promise<void> {
    setSaving(true); setFormError(null);
    try {
      const created = await api.post<WorkOrder>('/work-orders', input);
      setShowNew(false);
      navigate(`/nalozi/${created.id}`);
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.body.message : 'Greška pri otvaranju naloga.');
    } finally { setSaving(false); }
  }

  const doSort = (next: string): void => { setSort(next); setPage(1); };

  const meta = result?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="page">
      <header className="page-head row">
        <div><h1>Radni nalozi</h1>{meta && <p className="page-sub">{meta.total} ukupno</p>}</div>
        <button className="btn-primary" onClick={() => { setFormError(null); setShowNew(true); }}>+ Novi nalog</button>
      </header>

      <div className="toolbar">
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => { setTab(t.key); setPage(1); }}>{t.label}</button>
          ))}
        </div>
        <input className="search" placeholder="Broj naloga, klijent, tablica…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>
            <SortableTh field="number" label="Broj" sort={sort} onSort={doSort} />
            <SortableTh field="plate" label="Vozilo" sort={sort} onSort={doSort} />
            <SortableTh field="customer" label="Klijent" sort={sort} onSort={doSort} />
            <SortableTh field="received" label="Prijem" sort={sort} onSort={doSort} />
            <SortableTh field="status" label="Status" sort={sort} onSort={doSort} />
          </tr></thead>
          <tbody>
            {result?.data.map((w) => (
              <tr key={w.id} className="clickable" onClick={() => navigate(`/nalozi/${w.id}`)}>
                <td className="mono strong">{w.number}</td>
                <td><span className="mono">{w.vehicle.plate ?? '—'}</span> {w.vehicle.make} {w.vehicle.model}</td>
                <td>{w.customer.name}</td>
                <td className="mono">{w.receivedOn}</td>
                <td><span className={`badge ${statusClass[w.status]}`}>{labels.workOrderStatus[w.status]}</span></td>
              </tr>
            ))}
            {!loading && result?.data.length === 0 && <tr><td colSpan={5} className="table-empty">Nema naloga za ovaj filter.</td></tr>}
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
        <Modal title="Novi radni nalog" onClose={() => setShowNew(false)} width={540}>
          <WorkOrderForm submitting={saving} error={formError} onSubmit={create} />
        </Modal>
      )}
    </div>
  );
}
