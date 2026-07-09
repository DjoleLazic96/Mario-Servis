import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Vehicle, VehicleInput, Paginated } from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { Modal } from '../components/Modal.tsx';
import { VehicleForm } from '../components/VehicleForm.tsx';

type Tab = 'active' | 'archived';

export function Vehicles(): React.JSX.Element {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('active');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<Vehicle> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ status: tab, page: String(page) });
    if (q.trim()) params.set('q', q.trim());
    try {
      setResult(await api.get<Paginated<Vehicle>>(`/vehicles?${params.toString()}`));
    } finally {
      setLoading(false);
    }
  }, [tab, page, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function createVehicle(input: VehicleInput): Promise<void> {
    setSaving(true);
    setFormError(null);
    try {
      const created = await api.post<Vehicle>('/vehicles', input);
      setShowNew(false);
      navigate(`/vozila/${created.id}`);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setFormError(
          err.body.existingId ? `${err.body.message} (postojeće vozilo #${err.body.existingId})` : err.body.message,
        );
      } else setFormError('Greška pri čuvanju.');
    } finally {
      setSaving(false);
    }
  }

  const meta = result?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <h1>Vozila</h1>
          {meta && <p className="page-sub">{meta.total} ukupno</p>}
        </div>
        <button className="btn-primary" onClick={() => { setFormError(null); setShowNew(true); }}>
          + Novo vozilo
        </button>
      </header>

      <div className="toolbar">
        <div className="tabs">
          <button className={`tab ${tab === 'active' ? 'active' : ''}`} onClick={() => { setTab('active'); setPage(1); }}>
            Aktivna
          </button>
          <button className={`tab ${tab === 'archived' ? 'active' : ''}`} onClick={() => { setTab('archived'); setPage(1); }}>
            Arhivirana
          </button>
        </div>
        <input
          className="search"
          placeholder="Pretraga (tablica, VIN, marka/model)…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Tablica</th>
              <th>Vozilo</th>
              <th>Gorivo</th>
              <th>Vlasnik</th>
              <th>VIN</th>
            </tr>
          </thead>
          <tbody>
            {result?.data.map((v) => (
              <tr key={v.id} className="clickable" onClick={() => navigate(`/vozila/${v.id}`)}>
                <td className="mono strong">{v.currentPlate ?? '—'}</td>
                <td>
                  {v.make} {v.model}
                  {v.year ? <span className="muted"> · {v.year}</span> : null}
                </td>
                <td>{v.fuel ?? '—'}</td>
                <td>{v.currentOwner?.name ?? '—'}</td>
                <td className="mono muted">{v.vin}</td>
              </tr>
            ))}
            {!loading && result?.data.length === 0 && (
              <tr>
                <td colSpan={5} className="table-empty">Nema vozila za ovaj filter.</td>
              </tr>
            )}
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
        <Modal title="Novo vozilo" onClose={() => setShowNew(false)} width={520}>
          <VehicleForm mode="create" submitting={saving} error={formError} onSubmit={createVehicle} />
        </Modal>
      )}
    </div>
  );
}
