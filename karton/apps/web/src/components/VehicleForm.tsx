import { useState, type FormEvent } from 'react';
import type { Vehicle, VehicleInput, CustomerRef } from '@karton/shared';
import { OwnerPicker } from './OwnerPicker.tsx';

/**
 * Forma vozila. U 'create' modu ima VIN, tablicu i vlasnika (OwnerPicker);
 * u 'edit' modu VIN je zaključan, a tablica/vlasnik se menjaju kroz istorije (detalj).
 */
export function VehicleForm({
  mode,
  initial,
  submitting,
  error,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initial?: Vehicle;
  submitting: boolean;
  error?: string | null;
  onSubmit: (input: VehicleInput) => void;
}): React.JSX.Element {
  const [vin, setVin] = useState(initial?.vin ?? '');
  const [make, setMake] = useState(initial?.make ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [year, setYear] = useState(initial?.year ? String(initial.year) : '');
  const [fuel, setFuel] = useState(initial?.fuel ?? '');
  const [plate, setPlate] = useState('');
  const [note, setNote] = useState(initial?.note ?? '');
  const [owner, setOwner] = useState<CustomerRef | null>(null);

  function submit(e: FormEvent): void {
    e.preventDefault();
    onSubmit({
      vin: vin.trim(),
      make: make.trim(),
      model: model.trim(),
      year: year.trim() ? Number(year) : null,
      fuel: fuel.trim() || null,
      note: note.trim() || null,
      ...(mode === 'create' ? { plate: plate.trim() || null, ownerId: owner?.id ?? null } : {}),
    });
  }

  return (
    <form onSubmit={submit} className="form">
      {mode === 'create' && (
        <button
          type="button"
          className="btn-secondary"
          disabled
          title="Čitač saobraćajne — lokalna helper aplikacija (u izradi)"
        >
          Učitaj saobraćajnu (uskoro)
        </button>
      )}

      <label className="field">
        <span>VIN (broj šasije)</span>
        <input
          className="mono"
          value={vin}
          onChange={(e) => setVin(e.target.value.toUpperCase())}
          required
          readOnly={mode === 'edit'}
          title={mode === 'edit' ? 'VIN se ne menja' : undefined}
        />
      </label>

      <div className="form-2col">
        <label className="field">
          <span>Marka</span>
          <input value={make} onChange={(e) => setMake(e.target.value)} required />
        </label>
        <label className="field">
          <span>Model</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} required />
        </label>
      </div>

      <div className="form-2col">
        <label className="field">
          <span>Godina</span>
          <input type="number" value={year} onChange={(e) => setYear(e.target.value)} min={1900} max={2100} />
        </label>
        <label className="field">
          <span>Gorivo</span>
          <input value={fuel} onChange={(e) => setFuel(e.target.value)} placeholder="dizel / benzin / …" />
        </label>
      </div>

      {mode === 'create' && (
        <>
          <label className="field">
            <span>Registarska tablica</span>
            <input className="mono" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} />
          </label>
          <div className="field">
            <span>Vlasnik</span>
            <OwnerPicker value={owner} onChange={setOwner} />
          </div>
        </>
      )}

      <label className="field">
        <span>Napomena</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      {error && <div className="login-error">{error}</div>}

      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Čuvanje…' : 'Sačuvaj'}
        </button>
      </div>
    </form>
  );
}
