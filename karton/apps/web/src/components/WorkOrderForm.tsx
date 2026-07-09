import { useState, type FormEvent } from 'react';
import type { Vehicle, WorkOrderInput, FieldVisitOutcome } from '@karton/shared';
import { VehiclePicker } from './VehiclePicker.tsx';

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
  const [receivedOn, setReceivedOn] = useState('');
  const [receivedTime, setReceivedTime] = useState('');
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
          <input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} /></label>
        <label className="field"><span>Vreme prijema</span>
          <input type="time" value={receivedTime} onChange={(e) => setReceivedTime(e.target.value)} /></label>
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
              <input type="date" value={fvDate} onChange={(e) => setFvDate(e.target.value)} /></label>
            <label className="field"><span>Vreme izlaska</span>
              <input type="time" value={fvTime} onChange={(e) => setFvTime(e.target.value)} /></label>
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
