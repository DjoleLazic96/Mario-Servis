import { useEffect, useState, type FormEvent } from 'react';
import { DateInput } from './DateInput.tsx';
import type { Unavailability, UnavailabilityKind } from '@karton/shared';
import { labels } from '@karton/shared';
import { api } from '../api.ts';

/** Evidencija nedostupnosti majstora (godišnji / bolovanje) — spec §3.11. */
export function UnavailabilityManager({ mechanicId }: { mechanicId: number }): React.JSX.Element {
  const [items, setItems] = useState<Unavailability[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<UnavailabilityKind>('vacation');
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setItems(await api.get<Unavailability[]>(`/mechanics/${mechanicId}/unavailabilities`));
  }
  useEffect(() => { void load(); }, [mechanicId]);

  async function add(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!from || !to) return;
    try {
      await api.post(`/mechanics/${mechanicId}/unavailabilities`, { fromDate: from, toDate: to, kind });
      setFrom(''); setTo('');
      await load();
    } catch {
      setError('Proveri datume (do ne može biti pre od).');
    }
  }

  async function remove(id: number): Promise<void> {
    await api.del(`/mechanics/${mechanicId}/unavailabilities/${id}`);
    await load();
  }

  return (
    <div className="unavail">
      <div className="card-title">Nedostupnost</div>
      <ul className="contact-list">
        {items.length === 0 && <li className="card-empty">Nema evidentirane nedostupnosti.</li>}
        {items.map((u) => (
          <li key={u.id}>
            <span className="badge badge-muted">{labels.unavailabilityKind[u.kind]}</span>
            <span className="mono">{u.fromDate} → {u.toDate}</span>
            <button className="btn-link" onClick={() => remove(u.id)}>ukloni</button>
          </li>
        ))}
      </ul>
      <form className="unavail-add" onSubmit={add}>
        <DateInput value={from} onChange={setFrom} required />
        <DateInput value={to} onChange={setTo} required />
        <select value={kind} onChange={(e) => setKind(e.target.value as UnavailabilityKind)}>
          <option value="vacation">Godišnji</option>
          <option value="sick_leave">Bolovanje</option>
        </select>
        <button type="submit" className="btn-secondary btn-sm">Dodaj</button>
      </form>
      {error && <div className="login-error">{error}</div>}
    </div>
  );
}
