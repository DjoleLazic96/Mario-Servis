import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { DateInput } from '../components/DateInput.tsx';
import { useParams, useNavigate } from 'react-router-dom';
import type { DocumentDetail, DocumentItem } from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { Modal } from '../components/Modal.tsx';
import { DocumentChainBar } from '../components/DocumentChain.tsx';
import { docTypeLabel, docStatusLabel, docStatusClass, money, dueInfo, validityWarn, formatDate } from '../lib/documentHelpers.ts';

const RUBRICS: { key: DocumentItem['itemType']; title: string }[] = [
  { key: 'labor', title: 'Rad' },
  { key: 'part', title: 'Delovi' },
  { key: 'external', title: 'Eksterni servis' },
];

type Dialog = 'convert' | 'markPaid' | 'unmarkPaid' | 'edit' | 'fixPayment' | null;

export function DocumentView(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setDoc(await api.get<DocumentDetail>(`/documents/${id}`)); }
    catch (e) { if (e instanceof ApiRequestError && e.status === 404) setNotFound(true); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function patchDoc(body: unknown): Promise<void> {
    setBusy(true); setErr(null);
    try {
      setDoc(await api.patch<DocumentDetail>(`/documents/${id}`, body));
      setDialog(null);
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.body.message : 'Greška.');
    } finally { setBusy(false); }
  }

  async function action(path: string, body?: unknown, onOk?: (d: DocumentDetail) => void): Promise<void> {
    setBusy(true); setErr(null);
    try {
      const updated = await api.post<DocumentDetail>(path, body ?? {});
      setDialog(null);
      if (onOk) onOk(updated); else setDoc(updated);
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.body.message : 'Greška.');
    } finally { setBusy(false); }
  }

  if (loading) return <div className="page"><p className="card-empty">Učitavanje…</p></div>;
  if (notFound || !doc) return <div className="page"><p className="card-empty">Dokument ne postoji.</p></div>;

  const v = doc.version;
  const due = doc.type === 'invoice' ? dueInfo(doc.dueOn) : null;
  const expired = (doc.type === 'quote' || doc.type === 'proforma') && validityWarn(doc.validUntil);

  return (
    <div className="page">
      <button className="link-back" onClick={() => navigate('/dokumenti')}>‹ Dokumenti</button>

      <DocumentChainBar chain={doc.chain} currentId={doc.id} />

      <header className="page-head row" style={{ marginTop: 16 }}>
        <div>
          <h1><span className="mono">{doc.number}</span>
            <span className={`badge ${docStatusClass[doc.status]}`} style={{ marginLeft: 10 }}>{docStatusLabel(doc.type, doc.status)}</span>
          </h1>
          <p className="page-sub">{docTypeLabel[doc.type]} · {doc.customer.name} · <span className="mono">{doc.vehicle.plate ?? doc.vehicle.vin}</span> {doc.vehicle.make} {doc.vehicle.model}</p>
        </div>
        <button className="btn-secondary" onClick={() => window.print()}>Štampaj / PDF</button>
      </header>

      {/* Akcije po tipu/statusu */}
      <div className="doc-actions">
        {doc.type === 'quote' && doc.status === 'pending' && (
          <>
            <button className="btn-primary" onClick={() => action(`/documents/${id}/accept`, { version: v })}>Prihvati</button>
            <button className="btn-secondary" onClick={() => action(`/documents/${id}/reject`, { version: v })}>Odbij</button>
          </>
        )}
        {doc.type === 'proforma' && doc.status === 'valid' && (
          <button className="btn-primary" onClick={() => setDialog('convert')}>Pretvori u račun</button>
        )}
        {doc.type === 'invoice' && doc.status === 'unpaid' && (
          <>
            <button className="btn-primary" onClick={() => setDialog('markPaid')}>Naznači plaćeno</button>
            <button className="btn-secondary" onClick={() => { if (confirm('Ispraviti račun? Postojeći postaje neispravan, otvara se nov predračun.')) void action(`/documents/${id}/correct`, { version: v }, (d) => navigate(`/dokumenti/${d.id}`)); }}>Ispravi</button>
          </>
        )}
        {doc.type === 'invoice' && doc.status === 'paid' && user?.role === 'admin' && (
          <button className="btn-secondary" onClick={() => setDialog('unmarkPaid')}>Vrati na neplaćeno</button>
        )}
        {((doc.type === 'quote' && doc.status === 'pending') || (doc.type === 'proforma' && doc.status === 'valid')) && (
          <button className="btn-secondary" onClick={() => { setErr(null); setDialog('edit'); }}>Izmeni</button>
        )}
        {doc.type === 'invoice' && doc.status === 'paid' && user?.role === 'admin' && (
          <button className="btn-secondary" onClick={() => { setErr(null); setDialog('fixPayment'); }}>Ispravi plaćanje</button>
        )}
        {(doc.type === 'quote' || doc.type === 'proforma') && (
          <button className="btn-secondary" onClick={() => action(`/documents/${id}/copy`, {}, (d) => navigate(`/dokumenti/${d.id}`))}>Kopiraj</button>
        )}
      </div>
      {err && <div className="login-error" style={{ maxWidth: 480 }}>{err}</div>}

      {/* Papir dokumenta */}
      <div className="doc-paper">
        <div className="doc-meta">
          <div><span className="dm-label">Datum izdavanja</span><span className="mono">{formatDate(doc.issuedOn)}</span></div>
          {doc.type === 'invoice'
            ? <div><span className="dm-label">Datum dospeća</span><span className="mono">{formatDate(doc.dueOn)}</span>{due && <span className={`due-tag ${due.warn ? 'warn' : ''}`}>{due.text}</span>}</div>
            : <div><span className="dm-label">Rok važenja</span><span className="mono">{formatDate(doc.validUntil)}</span>{expired && <span className="due-tag warn">isteklo</span>}</div>}
          {doc.paidOn && <div><span className="dm-label">Plaćeno</span><span className="mono">{formatDate(doc.paidOn)}</span> {doc.paymentMethod}</div>}
        </div>

        {RUBRICS.map((rub) => {
          const items = doc.items.filter((i) => i.itemType === rub.key);
          if (items.length === 0) return null; // prazna rubrika se ne prikazuje (BR-26)
          return (
            <div className="doc-rubric" key={rub.key}>
              <h3>{rub.title}</h3>
              <table className="doc-item-table">
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id}>
                      <td>{it.name}</td>
                      <td className="ta-r muted">{it.quantity != null && it.unitPrice != null ? `${it.quantity} ${it.billingUnit === 'km' ? 'km' : it.billingUnit === 'hour' ? 'h' : ''} × ${money(it.unitPrice)}` : it.quantity != null ? `${it.quantity} ${it.billingUnit === 'hour' ? 'h' : ''}` : ''}</td>
                      <td className="ta-r mono">{money(it.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        {doc.items.length === 0 && <p className="card-empty">Dokument nema stavki.</p>}

        <div className="doc-total">
          <span>Ukupno</span>
          <span className="mono">{money(doc.totalAmount)} RSD</span>
        </div>
        {doc.amountEur != null && <div className="doc-eur">≈ {money(doc.amountEur)} EUR <span className="muted">(informativno)</span></div>}
        {doc.note && <p className="doc-note">{doc.note}</p>}
      </div>

      {/* Modali akcija */}
      {dialog === 'convert' && <ConvertModal onClose={() => setDialog(null)} busy={busy} error={err}
        onSubmit={(dueOn) => action(`/documents/${id}/convert`, { dueOn, version: v }, (d) => navigate(`/dokumenti/${d.id}`))} />}
      {dialog === 'markPaid' && <MarkPaidModal onClose={() => setDialog(null)} busy={busy} error={err}
        onSubmit={(paidOn, method) => action(`/documents/${id}/mark-paid`, { paidOn, paymentMethod: method, version: v })} />}
      {dialog === 'unmarkPaid' && <ReasonModal title="Vrati na neplaćeno" onClose={() => setDialog(null)} busy={busy} error={err}
        onSubmit={(reason) => action(`/documents/${id}/unmark-paid`, { reason, version: v })} />}
      {dialog === 'edit' && <EditDocModal doc={doc} onClose={() => setDialog(null)} busy={busy} error={err}
        onSubmit={(body) => patchDoc({ ...body, version: v })} />}
      {dialog === 'fixPayment' && <FixPaymentModal doc={doc} onClose={() => setDialog(null)} busy={busy} error={err}
        onSubmit={(paidOn, method, reason) => action(`/documents/${id}/payment`, { paidOn, paymentMethod: method, reason, version: v })} />}
    </div>
  );
}

/**
 * Izmena ponude (dok je na čekanju) i predračuna (dok važi) — BR-16 dopušta samo
 * rok važenja, informativni EUR iznos i napomenu. Stavke predračuna su snapshot i ne diraju se.
 */
function EditDocModal({ doc, onClose, onSubmit, busy, error }: {
  doc: DocumentDetail; onClose: () => void;
  onSubmit: (body: { validUntil?: string; amountEur: number | null; note: string | null }) => void;
  busy: boolean; error: string | null;
}): React.JSX.Element {
  const [validUntil, setValidUntil] = useState(doc.validUntil ?? '');
  const [amountEur, setAmountEur] = useState(doc.amountEur === null ? '' : String(doc.amountEur));
  const [note, setNote] = useState(doc.note ?? '');
  return (
    <Modal title={`Izmena — ${doc.number}`} onClose={onClose}>
      <form className="form" onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit({ validUntil: validUntil || undefined, amountEur: amountEur ? Number(amountEur) : null, note: note.trim() || null });
      }}>
        <label className="field"><span>Rok važenja</span>
          <DateInput value={validUntil} onChange={setValidUntil} autoFocus /></label>
        <label className="field"><span>Iznos u EUR <small className="hint">(informativno, ne zamenjuje RSD)</small></span>
          <input type="number" step="0.01" min={0} value={amountEur} onChange={(e) => setAmountEur(e.target.value)} placeholder="npr. 250.00" /></label>
        <label className="field"><span>Napomena</span>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {error && <div className="login-error">{error}</div>}
        <div className="form-actions"><button type="submit" className="btn-primary" disabled={busy}>Sačuvaj</button></div>
      </form>
    </Modal>
  );
}

/** Admin ispravka podataka o plaćanju na već plaćenom računu — razlog ide u istoriju izmena. */
function FixPaymentModal({ doc, onClose, onSubmit, busy, error }: {
  doc: DocumentDetail; onClose: () => void;
  onSubmit: (paidOn: string, method: string, reason: string) => void;
  busy: boolean; error: string | null;
}): React.JSX.Element {
  const [paidOn, setPaidOn] = useState(doc.paidOn ?? '');
  const [method, setMethod] = useState(doc.paymentMethod ?? 'gotovina');
  const [reason, setReason] = useState('');
  return (
    <Modal title="Ispravi podatke o plaćanju" onClose={onClose}>
      <form className="form" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(paidOn, method, reason); }}>
        <label className="field"><span>Datum plaćanja</span><DateInput value={paidOn} onChange={setPaidOn} required autoFocus /></label>
        <label className="field"><span>Način plaćanja</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)}><option>gotovina</option><option>kartica</option><option>prenos</option></select></label>
        <label className="field"><span>Razlog (obavezno)</span><input value={reason} onChange={(e) => setReason(e.target.value)} required /></label>
        {error && <div className="login-error">{error}</div>}
        <div className="form-actions"><button type="submit" className="btn-primary" disabled={busy || !reason.trim() || !paidOn}>Sačuvaj</button></div>
      </form>
    </Modal>
  );
}

function ConvertModal({ onClose, onSubmit, busy, error }: { onClose: () => void; onSubmit: (dueOn: string) => void; busy: boolean; error: string | null }): React.JSX.Element {
  const [dueOn, setDueOn] = useState('');
  return (
    <Modal title="Pretvori u račun" onClose={onClose}>
      <form className="form" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(dueOn); }}>
        <label className="field"><span>Datum dospeća</span><DateInput value={dueOn} onChange={setDueOn} required autoFocus /></label>
        {error && <div className="login-error">{error}</div>}
        <div className="form-actions"><button type="submit" className="btn-primary" disabled={busy || !dueOn}>Pretvori u račun</button></div>
      </form>
    </Modal>
  );
}

function MarkPaidModal({ onClose, onSubmit, busy, error }: { onClose: () => void; onSubmit: (paidOn: string, method: string) => void; busy: boolean; error: string | null }): React.JSX.Element {
  const [paidOn, setPaidOn] = useState(new Date().toLocaleDateString('sv-SE'));
  const [method, setMethod] = useState('gotovina');
  return (
    <Modal title="Naznači plaćeno" onClose={onClose}>
      <form className="form" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(paidOn, method); }}>
        <label className="field"><span>Datum plaćanja</span><DateInput value={paidOn} onChange={setPaidOn} required autoFocus /></label>
        <label className="field"><span>Način plaćanja</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)}><option>gotovina</option><option>kartica</option><option>prenos</option></select></label>
        {error && <div className="login-error">{error}</div>}
        <div className="form-actions"><button type="submit" className="btn-primary" disabled={busy}>Potvrdi</button></div>
      </form>
    </Modal>
  );
}

function ReasonModal({ title, onClose, onSubmit, busy, error }: { title: string; onClose: () => void; onSubmit: (reason: string) => void; busy: boolean; error: string | null }): React.JSX.Element {
  const [reason, setReason] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <form className="form" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(reason); }}>
        <label className="field"><span>Razlog (obavezno)</span><input value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus /></label>
        {error && <div className="login-error">{error}</div>}
        <div className="form-actions"><button type="submit" className="btn-primary" disabled={busy || !reason.trim()}>Potvrdi</button></div>
      </form>
    </Modal>
  );
}
