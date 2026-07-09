import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Customer, CustomerInput, Paginated } from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { Modal } from '../components/Modal.tsx';
import { CustomerForm } from '../components/CustomerForm.tsx';

type Tab = 'all' | 'individual' | 'company' | 'archived';
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'Svi' },
  { key: 'individual', label: 'Fizička lica' },
  { key: 'company', label: 'Pravna lica' },
  { key: 'archived', label: 'Arhivirani' },
];

function tabParams(tab: Tab): string {
  if (tab === 'archived') return 'status=archived';
  if (tab === 'individual') return 'status=active&type=individual';
  if (tab === 'company') return 'status=active&type=company';
  return 'status=active';
}

function primary(c: Customer, kind: 'phone' | 'email'): string {
  return c.contacts.find((x) => x.kind === kind && x.isPrimary)?.value ?? '—';
}

export function Customers(): React.JSX.Element {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<Customer> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams(tabParams(tab));
    params.set('page', String(page));
    if (q.trim()) params.set('q', q.trim());
    try {
      setResult(await api.get<Paginated<Customer>>(`/customers?${params.toString()}`));
    } finally {
      setLoading(false);
    }
  }, [tab, page, q]);

  // debounce pretrage
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function createCustomer(input: CustomerInput): Promise<void> {
    setSaving(true);
    setFormError(null);
    try {
      const created = await api.post<Customer>('/customers', input);
      setShowNew(false);
      navigate(`/klijenti/${created.id}`);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setFormError(
          err.body.existingId
            ? `${err.body.message} (postojeći klijent #${err.body.existingId})`
            : err.body.message,
        );
      } else setFormError('Greška pri čuvanju.');
    } finally {
      setSaving(false);
    }
  }

  const meta = result?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <h1>Klijenti</h1>
          {meta && <p className="page-sub">{meta.total} ukupno</p>}
        </div>
        <button className="btn-primary" onClick={() => { setFormError(null); setShowNew(true); }}>
          + Novi klijent
        </button>
      </header>

      <div className="toolbar">
        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => { setTab(t.key); setPage(1); }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          className="search"
          placeholder="Pretraga (ime, PIB/JMBG)…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Naziv</th>
              <th>Tip</th>
              <th>PIB / JMBG</th>
              <th>Telefon</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            {result?.data.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => navigate(`/klijenti/${c.id}`)}>
                <td className="strong">{c.name}</td>
                <td>{c.type === 'company' ? 'Pravno' : 'Fizičko'}</td>
                <td className="mono">{c.taxId ?? '—'}</td>
                <td className="mono">{primary(c, 'phone')}</td>
                <td>{primary(c, 'email')}</td>
              </tr>
            ))}
            {!loading && result?.data.length === 0 && (
              <tr>
                <td colSpan={5} className="table-empty">
                  Nema klijenata za ovaj filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {meta && totalPages > 1 && (
        <div className="pager">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prethodna</button>
          <span>Strana {page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Sledeća ›</button>
        </div>
      )}

      {showNew && (
        <Modal title="Novi klijent" onClose={() => setShowNew(false)}>
          <CustomerForm withContacts submitting={saving} error={formError} onSubmit={createCustomer} />
        </Modal>
      )}
    </div>
  );
}
