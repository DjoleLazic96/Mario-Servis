import { useState, type FormEvent } from 'react';
import { DateInput } from './DateInput.tsx';
import type { Mechanic, MechanicInput, MechanicSpecialty } from '@karton/shared';
import { labels } from '@karton/shared';

export function MechanicForm({
  initial,
  submitting,
  error,
  onSubmit,
}: {
  initial?: Mechanic;
  submitting: boolean;
  error?: string | null;
  onSubmit: (input: MechanicInput) => void;
}): React.JSX.Element {
  const [fullName, setFullName] = useState(initial?.fullName ?? '');
  const [specialty, setSpecialty] = useState<MechanicSpecialty>(initial?.specialty ?? 'mechanical');
  const [hiredOn, setHiredOn] = useState(initial?.hiredOn ?? '');
  const [hourlyRate, setHourlyRate] = useState(initial?.hourlyRate ? String(initial.hourlyRate) : '');
  const [status, setStatus] = useState(initial?.status ?? 'active');

  function submit(e: FormEvent): void {
    e.preventDefault();
    onSubmit({
      fullName: fullName.trim(),
      specialty,
      hiredOn: hiredOn || null,
      hourlyRate: Number(hourlyRate) || 0,
      status,
    });
  }

  return (
    <form onSubmit={submit} className="form">
      <label className="field">
        <span>Ime i prezime</span>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus />
      </label>
      <div className="form-2col">
        <label className="field">
          <span>Specijalnost</span>
          <select value={specialty} onChange={(e) => setSpecialty(e.target.value as MechanicSpecialty)}>
            {(['mechanical', 'electrical', 'other'] as const).map((s) => (
              <option key={s} value={s}>{labels.specialty[s]}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Cena po satu (RSD)</span>
          <input type="number" min={0} value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} required />
        </label>
      </div>
      <div className="form-2col">
        <label className="field">
          <span>Datum zaposlenja</span>
          <DateInput value={hiredOn} onChange={setHiredOn} />
        </label>
        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}>
            <option value="active">Aktivan</option>
            <option value="inactive">Neaktivan</option>
          </select>
        </label>
      </div>
      {error && <div className="login-error">{error}</div>}
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Čuvanje…' : 'Sačuvaj'}
        </button>
      </div>
    </form>
  );
}
