import { useEffect, useState } from 'react';
import type { Customer, CustomerRef, CustomerInput, Paginated } from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { Modal } from './Modal.tsx';
import { CustomerForm, type CustomerPrefill } from './CustomerForm.tsx';

/**
 * Izbor vlasnika: pretraga postojećih klijenata ili „+ Novi klijent"
 * kroz ugnježdeni modal (modal-na-modal, spec §2).
 *
 * `prefill` (npr. sa saobraćajne) NAMERNO ne pravi klijenta sam: prvo pretraži postojeće
 * po imenu — da se isti čovek ne zavede dvaput (jednom sa JMBG-om, jednom bez). Tek ako ga
 * nema, „Novi klijent" se otvara sa već popunjenim poljima.
 */
export function OwnerPicker({
  value,
  onChange,
  prefill,
}: {
  value: CustomerRef | null;
  onChange: (owner: CustomerRef) => void;
  prefill?: CustomerPrefill | null;
}): React.JSX.Element {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Sa saobraćajne: otvori izbor i unapred pretraži po imenu, da se vide postojeći klijenti
  // pre nego što se napravi nov (zaštita od duplikata). Vlasnik ostaje izmenjiv preko „Promeni".
  useEffect(() => {
    if (prefill?.name && !value) { setOpen(true); setQ(prefill.name); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  useEffect(() => {
    if (!open || q.trim().length < 1) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await api.get<Paginated<Customer>>(
        `/customers?status=active&q=${encodeURIComponent(q.trim())}&pageSize=8`,
      );
      setResults(r.data);
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  function pick(c: Customer | CustomerRef): void {
    onChange({ id: c.id, name: c.name, type: c.type });
    setOpen(false);
    setQ('');
  }

  async function createOwner(input: CustomerInput): Promise<void> {
    setSaving(true);
    setFormError(null);
    try {
      const created = await api.post<Customer>('/customers', input);
      pick(created);
      setShowNew(false);
    } catch (err) {
      setFormError(
        err instanceof ApiRequestError
          ? err.body.existingId
            ? `${err.body.message} (postojeći #${err.body.existingId})`
            : err.body.message
          : 'Greška pri čuvanju.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (value && !open) {
    return (
      <div className="owner-picked">
        <span className="owner-name">{value.name}</span>
        <span className="owner-type">{value.type === 'company' ? 'pravno' : 'fizičko'}</span>
        <button type="button" className="btn-secondary btn-sm owner-change" onClick={() => setOpen(true)}>
          Promeni
        </button>
      </div>
    );
  }

  return (
    <div className="owner-picker">
      <div className="owner-search-row">
        <input
          className="owner-search"
          placeholder="Pretraži klijenta…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          autoFocus={open}
        />
        <button type="button" className="btn-secondary btn-sm" onClick={() => { setFormError(null); setShowNew(true); }}>
          + Novi klijent
        </button>
      </div>
      {prefill?.name && !value && (
        <div className="hint">
          Sa saobraćajne: <strong>{prefill.name}</strong>{prefill.taxId ? ` · ${prefill.taxId}` : ''}.
          {results.length > 0 ? ' Izaberi postojećeg (da se ne zavede dvaput) ili „+ Novi klijent".' : ' Nema slaganja — „+ Novi klijent" je popunjen podacima.'}
        </div>
      )}
      {open && results.length > 0 && (
        <ul className="owner-results">
          {results.map((c) => (
            <li key={c.id} onClick={() => pick(c)}>
              <span className="strong">{c.name}</span>
              <span className="owner-type">{c.type === 'company' ? 'pravno' : 'fizičko'}</span>
            </li>
          ))}
        </ul>
      )}

      {showNew && (
        <Modal title="Novi klijent" onClose={() => setShowNew(false)}>
          <CustomerForm withContacts prefill={prefill ?? undefined} submitting={saving} error={formError} onSubmit={createOwner} />
        </Modal>
      )}
    </div>
  );
}
