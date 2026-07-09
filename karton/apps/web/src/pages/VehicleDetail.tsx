import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type {
  Vehicle,
  VehicleInput,
  CustomerRef,
  OwnershipRecord,
  RegistrationRecord,
} from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { Modal } from '../components/Modal.tsx';
import { VehicleForm } from '../components/VehicleForm.tsx';
import { OwnerPicker } from '../components/OwnerPicker.tsx';

type Dialog = 'edit' | 'owner' | 'plate' | null;

export function VehicleDetail(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [ownership, setOwnership] = useState<OwnershipRecord[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [newOwner, setNewOwner] = useState<CustomerRef | null>(null);
  const [newPlate, setNewPlate] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [v, oh, rh] = await Promise.all([
        api.get<Vehicle>(`/vehicles/${id}`),
        api.get<OwnershipRecord[]>(`/vehicles/${id}/ownership`),
        api.get<RegistrationRecord[]>(`/vehicles/${id}/registrations`),
      ]);
      setVehicle(v);
      setOwnership(oh);
      setRegistrations(rh);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  function close(): void {
    setDialog(null);
    setFormError(null);
    setNewOwner(null);
    setNewPlate('');
  }

  async function saveEdit(input: VehicleInput): Promise<void> {
    setSaving(true);
    setFormError(null);
    try {
      setVehicle(await api.patch<Vehicle>(`/vehicles/${id}`, input));
      close();
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.body.message : 'Greška.');
    } finally {
      setSaving(false);
    }
  }

  async function changeOwner(): Promise<void> {
    if (!newOwner) return;
    setSaving(true);
    try {
      setVehicle(await api.post<Vehicle>(`/vehicles/${id}/ownership`, { customerId: newOwner.id }));
      close();
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function changePlate(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!newPlate.trim()) return;
    setSaving(true);
    try {
      setVehicle(await api.post<Vehicle>(`/vehicles/${id}/registrations`, { plate: newPlate.trim() }));
      close();
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(): Promise<void> {
    if (!vehicle) return;
    const action = vehicle.status === 'active' ? 'archive' : 'unarchive';
    setVehicle(await api.post<Vehicle>(`/vehicles/${id}/${action}`));
  }

  if (loading) return <div className="page"><p className="card-empty">Učitavanje…</p></div>;
  if (notFound || !vehicle) return <div className="page"><p className="card-empty">Vozilo ne postoji.</p></div>;

  return (
    <div className="page">
      <button className="link-back" onClick={() => navigate('/vozila')}>‹ Vozila</button>

      <header className="page-head row">
        <div>
          <h1>
            <span className="mono">{vehicle.currentPlate ?? 'bez tablice'}</span>
            {vehicle.status === 'archived' && <span className="badge badge-muted">Arhivirano</span>}
          </h1>
          <p className="page-sub">
            {vehicle.make} {vehicle.model}
            {vehicle.year ? ` · ${vehicle.year}` : ''} {vehicle.fuel ? `· ${vehicle.fuel}` : ''}
          </p>
        </div>
        <div className="btn-group">
          <button className="btn-secondary" onClick={() => { setFormError(null); setDialog('edit'); }}>Izmeni</button>
          <button className="btn-secondary" onClick={() => setDialog('owner')}>Promeni vlasnika</button>
          <button className="btn-secondary" onClick={() => setDialog('plate')}>Promeni tablicu</button>
          <button className="btn-secondary" onClick={toggleArchive}>
            {vehicle.status === 'active' ? 'Arhiviraj' : 'Dearhiviraj'}
          </button>
        </div>
      </header>

      <div className="card-grid">
        <section className="card">
          <h2 className="card-title">Podaci</h2>
          <dl className="kv">
            <dt>VIN</dt><dd className="mono">{vehicle.vin}</dd>
            <dt>Vlasnik</dt>
            <dd>
              {vehicle.currentOwner ? (
                <button className="btn-link" onClick={() => navigate(`/klijenti/${vehicle.currentOwner!.id}`)}>
                  {vehicle.currentOwner.name}
                </button>
              ) : '—'}
            </dd>
            <dt>Napomena</dt><dd>{vehicle.note ?? '—'}</dd>
          </dl>
        </section>

        <section className="card">
          <h2 className="card-title">Istorija registracije</h2>
          <table className="mini-table">
            <thead><tr><th>Tablica</th><th>Od</th><th>Do</th></tr></thead>
            <tbody>
              {registrations.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.plate}</td>
                  <td className="mono">{r.validFrom}</td>
                  <td className="mono">{r.validTo ?? <span className="badge badge-accent">aktivna</span>}</td>
                </tr>
              ))}
              {registrations.length === 0 && <tr><td colSpan={3} className="card-empty">Nema zapisa.</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2 className="card-title">Istorija vlasništva</h2>
          <table className="mini-table">
            <thead><tr><th>Vlasnik</th><th>Od</th><th>Do</th></tr></thead>
            <tbody>
              {ownership.map((o) => (
                <tr key={o.id}>
                  <td>{o.customer.name}</td>
                  <td className="mono">{o.validFrom}</td>
                  <td className="mono">{o.validTo ?? <span className="badge badge-accent">aktivan</span>}</td>
                </tr>
              ))}
              {ownership.length === 0 && <tr><td colSpan={3} className="card-empty">Nema zapisa.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card">
        <h2 className="card-title">Istorija servisa</h2>
        <p className="card-empty">Radni nalozi ovog vozila — uskoro.</p>
      </section>

      {dialog === 'edit' && (
        <Modal title="Izmena vozila" onClose={close} width={520}>
          <VehicleForm mode="edit" initial={vehicle} submitting={saving} error={formError} onSubmit={saveEdit} />
        </Modal>
      )}
      {dialog === 'owner' && (
        <Modal title="Promeni vlasnika" onClose={close}>
          <div className="form">
            <p className="hint">Zatvara trenutni zapis vlasništva i otvara novi (od danas).</p>
            <OwnerPicker value={newOwner} onChange={setNewOwner} />
            <div className="form-actions">
              <button className="btn-primary" disabled={!newOwner || saving} onClick={changeOwner}>
                {saving ? 'Čuvanje…' : 'Promeni vlasnika'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog === 'plate' && (
        <Modal title="Promeni tablicu" onClose={close}>
          <form className="form" onSubmit={changePlate}>
            <p className="hint">Zatvara trenutnu tablicu i otvara novu (od danas).</p>
            <label className="field">
              <span>Nova tablica</span>
              <input className="mono" autoFocus value={newPlate} onChange={(e) => setNewPlate(e.target.value.toUpperCase())} required />
            </label>
            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Čuvanje…' : 'Promeni tablicu'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
