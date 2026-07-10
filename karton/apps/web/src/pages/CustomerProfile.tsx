import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Customer, CustomerInput, Vehicle, Paginated } from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { Modal } from '../components/Modal.tsx';
import { CustomerForm } from '../components/CustomerForm.tsx';
import { WorkOrderHistory } from '../components/WorkOrderHistory.tsx';

export function CustomerProfile(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [addKind, setAddKind] = useState<'phone' | 'email' | null>(null);
  const [addValue, setAddValue] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCustomer(await api.get<Customer>(`/customers/${id}`));
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function saveEdit(input: CustomerInput): Promise<void> {
    setSaving(true);
    setFormError(null);
    try {
      const updated = await api.patch<Customer>(`/customers/${id}`, input);
      setCustomer(updated);
      setShowEdit(false);
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.body.message : 'Greška pri čuvanju.');
    } finally {
      setSaving(false);
    }
  }

  async function addContact(): Promise<void> {
    if (!addKind || !addValue.trim()) return;
    const updated = await api.post<Customer>(`/customers/${id}/contacts`, {
      kind: addKind,
      value: addValue.trim(),
      isPrimary: true,
    });
    setCustomer(updated);
    setAddKind(null);
    setAddValue('');
  }

  async function toggleArchive(): Promise<void> {
    if (!customer) return;
    const action = customer.status === 'active' ? 'archive' : 'unarchive';
    setCustomer(await api.post<Customer>(`/customers/${id}/${action}`));
  }

  if (loading) return <div className="page"><p className="card-empty">Učitavanje…</p></div>;
  if (notFound || !customer) return <div className="page"><p className="card-empty">Klijent ne postoji.</p></div>;

  return (
    <div className="page">
      <button className="link-back" onClick={() => navigate('/klijenti')}>‹ Klijenti</button>

      <header className="page-head row">
        <div>
          <h1>
            {customer.name}
            {customer.status === 'archived' && <span className="badge badge-muted">Arhiviran</span>}
          </h1>
          <p className="page-sub">{customer.type === 'company' ? 'Pravno lice' : 'Fizičko lice'}</p>
        </div>
        <div className="btn-group">
          <button className="btn-secondary" onClick={() => { setFormError(null); setShowEdit(true); }}>Izmeni</button>
          <button className="btn-secondary" onClick={toggleArchive}>
            {customer.status === 'active' ? 'Arhiviraj' : 'Dearhiviraj'}
          </button>
        </div>
      </header>

      <div className="card-grid">
        <section className="card">
          <h2 className="card-title">Podaci</h2>
          <dl className="kv">
            <dt>{customer.type === 'company' ? 'PIB' : 'JMBG'}</dt>
            <dd className="mono">{customer.taxId ?? '—'}</dd>
            <dt>Adresa</dt>
            <dd>{customer.address ?? '—'}</dd>
          </dl>
        </section>

        <section className="card">
          <div className="card-title-row">
            <h2 className="card-title">Kontakti</h2>
            <div className="btn-group-sm">
              <button className="btn-link" onClick={() => { setAddKind('phone'); setAddValue(''); }}>+ Telefon</button>
              <button className="btn-link" onClick={() => { setAddKind('email'); setAddValue(''); }}>+ Email</button>
            </div>
          </div>
          <ul className="contact-list">
            {customer.contacts.length === 0 && <li className="card-empty">Nema kontakata.</li>}
            {customer.contacts.map((c) => (
              <li key={c.id}>
                <span className="contact-kind">{c.kind === 'phone' ? 'Tel' : 'Email'}</span>
                <span className={c.kind === 'phone' ? 'mono' : ''}>{c.value}</span>
                {c.isPrimary && <span className="badge badge-accent">primarni</span>}
              </li>
            ))}
          </ul>
          {addKind && (
            <div className="inline-add">
              <input
                autoFocus
                placeholder={addKind === 'phone' ? 'Novi telefon' : 'Novi email'}
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addContact()}
              />
              <button className="btn-primary btn-sm" onClick={addContact}>Dodaj</button>
              <button className="btn-ghost-light btn-sm" onClick={() => setAddKind(null)}>Otkaži</button>
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <h2 className="card-title">Vozila klijenta</h2>
        <CustomerVehicles customerId={customer.id} />
      </section>

      <section className="card">
        <h2 className="card-title">Istorija radnih naloga</h2>
        <WorkOrderHistory scope={{ customerId: customer.id }} />
      </section>

      {showEdit && (
        <Modal title="Izmena klijenta" onClose={() => setShowEdit(false)}>
          <CustomerForm initial={customer} withContacts={false} submitting={saving} error={formError} onSubmit={saveEdit} />
        </Modal>
      )}
    </div>
  );
}

/** Vozila kojima je klijent trenutni vlasnik. */
function CustomerVehicles({ customerId }: { customerId: number }): React.JSX.Element {
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  useEffect(() => {
    void (async () => {
      const res = await api.get<Paginated<Vehicle>>(`/vehicles?customerId=${customerId}&pageSize=50`);
      setVehicles(res.data);
    })();
  }, [customerId]);

  if (!vehicles) return <p className="card-empty">Učitavanje…</p>;
  if (vehicles.length === 0) return <p className="card-empty">Klijent nema vozila.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>Tablica</th><th>Vozilo</th><th>VIN</th><th>Godište</th></tr></thead>
        <tbody>
          {vehicles.map((v) => (
            <tr key={v.id} className="clickable" onClick={() => navigate(`/vozila/${v.id}`)}>
              <td className="mono strong" data-label="Tablica">{v.currentPlate ?? '—'}</td>
              <td data-label="Vozilo">{v.make} {v.model}</td>
              <td className="mono" data-label="VIN">{v.vin}</td>
              <td className="mono" data-label="Godište">{v.year ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
