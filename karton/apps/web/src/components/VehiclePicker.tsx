import { useEffect, useState } from 'react';
import type { Vehicle, VehicleInput, Paginated } from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { Modal } from './Modal.tsx';
import { VehicleForm } from './VehicleForm.tsx';

/** Izbor vozila: pretraga postojećih ili „+ Novo vozilo" kroz ugnježdeni modal. */
export function VehiclePicker({
  value,
  onChange,
  customerId,
}: {
  value: Vehicle | null;
  onChange: (v: Vehicle) => void;
  /**
   * Kad je klijent poznat, njegova vozila se nude ODMAH, bez kucanja — u servisu
   * čovek gotovo uvek dovozi svoje vozilo. Kucanje i dalje pretražuje sva vozila,
   * jer vozilo ume da promeni vlasnika pa se zatekne pod tuđim imenom.
   */
  customerId?: number | null;
}): React.JSX.Element {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Vehicle[]>([]);
  const [open, setOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const term = q.trim();
  const listingOwned = Boolean(customerId) && term.length === 0;

  useEffect(() => {
    if (!open || (term.length < 1 && !customerId)) { setResults([]); return; }
    const t = setTimeout(async () => {
      const qs = new URLSearchParams({ status: 'active', pageSize: '8' });
      if (term) qs.set('q', term);
      else qs.set('customerId', String(customerId));
      const r = await api.get<Paginated<Vehicle>>(`/vehicles?${qs.toString()}`);
      setResults(r.data);
    }, term ? 200 : 0);
    return () => clearTimeout(t);
  }, [term, open, customerId]);

  // Čim se klijent izabere, lista njegovih vozila se sama otvori — inače bi Mario
  // morao da klikne u polje i kuca tablicu vozila koje već stoji pred njim.
  useEffect(() => { if (customerId && !value) setOpen(true); }, [customerId, value]);

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
      {open && listingOwned && results.length > 0 && <div className="hint">Vozila ovog klijenta — kucajte da pretražite sva.</div>}
      {open && listingOwned && results.length === 0 && <div className="hint">Ovaj klijent nema zavedeno vozilo — kucajte da pretražite ili dodajte novo.</div>}
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
