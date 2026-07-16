import { useEffect, useState, type FormEvent } from 'react';
import type {
  Mechanic, Service, LaborBillingUnit,
  LaborItem, LaborItemInput, PartItem, PartItemInput, ExternalItem, ExternalItemInput,
} from '@karton/shared';
import { api } from '../api.ts';
import { money } from '../lib/documentHelpers.ts';
import { DecimalInput } from './DecimalInput.tsx';

/** Stavka rada — tri načina obračuna (sat/km/paušal, BR-43). */
export function LaborItemForm({
  initial, submitting, onSubmit,
}: {
  initial?: LaborItem;
  submitting: boolean;
  onSubmit: (input: LaborItemInput) => void;
}): React.JSX.Element {
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [mechanicId, setMechanicId] = useState(initial?.mechanicId ?? 0);
  const [name, setName] = useState(initial?.name ?? '');
  const [unit, setUnit] = useState<LaborBillingUnit>(initial?.billingUnit ?? 'hour');
  const [quantity, setQuantity] = useState(initial?.quantity != null ? String(initial.quantity) : '');
  const [unitPrice, setUnitPrice] = useState(initial?.unitPrice != null ? String(initial.unitPrice) : '');
  const [amount, setAmount] = useState(initial?.amount != null && initial.billingUnit === 'flat' ? String(initial.amount) : '');

  useEffect(() => {
    // Majstor se NAMERNO ne bira sam. Ranije se prvi sa spiska tiho ubacivao, a pošto je to
    // zaobilazilo `onPickMechanic`, cena je ostajala prazna — i „— izaberi —" se nikad nije
    // video, iako stoji u kodu. Ko ne pipne meni, ne dobije cenu i ne shvati zašto.
    void api.get<Mechanic[]>('/mechanics?status=active').then(setMechanics);
    void api.get<Service[]>('/services?status=active').then(setServices);
  }, []);

  // predlog cene: sat → cena majstora; km/paušal → cenovnik usluga (kada se izabere naziv)
  function onPickMechanic(id: number): void {
    setMechanicId(id);
    // Cena UVEK prati majstora, i kada je prethodno ručno menjana: bolje da se vidi čija je
    // cena nego da tiho ostane cena pogrešnog majstora. Prazno polje primetiš, pogrešan broj ne.
    if (unit === 'hour') {
      const m = mechanics.find((x) => x.id === id);
      if (m) setUnitPrice(String(m.hourlyRate));
    }
  }
  function onPickService(svcName: string): void {
    setName(svcName);
    const s = services.find((x) => x.name === svcName);
    if (!s) return;
    if (s.billingUnit === 'km') { setUnit('km'); setUnitPrice(String(s.defaultPrice)); }
    else { setUnit('flat'); setAmount(String(s.defaultPrice)); }
  }

  const computed = unit === 'flat' ? Number(amount) || 0 : (Number(quantity) || 0) * (Number(unitPrice) || 0);

  function submit(e: FormEvent): void {
    e.preventDefault();
    onSubmit({
      mechanicId,
      name: name.trim(),
      billingUnit: unit,
      quantity: unit === 'flat' ? null : Number(quantity),
      unitPrice: unit === 'flat' ? null : Number(unitPrice),
      amount: unit === 'flat' ? Number(amount) : undefined,
    });
  }

  return (
    <form onSubmit={submit} className="form">
      <label className="field"><span>Majstor</span>
        {/* Bez `required`: ono se oglašava samo kad je vrednost prazan string, a ovde je „0" —
            nikad se nije javljalo. „Sačuvaj" je ionako zaključan dok majstor nije izabran. */}
        <select value={mechanicId} onChange={(e) => onPickMechanic(Number(e.target.value))}>
          <option value={0} disabled>— izaberi majstora —</option>
          {mechanics.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
        </select></label>

      <label className="field"><span>Naziv rada</span>
        <input list="svc-list" value={name} onChange={(e) => onPickService(e.target.value)} required autoFocus />
        <datalist id="svc-list">{services.map((s) => <option key={s.id} value={s.name} />)}</datalist></label>

      <div className="seg">
        {(['hour', 'km', 'flat'] as const).map((u) => (
          <button type="button" key={u} className={`seg-btn ${unit === u ? 'active' : ''}`} onClick={() => setUnit(u)}>
            {u === 'hour' ? 'Po satu' : u === 'km' ? 'Po km' : 'Paušalno'}
          </button>
        ))}
      </div>

      {unit === 'flat' ? (
        <label className="field"><span>Iznos (RSD)</span>
          <DecimalInput value={amount} onChange={setAmount} required /></label>
      ) : (
        <div className="form-2col">
          <label className="field"><span>{unit === 'hour' ? 'Sati' : 'Kilometri'}</span>
            <DecimalInput value={quantity} onChange={setQuantity} required /></label>
          <label className="field"><span>{unit === 'hour' ? 'Cena/sat' : 'Cena/km'}</span>
            <DecimalInput value={unitPrice} onChange={setUnitPrice} required /></label>
        </div>
      )}

      <div className="amount-preview">Iznos: <strong>{money(computed)} RSD</strong></div>
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={submitting || !mechanicId}>Sačuvaj</button>
      </div>
    </form>
  );
}

/** Stavka dela. */
export function PartItemForm({
  initial, submitting, onSubmit,
}: {
  initial?: PartItem;
  submitting: boolean;
  onSubmit: (input: PartItemInput) => void;
}): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? '');
  const [quantity, setQuantity] = useState(initial ? String(initial.quantity) : '1');
  const [unitPrice, setUnitPrice] = useState(initial ? String(initial.unitPrice) : '');
  const [internal, setInternal] = useState(initial?.internalNoCharge ?? false);
  const computed = (Number(quantity) || 0) * (Number(unitPrice) || 0);

  function submit(e: FormEvent): void {
    e.preventDefault();
    onSubmit({ name: name.trim(), quantity: Number(quantity), unitPrice: Number(unitPrice), internalNoCharge: internal });
  }
  return (
    <form onSubmit={submit} className="form">
      <label className="field"><span>Naziv dela</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></label>
      <div className="form-2col">
        <label className="field"><span>Količina</span>
          <DecimalInput value={quantity} onChange={setQuantity} required /></label>
        <label className="field"><span>Cena po jedinici</span>
          <DecimalInput value={unitPrice} onChange={setUnitPrice} required /></label>
      </div>
      <label className="check-inline">
        <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
        Interno — ne naplaćuje se
      </label>
      <div className="amount-preview">Iznos: <strong>{money(computed)} RSD</strong>{internal && <span className="muted"> (interno — van zbira)</span>}</div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>Sačuvaj</button></div>
    </form>
  );
}

/** Stavka eksternog servisa. */
export function ExternalItemForm({
  initial, submitting, onSubmit,
}: {
  initial?: ExternalItem;
  submitting: boolean;
  onSubmit: (input: ExternalItemInput) => void;
}): React.JSX.Element {
  const [vendorName, setVendorName] = useState(initial?.vendorName ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [price, setPrice] = useState(initial ? String(initial.price) : '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [internal, setInternal] = useState(initial?.internalNoCharge ?? false);

  function submit(e: FormEvent): void {
    e.preventDefault();
    onSubmit({ vendorName: vendorName.trim(), description: description.trim() || null, price: Number(price), note: note.trim() || null, internalNoCharge: internal });
  }
  return (
    <form onSubmit={submit} className="form">
      <label className="field"><span>Naziv radnje</span>
        <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} required autoFocus /></label>
      <label className="field"><span>Opis</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <div className="form-2col">
        <label className="field"><span>Cena</span>
          <DecimalInput value={price} onChange={setPrice} required /></label>
        <label className="field"><span>Napomena</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <label className="check-inline">
        <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
        Interno — ne naplaćuje se
      </label>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>Sačuvaj</button></div>
    </form>
  );
}
