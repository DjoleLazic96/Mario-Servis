import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkOrder, WorkOrderDetail, Paginated } from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { Modal } from '../components/Modal.tsx';
import { formatDate } from '../lib/documentHelpers.ts';
import { Highlight } from '../components/Highlight.tsx';

/**
 * Reklamacije na jednom mestu: spisak svih reklamacionih naloga + „Nova reklamacija"
 * gde se bira ZAVRŠEN nalog na koji se vezuje. Isti mehanizam kao dugme na samom nalogu,
 * samo drugi ulaz — za slučaj kad kreneš od menija, a ne od konkretnog naloga.
 */
export function Reklamacije(): React.JSX.Element {
  const navigate = useNavigate();
  const [list, setList] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<Paginated<WorkOrder>>('/work-orders?reklamacija=true&pageSize=200&sort=received');
      setList(r.data);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <h1>Reklamacije</h1>
          <p className="page-sub">{list.length} {list.length === 1 ? 'reklamacija' : 'reklamacija'}</p>
        </div>
        <button className="btn-primary" onClick={() => setPicking(true)}>+ Nova reklamacija</button>
      </header>

      {loading ? (
        <p className="card-empty">Učitavanje…</p>
      ) : list.length === 0 ? (
        <p className="card-empty">Još nema reklamacija. „Nova reklamacija" otvara nalog vezan za neki završen.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Reklamacija</th><th>Original</th><th>Tablica</th><th>Klijent</th><th>Datum</th><th>Status</th></tr>
            </thead>
            <tbody>
              {list.map((w) => (
                <tr key={w.id} className="clickable" onClick={() => navigate(`/nalozi/${w.id}`)}>
                  <td className="mono strong">{w.number}</td>
                  <td className="mono">
                    <button className="btn-link" onClick={(e) => { e.stopPropagation(); navigate(`/nalozi/${w.sourceWorkOrderId}`); }}>
                      {w.sourceWorkOrderNumber}
                    </button>
                  </td>
                  <td className="mono">{w.vehicle.plate ?? '—'}</td>
                  <td>{w.customer.name}</td>
                  <td className="mono">{formatDate(w.receivedOn)}</td>
                  <td>{w.status === 'completed' ? 'Završeno' : w.status === 'cancelled' ? 'Otkazano' : 'U toku'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picking && (
        <Modal title="Nova reklamacija — izaberi završen nalog" onClose={() => setPicking(false)} width={640}>
          <PickCompleted onDone={(id) => navigate(`/nalozi/${id}`)} />
        </Modal>
      )}
    </div>
  );
}

/** Bira ZAVRŠEN nalog (mušterija se vraća zbog gotovog posla) i pravi reklamaciju. */
function PickCompleted({ onDone }: { onDone: (newId: number) => void }): React.JSX.Element {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<WorkOrder[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      const qs = new URLSearchParams({ status: 'completed', pageSize: '20', sort: 'received' });
      if (q.trim()) qs.set('q', q.trim());
      const r = await api.get<Paginated<WorkOrder>>(`/work-orders?${qs.toString()}`);
      setResults(r.data);
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [q]);

  async function pick(w: WorkOrder): Promise<void> {
    setBusy(true); setErr(null);
    try {
      const nova = await api.post<WorkOrderDetail>(`/work-orders/${w.id}/reklamacija`, {});
      onDone(nova.id);
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.body.message : 'Greška.');
      setBusy(false);
    }
  }

  return (
    <div className="form">
      <input className="search" placeholder="Broj naloga, klijent, tablica…" value={q}
        onChange={(e) => setQ(e.target.value)} autoFocus />
      {err && <div className="login-error">{err}</div>}
      {results.length === 0 ? (
        <p className="card-empty">Nema završenih naloga za ovaj pojam.</p>
      ) : (
        <table className="data-table">
          <thead><tr><th>Broj</th><th>Tablica</th><th>Klijent</th><th>Datum</th><th></th></tr></thead>
          <tbody>
            {results.map((w) => (
              <tr key={w.id}>
                <td className="mono strong"><Highlight text={w.number} q={q} /></td>
                <td className="mono"><Highlight text={w.vehicle.plate ?? '—'} q={q} /></td>
                <td><Highlight text={w.customer.name} q={q} /></td>
                <td className="mono">{formatDate(w.receivedOn)}</td>
                <td className="ta-r"><button className="btn-secondary btn-sm" disabled={busy} onClick={() => pick(w)}>Reklamacija</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
