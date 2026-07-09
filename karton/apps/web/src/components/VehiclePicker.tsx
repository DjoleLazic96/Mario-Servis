import { useEffect, useState } from 'react';
import type { Vehicle, VehicleInput, Paginated } from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { Modal } from './Modal.tsx';
import { VehicleForm } from './VehicleForm.tsx';

/** Izbor vozila: pretraga postojećih ili „+ Novo vozilo" kroz ugnježdeni modal. */
export function VehiclePicker({
  value,
  onChange,
}: {
  value: Vehicle | null;
  onChange: (v: Vehicle) => void;
}): React.JSX.Element {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Vehicle[]>([]);
  const [open, setOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || q.trim().length < 1) { setResults([]); return; }
    const t = setTimeout(async () => {
      const r = await api.get<Paginated<Vehicle>>(`/vehicles?status=active&q=${encodeURIComponent(q.trim())}&pageSize=8`);
      setResults(r.data);
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  function pick(v: Vehicle): void { onChange(v); setOpen(false); setQ(''); }

  async function createVehicle(input: VehicleInput): Promise<void> {
    setSaving(true); setError(null);
    try {
      pick(await api.post<Vehicle>('/vehicles', input));
      setShowNew(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? (err.body.existingId ? `${err.body.message} (#${err.body.existingId})` : err.body.message) : 'Greška.');
    } finally { setSaving(false); }
  }

  if (value && !open) {
    return (
      <div className="owner-picked">
        <span className="owner-name mono">{value.currentPlate ?? 'bez tablice'}</span>
        <span>{value.make} {value.model}{value.year ? ` · ${value.year}` : ''}</span>
        <span className="owner-type">{value.currentOwner?.name ?? 'bez vlasnika'}</span>
        <button type="button" className="btn-link" onClick={() => setOpen(true)}>promeni</button>
      </div>
    );
  }

  return (
    <div className="owner-picker">
      <div className="owner-search-row">
        <input className="owner-search" placeholder="Tablica, VIN, marka/model…" value={q}
          onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)} autoFocus={open} />
        <button type="button" className="btn-secondary btn-sm" onClick={() => { setError(null); setShowNew(true); }}>+ Novo vozilo</button>
      </div>
      {open && results.length > 0 && (
        <ul className="owner-results">
          {results.map((v) => (
            <li key={v.id} onClick={() => pick(v)}>
              <span className="strong mono">{v.currentPlate ?? '—'}</span>
              <span>{v.make} {v.model}</span>
              <span className="owner-type">{v.currentOwner?.name ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}
      {showNew && (
        <Modal title="Novo vozilo" onClose={() => setShowNew(false)} width={520}>
          <VehicleForm mode="create" submitting={saving} error={error} onSubmit={createVehicle} />
        </Modal>
      )}
    </div>
  );
}
