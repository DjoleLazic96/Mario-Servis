import { useState, type FormEvent } from 'react';
import type { Customer, CustomerInput } from '@karton/shared';

/**
 * Forma klijenta — koristi se i za kreiranje (sa telefonom/emailom) i za izmenu.
 * Label za PIB/JMBG se menja prema tipu (spec §4.2).
 */
export function CustomerForm({
  initial,
  withContacts,
  submitting,
  error,
  onSubmit,
}: {
  initial?: Customer;
  withContacts: boolean;
  submitting: boolean;
  error?: string | null;
  onSubmit: (input: CustomerInput) => void;
}): React.JSX.Element {
  const [type, setType] = useState<'individual' | 'company'>(initial?.type ?? 'individual');
  const [name, setName] = useState(initial?.name ?? '');
  const [taxId, setTaxId] = useState(initial?.taxId ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  function submit(e: FormEvent): void {
    e.preventDefault();
    onSubmit({
      type,
      name: name.trim(),
      taxId: taxId.trim() || null,
      address: address.trim() || null,
      phone: withContacts && phone.trim() ? phone.trim() : null,
      email: withContacts && email.trim() ? email.trim() : null,
    });
  }

  return (
    <form onSubmit={submit} className="form">
      <div className="radio-row">
        <label>
          <input type="radio" checked={type === 'individual'} onChange={() => setType('individual')} /> Fizičko lice
        </label>
        <label>
          <input type="radio" checked={type === 'company'} onChange={() => setType('company')} /> Pravno lice
        </label>
      </div>

      <label className="field">
        <span>{type === 'company' ? 'Naziv kompanije' : 'Ime i prezime'}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </label>

      <label className="field">
        <span>
          {type === 'company' ? 'PIB' : 'JMBG'}
          {type === 'individual' && <em className="opt"> (opciono)</em>}
        </span>
        <input value={taxId} onChange={(e) => setTaxId(e.target.value)} required={type === 'company'} />
      </label>

      <label className="field">
        <span>Adresa</span>
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>

      {withContacts && (
        <div className="form-2col">
          <label className="field">
            <span>Telefon</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        </div>
      )}

      {error && <div className="login-error">{error}</div>}

      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Čuvanje…' : 'Sačuvaj'}
        </button>
      </div>
    </form>
  );
}
