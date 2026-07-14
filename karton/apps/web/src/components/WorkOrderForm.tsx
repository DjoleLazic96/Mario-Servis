import { useState, type FormEvent } from 'react';
import { DateInput } from './DateInput.tsx';
import type { Vehicle, WorkOrderInput, FieldVisitOutcome } from '@karton/shared';
import { VehiclePicker } from './VehiclePicker.tsx';
import { TimeInput } from './TimeInput.tsx';

/** Forma za otvaranje naloga: vozilo (klijent se izvodi iz vlasnika), prijem, izlazak na teren. */
export function WorkOrderForm({
  submitting,
  error,
  onSubmit,
}: {
  submitting: boolean;
  error?: string | null;
  onSubmit: (input: WorkOrderInput, vehicleId: number) => void;
}): React.JSX.Element {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  // Prijem se predlaže na TRENUTAK otvaranja naloga — majstor može da ispravi.
  const [receivedOn, setReceivedOn] = useState(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  });
  const [receivedTime, setReceivedTime] = useState(() => {
    const t = new Date();
    return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  });
  const [odometerKm, setOdometerKm] = useState('');
  const [requestedWork, setRequestedWork] = useState('');
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  // izlazak na teren
  const [fieldVisit, setFieldVisit] = useState(false);
  const [fvDate, setFvDate] = useState('');
  const [fvTime, setFvTime] = useState('');
  const [fvLocation, setFvLocation] = useState('');
  const [fvKm, setFvKm] = useState('');
  const [drivable, setDrivable] = useState<'yes' | 'no' | ''>('');
  const [outcome, setOutcome] = useState<FieldVisitOutcome | ''>('');

  function submit(e: FormEvent): void {
    e.preventDefault();
    if (!vehicle) { setLocalError('Izaberite vozilo.'); return; }
    if (!vehicle.currentOwner) { setLocalError('Vozilo nema vlasnika — dodajte vlasnika na vozilu.'); return; }
    setLocalError(null);
    onSubmit(
      {
        vehicleId: vehicle.id,
        receivedOn: receivedOn || undefined,
        receivedTime: receivedTime || null,
        odometerKm: odometerKm ? Number(odometerKm) : null,
        requestedWork: requestedWork.trim() || null,
        note: note.trim() || null,
        fieldVisit,
        ...(fieldVisit ? {
          fieldVisitDate: fvDate || null,
          fieldVisitTime: fvTime || null,
          fieldVisitLocation: fvLocation.trim() || null,
          fieldVisitKm: fvKm ? Number(fvKm) : null,
          vehicleDrivable: drivable === '' ? null : drivable === 'yes',
          fieldVisitOutcome: outcome || null,
        } : {}),
      },
      vehicle.id,
    );
  }

  return (
    <form onSubmit={submit} className="form">
      <div className="field">
        <span>Vozilo</span>
        <VehiclePicker value={vehicle} onChange={setVehicle} />
      </div>
      {vehicle?.currentOwner && (
        <p className="hint">Klijent: <strong>{vehicle.currentOwner.name}</strong> (iz vlasništva vozila)</p>
      )}

      <div className="form-2col">
        <label className="field"><span>Datum prijema</span>
          <DateInput value={receivedOn} onChange={setReceivedOn} /></label>
        <label className="field"><span>Vreme prijema</span>
          <TimeInput value={receivedTime} onChange={setReceivedTime} /></label>
      </div>

      <label className="field"><span>Kilometraža na prijemu</span>
        <input type="number" min={0} value={odometerKm} onChange={(e) => setOdometerKm(e.target.value)} /></label>

      <label className="field"><span>Zahtevani radovi</span>
        <textarea rows={2} value={requestedWork} onChange={(e) => setRequestedWork(e.target.value)}
          placeholder="Šta klijent traži / prijavljuje" /></label>

      <label className="field"><span>Napomena</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} /></label>

      <label className="check-inline">
        <input type="checkbox" checked={fieldVisit} onChange={(e) => setFieldVisit(e.target.checked)} />
        Izlazak na teren
      </label>

      {fieldVisit && (
        <div className="fv-box">
          <div className="form-2col">
            <label className="field"><span>Datum izlaska</span>
              <DateInput value={fvDate} onChange={setFvDate} /></label>
            <label className="field"><span>Vreme izlaska</span>
              <TimeInput value={fvTime} onChange={setFvTime} /></label>
          </div>
          <label className="field"><span>Lokacija</span>
            <input value={fvLocation} onChange={(e) => setFvLocation(e.target.value)} /></label>
          <div className="form-2col">
            <label className="field"><span>Pređeni km (ukupno)</span>
              <input type="number" min={0} value={fvKm} onChange={(e) => setFvKm(e.target.value)} /></label>
            <label className="field"><span>Vozilo u voznom stanju</span>
              <select value={drivable} onChange={(e) => setDrivable(e.target.value as 'yes' | 'no' | '')}>
                <option value="">—</option><option value="yes">Da</option><option value="no">Ne</option>
              </select></label>
          </div>
          <label className="field"><span>Ishod</span>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as FieldVisitOutcome)}>
              <option value="">—</option>
              <option value="solved_on_site">Rešeno na terenu</option>
              <option value="arrives_driving">Dolazi na točkovima</option>
              <option value="arrives_towed">Dolazi na šlepu</option>
              <option value="customer_declined">Klijent odustao</option>
            </select></label>
        </div>
      )}

      {(error || localError) && <div className="login-error">{error ?? localError}</div>}
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Otvaranje…' : 'Otvori nalog'}
        </button>
      </div>
    </form>
  );
}
