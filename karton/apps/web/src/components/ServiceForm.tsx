import { useState, type FormEvent } from 'react';
import type { Service, ServiceInput, ServiceBillingUnit } from '@karton/shared';

export function ServiceForm({
  initial,
  submitting,
  error,
  onSubmit,
}: {
  initial?: Service;
  submitting: boolean;
  error?: string | null;
  onSubmit: (input: ServiceInput) => void;
}): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? '');
  const [billingUnit, setBillingUnit] = useState<ServiceBillingUnit>(initial?.billingUnit ?? 'flat');
  const [defaultPrice, setDefaultPrice] = useState(initial?.defaultPrice ? String(initial.defaultPrice) : '');
  const [status, setStatus] = useState(initial?.status ?? 'active');

  function submit(e: FormEvent): void {
    e.preventDefault();
    onSubmit({ name: name.trim(), billingUnit, defaultPrice: Number(defaultPrice) || 0, status });
  }

  return (
    <form onSubmit={submit} className="form">
      <label className="field">
        <span>Naziv usluge</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="npr. Izlazak na teren" />
      </label>
      <div className="form-2col">
        <label className="field">
          <span>Način obračuna</span>
          <select value={billingUnit} onChange={(e) => setBillingUnit(e.target.value as ServiceBillingUnit)}>
            <option value="flat">Paušalno (fiksan iznos)</option>
            <option value="km">Po kilometru</option>
          </select>
        </label>
        <label className="field">
          <span>{billingUnit === 'km' ? 'Cena po km (RSD)' : 'Iznos (RSD)'}</span>
          <input type="number" min={0} value={defaultPrice} onChange={(e) => setDefaultPrice(e.target.value)} required />
        </label>
      </div>
      <label className="field">
        <span>Status</span>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}>
          <option value="active">Aktivna</option>
          <option value="inactive">Neaktivna</option>
        </select>
      </label>
      <p className="hint">Cena iz cenovnika je predlog na nalogu i uvek se može promeniti.</p>
      {error && <div className="login-error">{error}</div>}
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Čuvanje…' : 'Sačuvaj'}
        </button>
      </div>
    </form>
  );
}
