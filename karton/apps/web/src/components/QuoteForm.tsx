import { useState, type FormEvent } from 'react';
import type { Document, CustomerRef, Vehicle, DocumentItemDraft } from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { OwnerPicker } from './OwnerPicker.tsx';
import { VehiclePicker } from './VehiclePicker.tsx';
import { money } from '../lib/documentHelpers.ts';

type Row = { itemType: 'labor' | 'part' | 'external'; name: string; amount: string };

/** Kreiranje ponude (procena): klijent + vozilo + slobodne stavke. */
export function QuoteForm({ onCreated }: { onCreated: (id: number) => void }): React.JSX.Element {
  const [customer, setCustomer] = useState<CustomerRef | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [rows, setRows] = useState<Row[]>([{ itemType: 'labor', name: '', amount: '' }]);
  const [validUntil, setValidUntil] = useState('');
  const [amountEur, setAmountEur] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  function setRow(i: number, patch: Partial<Row>): void {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!customer) { setError('Izaberite klijenta.'); return; }
    if (!vehicle) { setError('Izaberite vozilo.'); return; }
    const items: DocumentItemDraft[] = rows
      .filter((r) => r.name.trim() && Number(r.amount) > 0)
      .map((r) => ({ itemType: r.itemType, name: r.name.trim(), amount: Number(r.amount) }));
    setSaving(true); setError(null);
    try {
      const doc = await api.post<Document>('/documents', {
        type: 'quote', customerId: customer.id, vehicleId: vehicle.id, items,
        validUntil: validUntil || undefined,
        amountEur: amountEur ? Number(amountEur) : null,
        note: note.trim() || null,
      });
      onCreated(doc.id);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : 'Greška pri kreiranju.');
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="form">
      <div className="field"><span>Klijent</span><OwnerPicker value={customer} onChange={setCustomer} /></div>
      <div className="field"><span>Vozilo</span><VehiclePicker value={vehicle} onChange={setVehicle} /></div>

      <div className="field"><span>Stavke procene</span></div>
      <div className="quote-items">
        {rows.map((r, i) => (
          <div className="quote-row" key={i}>
            <select value={r.itemType} onChange={(e) => setRow(i, { itemType: e.target.value as Row['itemType'] })}>
              <option value="labor">Rad</option>
              <option value="part">Deo</option>
              <option value="external">Eksterni</option>
            </select>
            <input placeholder="Naziv" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
            <input type="number" min={0} placeholder="Iznos" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} />
            <button type="button" className="btn-link danger" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} disabled={rows.length === 1}>×</button>
          </div>
        ))}
        <button type="button" className="btn-link" onClick={() => setRows((rs) => [...rs, { itemType: 'labor', name: '', amount: '' }])}>+ Dodaj stavku</button>
      </div>

      <div className="amount-preview">Ukupno: <strong>{money(total)} RSD</strong></div>

      <div className="form-row">
        <label className="field"><span>Rok važenja <small className="hint">(podrazumevano iz podešavanja)</small></span>
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></label>
        <label className="field"><span>Iznos u EUR <small className="hint">(informativno)</small></span>
          <input type="number" step="0.01" min={0} value={amountEur} onChange={(e) => setAmountEur(e.target.value)} /></label>
      </div>
      <label className="field"><span>Napomena</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>

      {error && <div className="login-error">{error}</div>}
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Kreiranje…' : 'Kreiraj ponudu'}</button>
      </div>
    </form>
  );
}
