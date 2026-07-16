import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type {
  WorkOrderDetail as WOD, WorkOrderStatus, FieldVisitOutcome, WorkOrderInput, Document,
  LaborItem, LaborItemInput, PartItem, PartItemInput, ExternalItem, ExternalItemInput,
} from '@karton/shared';
import { labels } from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { Modal } from '../components/Modal.tsx';
import { LaborItemForm, PartItemForm, ExternalItemForm } from '../components/workOrderItems.tsx';
import { WorkOrderEditForm } from '../components/WorkOrderEditForm.tsx';
import { DocumentChainBar } from '../components/DocumentChain.tsx';
import { LinkQuoteDialog } from '../components/LinkQuoteDialog.tsx';
import { PhotoSection } from '../components/PhotoSection.tsx';
import { allowedTransitions, isEditable, statusClass } from '../lib/workOrderStatus.ts';
import { money, formatDate } from '../lib/documentHelpers.ts';

const outcomeLabel: Record<FieldVisitOutcome, string> = labels.fieldVisitOutcome;

type Dialog =
  | { kind: 'labor'; item?: LaborItem }
  | { kind: 'part'; item?: PartItem }
  | { kind: 'external'; item?: ExternalItem }
  | { kind: 'status' }
  | { kind: 'edit' }
  | { kind: 'linkQuote' }
  | null;

export function WorkOrderDetail(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [wo, setWo] = useState<WOD | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setWo(await api.get<WOD>(`/work-orders/${id}`)); }
    catch (err) { if (err instanceof ApiRequestError && err.status === 404) setNotFound(true); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function saveItem(path: string, method: 'post' | 'patch', body: unknown): Promise<void> {
    setSaving(true);
    try {
      const updated = method === 'post' ? await api.post<WOD>(path, body) : await api.patch<WOD>(path, body);
      setWo(updated);
      setDialog(null);
    } finally { setSaving(false); }
  }
  async function removeItem(type: string, itemId: number): Promise<void> {
    setWo(await api.del<WOD>(`/work-orders/${id}/${type}/${itemId}`));
  }

  async function saveHeader(input: WorkOrderInput & { reason?: string | null }): Promise<void> {
    setSaving(true); setEditError(null);
    try {
      setWo(await api.patch<WOD>(`/work-orders/${id}`, input));
      setDialog(null);
    } catch (e) {
      setEditError(e instanceof ApiRequestError ? e.body.message : 'Greška pri čuvanju.');
    } finally { setSaving(false); }
  }

  async function linkQuote(quote: Document): Promise<void> {
    if (!wo) return;
    setSaving(true);
    try {
      setWo(await api.post<WOD>(`/work-orders/${id}/link-quote`, { quoteId: quote.id, version: wo.version }));
      setDialog(null);
    } catch (e) {
      alert(e instanceof ApiRequestError ? e.body.message : 'Greška pri vezivanju ponude.');
    } finally { setSaving(false); }
  }

  async function unlinkQuote(): Promise<void> {
    if (!wo || !confirm('Skinuti ponudu sa ovog naloga?')) return;
    setSaving(true);
    try { setWo(await api.post<WOD>(`/work-orders/${id}/unlink-quote`, { version: wo.version })); }
    catch (e) { alert(e instanceof ApiRequestError ? e.body.message : 'Greška.'); }
    finally { setSaving(false); }
  }

  async function issueProforma(): Promise<void> {
    setSaving(true);
    try {
      const doc = await api.post<{ id: number }>('/documents', { type: 'proforma', workOrderId: Number(id) });
      navigate(`/dokumenti/${doc.id}`);
    } catch (e) {
      alert(e instanceof ApiRequestError ? e.body.message : 'Greška pri izdavanju predračuna.');
    } finally { setSaving(false); }
  }

  if (loading) return <div className="page"><p className="card-empty">Učitavanje…</p></div>;
  if (notFound || !wo) return <div className="page"><p className="card-empty">Nalog ne postoji.</p></div>;

  const editable = isEditable(wo.status);

  const laborBase = `/work-orders/${id}/labor-items`;
  const partBase = `/work-orders/${id}/part-items`;
  const extBase = `/work-orders/${id}/external-items`;

  return (
    <div className="page">
      <button className="link-back" onClick={() => navigate('/nalozi')}>‹ Radni nalozi</button>

      <header className="page-head row">
        <div>
          <h1><span className="mono">{wo.number}</span>
            <span className={`badge ${statusClass[wo.status]}`} style={{ marginLeft: 10 }}>{labels.workOrderStatus[wo.status]}</span>
            {wo.fieldVisit && <span className="badge badge-accent" style={{ marginLeft: 6 }}>teren</span>}
          </h1>
          <p className="page-sub">
            <button className="btn-link mono" onClick={() => navigate(`/vozila/${wo.vehicle.id}`)}>{wo.vehicle.plate ?? wo.vehicle.vin}</button>
            {' '}{wo.vehicle.make} {wo.vehicle.model} · <button className="btn-link" onClick={() => navigate(`/klijenti/${wo.customer.id}`)}>{wo.customer.name}</button>
          </p>
        </div>
        <div className="btn-group">
          {editable && <button className="btn-secondary" onClick={() => { setEditError(null); setDialog({ kind: 'edit' }); }}>Izmeni nalog</button>}
          <button className="btn-secondary" onClick={() => window.open(`/nalozi/${id}/stampa`, '_blank')}>Štampaj radni nalog</button>
          {wo.status !== 'cancelled' && (
            <button className="btn-secondary" onClick={issueProforma} disabled={saving}>Izdaj predračun</button>
          )}
          <button className="btn-secondary" onClick={() => setDialog({ kind: 'status' })}>Promeni status</button>
        </div>
      </header>

      <DocumentChainBar
        chain={wo.chain}
        currentId={-1}
        onAddQuote={editable && !wo.sourceQuoteId ? () => setDialog({ kind: 'linkQuote' }) : undefined}
      />

      {editable && wo.sourceQuoteId && (
        <div className="inline-actions">
          <button className="btn-secondary btn-sm btn-unlink" onClick={unlinkQuote} disabled={saving}
            title="Nalog ostaje, ponuda se samo odvezuje">↩ Skini ponudu sa naloga</button>
        </div>
      )}

      <div className="card-grid">
        <section className="card">
          <h2 className="card-title">Prijem</h2>
          <dl className="kv">
            <dt>Datum</dt><dd className="mono">{formatDate(wo.receivedOn)}{wo.receivedTime ? ` ${wo.receivedTime}` : ''}</dd>
            <dt>Kilometraža</dt><dd className="mono">{wo.odometerKm != null ? `${money(wo.odometerKm)} km` : '—'}</dd>
            <dt>Završen</dt><dd className="mono">{formatDate(wo.completedOn)}{wo.completedTime ? ` ${wo.completedTime}` : ''}</dd>
          </dl>
        </section>
        <section className="card">
          <h2 className="card-title">Opis</h2>
          <dl className="kv">
            <dt>Zahtevano</dt><dd>{wo.requestedWork ?? '—'}</dd>
            <dt>Utvrđeno</dt><dd>{wo.findings ?? '—'}</dd>
            <dt>Napomena</dt><dd>{wo.note ?? '—'}</dd>
          </dl>
        </section>
        {wo.fieldVisit && (
          <section className="card">
            <h2 className="card-title">Izlazak na teren</h2>
            <dl className="kv">
              <dt>Kada</dt><dd className="mono">{formatDate(wo.fieldVisitDate)}{wo.fieldVisitTime ? ` ${wo.fieldVisitTime}` : ''}</dd>
              <dt>Lokacija</dt><dd>{wo.fieldVisitLocation ?? '—'}</dd>
              <dt>Pređeno</dt><dd className="mono">{wo.fieldVisitKm != null ? `${wo.fieldVisitKm} km` : '—'}</dd>
              <dt>Ishod</dt><dd>{wo.fieldVisitOutcome ? outcomeLabel[wo.fieldVisitOutcome] : '—'}</dd>
            </dl>
          </section>
        )}
      </div>

      <PhotoSection workOrderId={wo.id} editable={editable} />

      {/* Rad majstora */}
      <ItemSection title="Rad majstora" onAdd={editable ? () => setDialog({ kind: 'labor' }) : undefined} addLabel="+ Dodaj rad">
        <table className="data-table">
          <thead><tr><th>Majstor</th><th>Naziv</th><th>Obračun</th><th className="ta-r">Iznos</th>{editable && <th></th>}</tr></thead>
          <tbody>
            {wo.laborItems.map((it) => (
              <tr key={it.id}>
                <td>{it.mechanicName} <span className="muted">· {labels.specialty[it.specialty]}</span></td>
                <td className="strong">{it.name}</td>
                <td className="muted">{it.billingUnit === 'flat' ? 'paušal' : `${it.quantity} ${it.billingUnit === 'hour' ? 'h' : 'km'} × ${money(it.unitPrice!)}`}</td>
                <td className="ta-r mono">{money(it.amount)}</td>
                {editable && <td className="ta-r"><RowActions onEdit={() => setDialog({ kind: 'labor', item: it })} onDel={() => removeItem('labor-items', it.id)} /></td>}
              </tr>
            ))}
            {wo.laborItems.length === 0 && <tr><td colSpan={editable ? 5 : 4} className="card-empty">Nema stavki rada.</td></tr>}
          </tbody>
        </table>
      </ItemSection>

      {/* Delovi */}
      <ItemSection title="Delovi" onAdd={editable ? () => setDialog({ kind: 'part' }) : undefined} addLabel="+ Dodaj deo">
        <table className="data-table">
          <thead><tr><th>Naziv</th><th className="ta-r">Količina</th><th className="ta-r">Cena/jed.</th><th className="ta-r">Iznos</th>{editable && <th></th>}</tr></thead>
          <tbody>
            {wo.partItems.map((it) => (
              <tr key={it.id} className={it.internalNoCharge ? 'row-internal' : ''}>
                <td className="strong">{it.name}{it.internalNoCharge && <span className="badge badge-accent" style={{ marginLeft: 8 }}>interno</span>}</td>
                <td className="ta-r mono">{it.quantity}</td>
                <td className="ta-r mono">{money(it.unitPrice)}</td>
                <td className="ta-r mono">{money(it.amount)}</td>
                {editable && <td className="ta-r"><RowActions onEdit={() => setDialog({ kind: 'part', item: it })} onDel={() => removeItem('part-items', it.id)} /></td>}
              </tr>
            ))}
            {wo.partItems.length === 0 && <tr><td colSpan={editable ? 5 : 4} className="card-empty">Nema delova.</td></tr>}
          </tbody>
        </table>
      </ItemSection>

      {/* Eksterni servis */}
      <ItemSection title="Eksterni servis" onAdd={editable ? () => setDialog({ kind: 'external' }) : undefined} addLabel="+ Dodaj eksterni">
        <table className="data-table">
          <thead><tr><th>Radnja</th><th>Opis</th><th className="ta-r">Cena</th>{editable && <th></th>}</tr></thead>
          <tbody>
            {wo.externalItems.map((it) => (
              <tr key={it.id} className={it.internalNoCharge ? 'row-internal' : ''}>
                <td className="strong">{it.vendorName}{it.internalNoCharge && <span className="badge badge-accent" style={{ marginLeft: 8 }}>interno</span>}</td>
                <td className="muted">{it.description ?? '—'}</td>
                <td className="ta-r mono">{money(it.price)}</td>
                {editable && <td className="ta-r"><RowActions onEdit={() => setDialog({ kind: 'external', item: it })} onDel={() => removeItem('external-items', it.id)} /></td>}
              </tr>
            ))}
            {wo.externalItems.length === 0 && <tr><td colSpan={editable ? 4 : 3} className="card-empty">Nema eksternog servisa.</td></tr>}
          </tbody>
        </table>
      </ItemSection>

      <div className="totals-card">
        <div className="totals-row"><span>Rad</span><span className="mono">{money(wo.totals.labor)}</span></div>
        <div className="totals-row"><span>Delovi</span><span className="mono">{money(wo.totals.parts)}</span></div>
        <div className="totals-row"><span>Eksterni servis</span><span className="mono">{money(wo.totals.external)}</span></div>
        <div className="totals-row grand"><span>Ukupno</span><span className="mono">{money(wo.totals.total)} RSD</span></div>
      </div>

      {/* Modali stavki */}
      {dialog?.kind === 'labor' && (
        <Modal title={dialog.item ? 'Izmena rada' : 'Dodaj rad'} onClose={() => setDialog(null)}>
          <LaborItemForm initial={dialog.item} submitting={saving}
            onSubmit={(b: LaborItemInput) => saveItem(dialog.item ? `${laborBase}/${dialog.item.id}` : laborBase, dialog.item ? 'patch' : 'post', b)} />
        </Modal>
      )}
      {dialog?.kind === 'part' && (
        <Modal title={dialog.item ? 'Izmena dela' : 'Dodaj deo'} onClose={() => setDialog(null)}>
          <PartItemForm initial={dialog.item} submitting={saving}
            onSubmit={(b: PartItemInput) => saveItem(dialog.item ? `${partBase}/${dialog.item.id}` : partBase, dialog.item ? 'patch' : 'post', b)} />
        </Modal>
      )}
      {dialog?.kind === 'external' && (
        <Modal title={dialog.item ? 'Izmena eksternog servisa' : 'Dodaj eksterni servis'} onClose={() => setDialog(null)}>
          <ExternalItemForm initial={dialog.item} submitting={saving}
            onSubmit={(b: ExternalItemInput) => saveItem(dialog.item ? `${extBase}/${dialog.item.id}` : extBase, dialog.item ? 'patch' : 'post', b)} />
        </Modal>
      )}
      {dialog?.kind === 'edit' && (
        <Modal title={`Izmena naloga ${wo.number}`} onClose={() => setDialog(null)} width={620}>
          <WorkOrderEditForm wo={wo} submitting={saving} error={editError} onSubmit={saveHeader} />
        </Modal>
      )}

      {dialog?.kind === 'linkQuote' && (
        <Modal title="Veži ponudu za nalog" onClose={() => setDialog(null)} width={560}>
          <LinkQuoteDialog vehicleId={wo.vehicle.id} onPick={linkQuote} busy={saving} />
        </Modal>
      )}

      {dialog?.kind === 'status' && (
        <StatusModal wo={wo} isAdmin={user?.role === 'admin'} onClose={() => setDialog(null)} onDone={(u) => { setWo(u); setDialog(null); }} />
      )}
    </div>
  );
}

function ItemSection({ title, addLabel, onAdd, children }: { title: string; addLabel: string; onAdd?: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="card">
      <div className="card-title-row">
        <h2 className="card-title">{title}</h2>
        {onAdd && <button className="btn-link" onClick={onAdd}>{addLabel}</button>}
      </div>
      <div className="table-wrap" style={{ border: 'none' }}>{children}</div>
    </section>
  );
}

function RowActions({ onEdit, onDel }: { onEdit: () => void; onDel: () => void }): React.JSX.Element {
  return (
    <span className="row-actions">
      <button className="btn-link" onClick={onEdit}>izmeni</button>
      <button className="btn-link danger" onClick={() => { if (confirm('Ukloniti stavku?')) void onDel(); }}>ukloni</button>
    </span>
  );
}

function StatusModal({ wo, isAdmin, onClose, onDone }: { wo: WOD; isAdmin: boolean; onClose: () => void; onDone: (u: WOD) => void }): React.JSX.Element {
  const options = allowedTransitions(wo.status, isAdmin);
  const [target, setTarget] = useState<WorkOrderStatus | ''>('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsReason = options.find((o) => o.to === target)?.adminOnly ?? false;

  async function apply(): Promise<void> {
    if (!target) return;
    setSaving(true); setError(null);
    try {
      const u = await api.post<WOD>(`/work-orders/${wo.id}/status`, { status: target, version: wo.version, reason: reason.trim() || undefined });
      onDone(u);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : 'Greška.');
    } finally { setSaving(false); }
  }

  return (
    <Modal title="Promena statusa" onClose={onClose}>
      <div className="form">
        <p className="hint">Trenutno: <strong>{labels.workOrderStatus[wo.status]}</strong></p>
        {options.length === 0 && <p className="card-empty">Nema dozvoljenih prelaza iz ovog statusa.</p>}
        <div className="status-options">
          {options.map((o) => (
            <label key={o.to} className={`status-opt ${target === o.to ? 'active' : ''}`}>
              <input type="radio" name="st" checked={target === o.to} onChange={() => setTarget(o.to)} />
              {labels.workOrderStatus[o.to]}{o.adminOnly && <span className="muted"> (admin)</span>}
            </label>
          ))}
        </div>
        {needsReason && (
          <label className="field"><span>Razlog (obavezno)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
        )}
        {error && <div className="login-error">{error}</div>}
        <div className="form-actions">
          <button className="btn-primary" disabled={!target || saving || (needsReason && !reason.trim())} onClick={apply}>Primeni</button>
        </div>
      </div>
    </Modal>
  );
}
