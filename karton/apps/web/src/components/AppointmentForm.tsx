import { useState, type FormEvent } from 'react';
import type { CustomerRef, Vehicle, Mechanic } from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { OwnerPicker } from './OwnerPicker.tsx';
import { VehiclePicker } from './VehiclePicker.tsx';
import { TimeInput } from './TimeInput.tsx';

const WARN_LABEL: Record<string, string> = {
  MECHANIC_BUSY: 'Majstor je zauzet u to vreme.',
  OUTSIDE_WORK_HOURS: 'Termin je van radnog vremena.',
};

export function AppointmentForm({ mechanics, defaultDate, defaultTime = '09:00', onCreated }: { mechanics: Mechanic[]; defaultDate: string; defaultTime?: string; onCreated: () => void }): React.JSX.Element {
  const [customer, setCustomer] = useState<CustomerRef | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime);
  const [duration, setDuration] = useState('60');
  const [mechanicId, setMechanicId] = useState('');
  const [note, setNote] = useState('');
  const [reminders, setReminders] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function doSubmit(confirmed: boolean): Promise<void> {
    if (!customer || !vehicle) { setError('Izaberite klijenta i vozilo.'); return; }
    setSaving(true); setError(null);
    try {
      await api.post('/appointments', {
        date, time, durationMin: Number(duration), customerId: customer.id, vehicleId: vehicle.id,
        mechanicId: mechanicId ? Number(mechanicId) : null, note: note.trim() || null, remindersEnabled: reminders, confirmed,
      });
      onCreated();
    } catch (err) {
      if (err instanceof ApiRequestError && err.body.code === 'CONFIRMATION_REQUIRED') {
        setWarnings(err.body.warnings ?? []);
      } else setError(err instanceof ApiRequestError ? err.body.message : 'Greška.');
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); void doSubmit(false); }} className="form">
      <div className="field"><span>Klijent</span><OwnerPicker value={customer} onChange={setCustomer} /></div>
      <div className="field"><span>Vozilo</span><VehiclePicker value={vehicle} onChange={setVehicle} /></div>
      <div className="form-2col">
        <label className="field"><span>Datum</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label className="field"><span>Vreme</span><TimeInput value={time} onChange={setTime} required /></label>
      </div>
      <div className="form-2col">
        <label className="field"><span>Trajanje (min)</span><input type="number" min={15} step={15} value={duration} onChange={(e) => setDuration(e.target.value)} /></label>
        <label className="field"><span>Majstor (opciono)</span>
          <select value={mechanicId} onChange={(e) => setMechanicId(e.target.value)}>
            <option value="">—</option>{mechanics.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
          </select></label>
      </div>
      <label className="field"><span>Napomena</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <label className="check-inline"><input type="checkbox" checked={reminders} onChange={(e) => setReminders(e.target.checked)} /> Email podsetnik (dan pre)</label>

      {warnings.length > 0 && (
        <div className="warn-box">
          {warnings.map((w) => <div key={w}>⚠ {WARN_LABEL[w] ?? w}</div>)}
          <button type="button" className="btn-primary btn-sm" onClick={() => void doSubmit(true)} disabled={saving}>Ipak zakaži</button>
        </div>
      )}
      {error && <div className="login-error">{error}</div>}
      {warnings.length === 0 && <div className="form-actions"><button type="submit" className="btn-primary" disabled={saving}>Zakaži termin</button></div>}
    </form>
  );
}
