import { useState, type FormEvent } from 'react';
import { DateInput } from './DateInput.tsx';
import type { WorkOrderDetail, WorkOrderInput, FieldVisitOutcome } from '@karton/shared';
import { TimeInput } from './TimeInput.tsx';

/**
 * Izmena zaglavlja otvorenog naloga. Ovde majstor upisuje „Utvrđeno stanje" (findings) —
 * ono se, za razliku od „Zahtevanih radova", popunjava tek pošto se vozilo pregleda (spec §4.4).
 * Ručna ispravka datuma završetka traži razlog i ide u audit (BR-11).
 */
export function WorkOrderEditForm({
  wo, submitting, error, onSubmit,
}: {
  wo: WorkOrderDetail;
  submitting: boolean;
  error?: string | null;
  onSubmit: (input: WorkOrderInput & { reason?: string | null }) => void;
}): React.JSX.Element {
  const [receivedOn, setReceivedOn] = useState(wo.receivedOn);
  const [receivedTime, setReceivedTime] = useState(wo.receivedTime ?? '');
  const [completedOn, setCompletedOn] = useState(wo.completedOn ?? '');
  const [completedTime, setCompletedTime] = useState(wo.completedTime ?? '');
  const [odometerKm, setOdometerKm] = useState(wo.odometerKm === null ? '' : String(wo.odometerKm));
  const [requestedWork, setRequestedWork] = useState(wo.requestedWork ?? '');
  const [findings, setFindings] = useState(wo.findings ?? '');
  const [note, setNote] = useState(wo.note ?? '');
  const [reason, setReason] = useState('');

  const [fieldVisit, setFieldVisit] = useState(wo.fieldVisit);
  const [fvDate, setFvDate] = useState(wo.fieldVisitDate ?? '');
  const [fvTime, setFvTime] = useState(wo.fieldVisitTime ?? '');
  const [fvLocation, setFvLocation] = useState(wo.fieldVisitLocation ?? '');
  const [fvKm, setFvKm] = useState(wo.fieldVisitKm === null ? '' : String(wo.fieldVisitKm));
  const [drivable, setDrivable] = useState<'yes' | 'no' | ''>(wo.vehicleDrivable === null ? '' : wo.vehicleDrivable ? 'yes' : 'no');
  const [outcome, setOutcome] = useState<FieldVisitOutcome | ''>(wo.fieldVisitOutcome ?? '');

  const completedChanged = (completedOn || null) !== (wo.completedOn ?? null);

  function submit(e: FormEvent): void {
    e.preventDefault();
    onSubmit({
      vehicleId: wo.vehicle.id,
      receivedOn,
      receivedTime: receivedTime || null,
      completedOn: completedOn || null,
      completedTime: completedTime || null,
      odometerKm: odometerKm ? Number(odometerKm) : null,
      requestedWork: requestedWork.trim() || null,
      findings: findings.trim() || null,
      note: note.trim() || null,
      reason: completedChanged && reason.trim() ? reason.trim() : null,
      fieldVisit,
      ...(fieldVisit ? {
        fieldVisitDate: fvDate || null,
        fieldVisitTime: fvTime || null,
        fieldVisitLocation: fvLocation.trim() || null,
        fieldVisitKm: fvKm ? Number(fvKm) : null,
        vehicleDrivable: drivable === '' ? null : drivable === 'yes',
        fieldVisitOutcome: outcome || null,
      } : {}),
      version: wo.version,
    });
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="form-2col">
        <label className="field"><span>Datum prijema</span>
          <DateInput value={receivedOn} onChange={setReceivedOn} required /></label>
        <label className="field"><span>Vreme prijema</span>
          <TimeInput value={receivedTime} onChange={setReceivedTime} /></label>
      </div>

      <div className="form-2col">
        <label className="field"><span>Datum završetka</span>
          <DateInput value={completedOn} onChange={setCompletedOn} /></label>
        <label className="field"><span>Vreme završetka</span>
          <TimeInput value={completedTime} onChange={setCompletedTime} /></label>
      </div>

      {completedChanged && (
        <label className="field"><span>Razlog izmene datuma završetka</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Upisuje se u istoriju izmena" />
          <small className="hint">Datum završetka se postavlja automatski; ručna ispravka se beleži.</small>
        </label>
      )}

      <label className="field"><span>Kilometraža (km)</span>
        <input type="number" min={0} value={odometerKm} onChange={(e) => setOdometerKm(e.target.value)} /></label>

      <label className="field"><span>Zahtevani radovi <small className="hint">— šta klijent traži (upisuje se pri prijemu)</small></span>
        <textarea rows={3} value={requestedWork} onChange={(e) => setRequestedWork(e.target.value)} /></label>

      <label className="field"><span>Utvrđeno stanje <small className="hint">— nalaz majstora posle pregleda</small></span>
        <textarea rows={3} value={findings} onChange={(e) => setFindings(e.target.value)} placeholder="Šta je zaista utvrđeno na vozilu…" /></label>

      <label className="field"><span>Napomena</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>

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
            <label className="field"><span>Pređeno km</span>
              <input type="number" min={0} value={fvKm} onChange={(e) => setFvKm(e.target.value)} /></label>
            <label className="field"><span>Vozilo u voznom stanju</span>
              <select value={drivable} onChange={(e) => setDrivable(e.target.value as 'yes' | 'no' | '')}>
                <option value="">—</option><option value="yes">Da</option><option value="no">Ne</option>
              </select></label>
          </div>
          <label className="field"><span>Ishod izlaska</span>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as FieldVisitOutcome | '')}>
              <option value="">—</option>
              <option value="solved_on_site">Rešeno na licu mesta</option>
              <option value="arrives_driving">Vozilo dolazi u servis (vozno)</option>
              <option value="arrives_towed">Vozilo dolazi na šlepu</option>
              <option value="customer_declined">Klijent odustao</option>
            </select></label>
        </div>
      )}

      {error && <div className="login-error">{error}</div>}
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Čuvam…' : 'Sačuvaj'}</button>
      </div>
    </form>
  );
}
