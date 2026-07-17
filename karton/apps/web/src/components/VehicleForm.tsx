import { useState, type FormEvent } from 'react';
import type { Vehicle, VehicleInput, CustomerRef } from '@karton/shared';
import { OwnerPicker } from './OwnerPicker.tsx';

const CITAC = 'http://127.0.0.1:8765';

/**
 * Zašto čitanje nije uspelo — pošteno, umesto uvek istog „Čitač nije pokrenut".
 *
 * Iz JavaScript-a se „helper ne radi" i „helper je odbio ovaj sajt" vide POTPUNO ISTO:
 * oba su goli TypeError, jer browser sakriva odbijene odgovore (CORS). Zato je stara poruka
 * uvek tvrdila da čitač nije pokrenut — i kad jeste radio. Čovek gleda upaljen čitač i poruku
 * da ga nema, i nema šanse da pogodi da je u pitanju domen.
 *
 * Trik: `mode: 'no-cors'` ne traži nikakva CORS zaglavlja, pa uspeva čim helper uopšte
 * odgovara. Tako se ta dva slučaja razdvajaju.
 */
async function zastoNeRadi(): Promise<string> {
  const ziv = await fetch(`${CITAC}/status`, { mode: 'no-cors' }).then(() => true).catch(() => false);
  return ziv
    ? `Čitač radi, ali ne prihvata ovaj sajt (${window.location.origin}). Verovatno je starija `
      + 'verzija čitača — zamenite je novom i pokrenite ponovo.'
    : 'Čitač nije pokrenut. Uključite „Pokreni čitač" na ovom računaru ili unesite podatke ručno.';
}

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
  const [reading, setReading] = useState(false);
  const [cardMsg, setCardMsg] = useState<string | null>(null);
  const [ownerHint, setOwnerHint] = useState<string | null>(null);

  // Lokalni helper za čitač saobraćajne (127.0.0.1). Ako nije pokrenut, forma radi ručno.
  async function loadFromCard(): Promise<void> {
    setReading(true); setCardMsg(null);
    try {
      const res = await fetch(`${CITAC}/read`);
      const c = await res.json();
      if (c.error) { setCardMsg(c.error); return; }
      if (c.vin) setVin(String(c.vin).toUpperCase());
      if (c.make) setMake(c.make);
      if (c.model) setModel(c.model);
      if (c.year) setYear(String(c.year));
      if (c.fuel) setFuel(c.fuel);
      if (c.plate) setPlate(String(c.plate).toUpperCase());
      setOwnerHint(c.ownerName ? `${c.ownerName}${c.ownerAddress ? ` — ${c.ownerAddress}` : ''}` : null);
      setCardMsg('Podaci učitani sa saobraćajne.');
    } catch {
      setCardMsg(await zastoNeRadi());
    } finally { setReading(false); }
  }

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
        <>
          <button type="button" className="btn-secondary" onClick={loadFromCard} disabled={reading}>
            {reading ? 'Čitam karticu…' : '⬇ Učitaj saobraćajnu'}
          </button>
          {cardMsg && <div className={cardMsg.startsWith('Podaci') ? 'ok-box' : 'hint'}>{cardMsg}</div>}
          {ownerHint && <div className="hint">Vlasnik sa kartice: <strong>{ownerHint}</strong> — izaberite ili dodajte klijenta ispod.</div>}
        </>
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
