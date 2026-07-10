import { useEffect, useState, useCallback } from 'react';
import type { Mechanic, MechanicInput, Service, ServiceInput } from '@karton/shared';
import { labels } from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { Modal } from '../components/Modal.tsx';
import { MechanicForm } from '../components/MechanicForm.tsx';
import { ServiceForm } from '../components/ServiceForm.tsx';
import { UnavailabilityManager } from '../components/UnavailabilityManager.tsx';
import { SortableTh } from '../components/SortableTh.tsx';
import { sortRows } from '../lib/sortRows.ts';

type Tab = 'mechanics' | 'services';

export function Pricelist(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('mechanics');
  return (
    <div className="page">
      <header className="page-head">
        <h1>Cenovnik</h1>
      </header>
      <div className="tabs" style={{ marginBottom: 16, width: 'fit-content' }}>
        <button className={`tab ${tab === 'mechanics' ? 'active' : ''}`} onClick={() => setTab('mechanics')}>Majstori</button>
        <button className={`tab ${tab === 'services' ? 'active' : ''}`} onClick={() => setTab('services')}>Usluge</button>
      </div>
      {tab === 'mechanics' ? <MechanicsTab /> : <ServicesTab />}
    </div>
  );
}

function MechanicsTab(): React.JSX.Element {
  const [list, setList] = useState<Mechanic[]>([]);
  const [sort, setSort] = useState<string | undefined>();
  const [dialog, setDialog] = useState<{ mode: 'new' } | { mode: 'edit'; mechanic: Mechanic } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setList(await api.get<Mechanic[]>('/mechanics')), []);
  useEffect(() => { void load(); }, [load]);

  async function save(input: MechanicInput): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      if (dialog?.mode === 'edit') await api.patch(`/mechanics/${dialog.mechanic.id}`, input);
      else await api.post('/mechanics', input);
      setDialog(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : 'Greška.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="row-end"><button className="btn-primary" onClick={() => { setError(null); setDialog({ mode: 'new' }); }}>+ Novi majstor</button></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>
            <SortableTh field="fullName" label="Ime" sort={sort} onSort={setSort} />
            <SortableTh field="specialty" label="Specijalnost" sort={sort} onSort={setSort} />
            <SortableTh field="hiredOn" label="Zaposlen" sort={sort} onSort={setSort} />
            <SortableTh field="hourlyRate" label="Cena/h" sort={sort} onSort={setSort} right />
            <SortableTh field="status" label="Status" sort={sort} onSort={setSort} />
          </tr></thead>
          <tbody>
            {sortRows(list, sort, (m, f) => m[f as keyof Mechanic]).map((m) => (
              <tr key={m.id} className="clickable" onClick={() => { setError(null); setDialog({ mode: 'edit', mechanic: m }); }}>
                <td className="strong">{m.fullName}</td>
                <td>{labels.specialty[m.specialty]}</td>
                <td className="mono">{m.hiredOn ?? '—'}</td>
                <td className="ta-r mono">{m.hourlyRate.toLocaleString('sr-RS')}</td>
                <td>{m.status === 'active' ? 'Aktivan' : <span className="muted">Neaktivan</span>}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={5} className="table-empty">Nema majstora.</td></tr>}
          </tbody>
        </table>
      </div>
      {dialog && (
        <Modal title={dialog.mode === 'edit' ? 'Izmena majstora' : 'Novi majstor'} onClose={() => setDialog(null)} width={520}>
          <MechanicForm initial={dialog.mode === 'edit' ? dialog.mechanic : undefined} submitting={saving} error={error} onSubmit={save} />
          {dialog.mode === 'edit' && (
            <><hr className="modal-sep" /><UnavailabilityManager mechanicId={dialog.mechanic.id} /></>
          )}
        </Modal>
      )}
    </>
  );
}

function ServicesTab(): React.JSX.Element {
  const [list, setList] = useState<Service[]>([]);
  const [sort, setSort] = useState<string | undefined>();
  const [dialog, setDialog] = useState<{ mode: 'new' } | { mode: 'edit'; service: Service } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setList(await api.get<Service[]>('/services')), []);
  useEffect(() => { void load(); }, [load]);

  async function save(input: ServiceInput): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      if (dialog?.mode === 'edit') await api.patch(`/services/${dialog.service.id}`, input);
      else await api.post('/services', input);
      setDialog(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : 'Greška.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="row-end"><button className="btn-primary" onClick={() => { setError(null); setDialog({ mode: 'new' }); }}>+ Nova usluga</button></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>
            <SortableTh field="name" label="Naziv" sort={sort} onSort={setSort} />
            <SortableTh field="billingUnit" label="Obračun" sort={sort} onSort={setSort} />
            <SortableTh field="defaultPrice" label="Cena" sort={sort} onSort={setSort} right />
            <SortableTh field="status" label="Status" sort={sort} onSort={setSort} />
          </tr></thead>
          <tbody>
            {sortRows(list, sort, (r, f) => r[f as keyof Service]).map((s) => (
              <tr key={s.id} className="clickable" onClick={() => { setError(null); setDialog({ mode: 'edit', service: s }); }}>
                <td className="strong">{s.name}</td>
                <td>{labels.laborBillingUnit[s.billingUnit]}</td>
                <td className="ta-r mono">{s.defaultPrice.toLocaleString('sr-RS')}{s.billingUnit === 'km' ? ' /km' : ''}</td>
                <td>{s.status === 'active' ? 'Aktivna' : <span className="muted">Neaktivna</span>}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={4} className="table-empty">Nema usluga u cenovniku.</td></tr>}
          </tbody>
        </table>
      </div>
      {dialog && (
        <Modal title={dialog.mode === 'edit' ? 'Izmena usluge' : 'Nova usluga'} onClose={() => setDialog(null)}>
          <ServiceForm initial={dialog.mode === 'edit' ? dialog.service : undefined} submitting={saving} error={error} onSubmit={save} />
        </Modal>
      )}
    </>
  );
}
