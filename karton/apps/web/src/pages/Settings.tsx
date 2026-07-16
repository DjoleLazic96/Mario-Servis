import { useEffect, useState, useRef, type FormEvent } from 'react';
import type { BackupRun } from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { Modal } from '../components/Modal.tsx';
import { TimeInput } from '../components/TimeInput.tsx';
import { SortableTh } from '../components/SortableTh.tsx';
import { sortRows } from '../lib/sortRows.ts';

interface SettingsData {
  shopName: string; address: string | null; taxId: string | null; phone: string | null; logo: string | null;
  companyId: string | null; bankAccount: string | null; bankName: string | null; footerNote: string | null;
  smtpHost: string | null; smtpPort: number | null; smtpUsername: string | null; senderEmail: string | null;
  hasSmtpPassword: boolean;
  workHoursFrom: string; workHoursTo: string; defaultValidityDays: number; reminderSendTime: string; pageSize: number; version: number;
}
interface User { id: number; name: string; email: string; role: 'admin' | 'user'; status: 'active' | 'disabled' }

export function Settings(): React.JSX.Element {
  const [tab, setTab] = useState<'servis' | 'korisnici' | 'backup'>('servis');
  return (
    <div className="page">
      <header className="page-head"><h1>Podešavanja</h1></header>
      <div className="tabs" style={{ marginBottom: 16, width: 'fit-content' }}>
        <button className={`tab ${tab === 'servis' ? 'active' : ''}`} onClick={() => setTab('servis')}>Servis</button>
        <button className={`tab ${tab === 'korisnici' ? 'active' : ''}`} onClick={() => setTab('korisnici')}>Korisnici</button>
        <button className={`tab ${tab === 'backup' ? 'active' : ''}`} onClick={() => setTab('backup')}>Backup</button>
      </div>
      {tab === 'servis' ? <ServiceSettings /> : tab === 'korisnici' ? <Users /> : <Backup />}
    </div>
  );
}

const MAX_LOGO_BYTES = 400 * 1024;

function ServiceSettings(): React.JSX.Element {
  const [s, setS] = useState<SettingsData | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [smtpPassword, setSmtpPassword] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  useEffect(() => {
    void api.get<SettingsData>('/settings').then(setS).catch((e) => {
      setLoadErr(e instanceof ApiRequestError ? e.body.message : 'Podešavanja se ne mogu učitati.');
    });
  }, []);
  if (loadErr) return <div className="login-error" style={{ maxWidth: 420 }}>{loadErr}</div>;
  if (!s) return <p className="card-empty">Učitavanje…</p>;
  const set = (patch: Partial<SettingsData>): void => setS({ ...s, ...patch });

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault(); setSaving(true); setMsg(null);
    // prazno polje lozinke znači „ne menjaj" — backend radi coalesce
    const body = { ...s, smtpPassword: smtpPassword || undefined };
    try { setS(await api.patch<SettingsData>('/settings', body)); setSmtpPassword(''); setMsg('Sačuvano.'); }
    catch (err) { setMsg(err instanceof ApiRequestError ? err.body.message : 'Greška.'); }
    finally { setSaving(false); }
  }

  /** Šalje kroz SAČUVANA podešavanja (server ih čita iz baze) — istim putem kao pravi podsetnik. */
  async function sendTest(): Promise<void> {
    setTesting(true); setTestMsg(null);
    try {
      const r = await api.post<{ sentTo: string; host: string; source: string }>('/settings/test-email', { to: testTo.trim() });
      setTestMsg({ ok: true, text: `Poslato na ${r.sentTo} preko ${r.host}`
        + (r.source === 'env' ? ' — PAŽNJA: iz .env rezerve, jer SMTP host nije upisan gore.' : '.') });
    } catch (err) {
      setTestMsg({ ok: false, text: err instanceof ApiRequestError ? err.body.message : 'Slanje nije uspelo.' });
    } finally { setTesting(false); }
  }

  async function uploadLogo(file: File): Promise<void> {
    if (file.size > MAX_LOGO_BYTES) { setMsg('Logo je veći od 400 KB.'); return; }
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(new Error('Čitanje fajla nije uspelo.'));
      r.readAsDataURL(file);
    });
    setSaving(true); setMsg(null);
    try { setS(await api.put<SettingsData>('/settings/logo', { dataUrl })); setMsg('Sačuvano.'); }
    catch (err) { setMsg(err instanceof ApiRequestError ? err.body.message : 'Greška.'); }
    finally { setSaving(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function removeLogo(): Promise<void> {
    setSaving(true);
    try { setS(await api.del<SettingsData>('/settings/logo')); }
    finally { setSaving(false); }
  }
  return (
    <form className="card" onSubmit={save} style={{ maxWidth: 640 }}>
      <div className="form">
        <h3 className="card-title">Podaci servisa</h3>
        <label className="field"><span>Naziv</span><input value={s.shopName} onChange={(e) => set({ shopName: e.target.value })} required /></label>
        <div className="form-2col">
          <label className="field"><span>Adresa</span><input value={s.address ?? ''} onChange={(e) => set({ address: e.target.value })} /></label>
          <label className="field"><span>Telefon</span><input value={s.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} /></label>
        </div>
        <div className="form-2col">
          <label className="field"><span>PIB</span><input value={s.taxId ?? ''} onChange={(e) => set({ taxId: e.target.value })} /></label>
          <label className="field"><span>Matični broj</span><input value={s.companyId ?? ''} onChange={(e) => set({ companyId: e.target.value })} /></label>
        </div>
        <div className="form-2col">
          <label className="field"><span>Tekući račun <small className="hint">— na račun, da klijent ima gde da uplati</small></span>
            <input value={s.bankAccount ?? ''} onChange={(e) => set({ bankAccount: e.target.value })} placeholder="265-1110310008045-17" /></label>
          <label className="field"><span>Banka</span>
            <input value={s.bankName ?? ''} onChange={(e) => set({ bankName: e.target.value })} placeholder="Raiffeisen banka" /></label>
        </div>

        <label className="field">
          <span>Napomena u podnožju dokumenta <small className="hint">— zvaničan naziv i poreski status; štampa se na ponudi, predračunu i računu</small></span>
          <textarea rows={3} value={s.footerNote ?? ''} onChange={(e) => set({ footerNote: e.target.value })}
            placeholder="npr. …nije obveznik PDV-a po članu 33 Zakona o PDV." />
          <small className="hint">Ovo obavezno izmeniti ako servis uđe u sistem PDV-a — tada tekst više nije tačan.</small>
        </label>

        <div className="field">
          <span>Logo <small className="hint">(PNG/JPEG/SVG, do 400 KB — štampa se na prijemnom listu)</small></span>
          <div className="logo-row">
            {s.logo ? <img className="logo-preview" src={s.logo} alt="Logo servisa" /> : <div className="logo-preview empty">bez logoa</div>}
            <div className="btn-group">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); }} />
              <button type="button" className="btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={saving}>Otpremi logo</button>
              {s.logo && <button type="button" className="btn-link danger" onClick={removeLogo} disabled={saving}>Ukloni</button>}
            </div>
          </div>
        </div>

        <h3 className="card-title" style={{ marginTop: 8 }}>Radno vreme i rokovi</h3>
        <div className="form-2col">
          <label className="field"><span>Radno vreme od</span><TimeInput value={s.workHoursFrom} onChange={(v) => set({ workHoursFrom: v })} /></label>
          <label className="field"><span>do</span><TimeInput value={s.workHoursTo} onChange={(v) => set({ workHoursTo: v })} /></label>
        </div>
        <div className="form-2col">
          <label className="field"><span>Rok važenja (dana)</span><input type="number" min={1} value={s.defaultValidityDays} onChange={(e) => set({ defaultValidityDays: Number(e.target.value) })} /></label>
          <label className="field"><span>Vreme podsetnika</span><TimeInput value={s.reminderSendTime} onChange={(v) => set({ reminderSendTime: v })} /></label>
        </div>
        <label className="field"><span>Redova po strani</span><input type="number" min={5} value={s.pageSize} onChange={(e) => set({ pageSize: Number(e.target.value) })} /></label>

        <h3 className="card-title" style={{ marginTop: 8 }}>Email (SMTP)</h3>
        <div className="form-2col">
          <label className="field"><span>SMTP host</span><input value={s.smtpHost ?? ''} onChange={(e) => set({ smtpHost: e.target.value })} /></label>
          <label className="field"><span>Port</span><input type="number" value={s.smtpPort ?? ''} onChange={(e) => set({ smtpPort: Number(e.target.value) })} /></label>
        </div>
        <label className="field"><span>Email pošiljaoca</span><input value={s.senderEmail ?? ''} onChange={(e) => set({ senderEmail: e.target.value })} /></label>
        <div className="form-2col">
          <label className="field"><span>SMTP korisnik</span><input value={s.smtpUsername ?? ''} onChange={(e) => set({ smtpUsername: e.target.value })} autoComplete="off" /></label>
          <label className="field"><span>SMTP lozinka</span>
            <input type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} autoComplete="new-password"
              placeholder={s.hasSmtpPassword ? 'sačuvana — ostavi prazno' : 'nije postavljena'} />
            <small className="hint">Za Gmail: App Password (16 znakova), ne lozinka naloga.</small>
          </label>
        </div>

        <div className="smtp-test">
          <label className="field"><span>Probni mejl na adresu</span>
            <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)}
              placeholder="npr. vasa.adresa@gmail.com" autoComplete="off" />
          </label>
          <button type="button" className="btn-secondary" disabled={testing || !testTo.trim()} onClick={sendTest}>
            {testing ? 'Šaljem…' : 'Pošalji probni mejl'}
          </button>
        </div>
        <small className="hint">Testira <strong>sačuvana</strong> podešavanja — ako si nešto menjao gore, prvo klikni „Sačuvaj".</small>
        {testMsg && <div className={testMsg.ok ? 'ok-box' : 'login-error'}>{testMsg.text}</div>}

        {msg && <div className={msg === 'Sačuvano.' ? 'ok-box' : 'login-error'}>{msg}</div>}
        <div className="form-actions"><button className="btn-primary" disabled={saving}>{saving ? 'Čuvanje…' : 'Sačuvaj'}</button></div>
      </div>
    </form>
  );
}

function Users(): React.JSX.Element {
  const [list, setList] = useState<User[]>([]);
  const [sort, setSort] = useState<string | undefined>();
  const [dialog, setDialog] = useState<{ mode: 'new' } | { mode: 'edit'; user: User } | null>(null);
  const load = (): void => { void api.get<User[]>('/users').then(setList); };
  useEffect(load, []);
  return (
    <>
      <div className="row-end"><button className="btn-primary" onClick={() => setDialog({ mode: 'new' })}>+ Novi korisnik</button></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>
            <SortableTh field="name" label="Ime" sort={sort} onSort={setSort} />
            <SortableTh field="email" label="Email" sort={sort} onSort={setSort} />
            <SortableTh field="role" label="Rola" sort={sort} onSort={setSort} />
            <SortableTh field="status" label="Status" sort={sort} onSort={setSort} />
          </tr></thead>
          <tbody>{sortRows(list, sort, (u, f) => u[f as keyof User]).map((u) => (
            <tr key={u.id} className="clickable" onClick={() => setDialog({ mode: 'edit', user: u })}>
              <td className="strong">{u.name}</td><td>{u.email}</td><td>{u.role === 'admin' ? 'Admin' : 'Korisnik'}</td>
              <td>{u.status === 'active' ? 'Aktivan' : <span className="muted">Deaktiviran</span>}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {dialog && <UserModal dialog={dialog} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      <LoginLocks />
    </>
  );
}

/**
 * Zaključane adrese. Kočnica gađa uređaj koji pogađa lozinku, ne nalog — pa Marija
 * niko ne može da zaključa izdaleka. Ako se on sam zaključa, ovde ga admin pušta.
 */
function LoginLocks(): React.JSX.Element | null {
  const [locks, setLocks] = useState<{ ip: string; lockedUntil: string }[]>([]);
  const load = (): void => { void api.get<typeof locks>('/login-locks').then(setLocks).catch(() => setLocks([])); };
  useEffect(load, []);

  async function release(ip: string): Promise<void> {
    await api.del(`/login-locks/${encodeURIComponent(ip)}`);
    load();
  }

  if (locks.length === 0) return null; // ništa da se pokaže dok nema zaključanih

  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h3 className="card-title">Zaključane adrese</h3>
      <p className="hint">Posle 5 pogrešnih prijava adresa čeka 30 minuta. Otključava se i sama.</p>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Adresa</th><th>Zaključana do</th><th></th></tr></thead>
          <tbody>{locks.map((l) => (
            <tr key={l.ip}>
              <td className="mono strong">{l.ip}</td>
              <td className="mono">{new Date(l.lockedUntil).toLocaleString('sr-RS')}</td>
              <td className="ta-r"><button className="btn-link" onClick={() => release(l.ip)}>pusti sada</button></td>
            </tr>))}</tbody>
        </table>
      </div>
    </section>
  );
}

function UserModal({ dialog, onClose, onDone }: { dialog: { mode: 'new' } | { mode: 'edit'; user: User }; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const edit = dialog.mode === 'edit';
  const [name, setName] = useState(edit ? dialog.user.name : '');
  const [email, setEmail] = useState(edit ? dialog.user.email : '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>(edit ? dialog.user.role : 'user');
  const [status, setStatus] = useState<'active' | 'disabled'>(edit ? dialog.user.status : 'active');
  const [err, setErr] = useState<string | null>(null);
  async function save(e: FormEvent): Promise<void> {
    e.preventDefault(); setErr(null);
    try {
      if (edit) await api.patch(`/users/${dialog.user.id}`, { name, role, status, password: password || undefined });
      else await api.post('/users', { name, email, password, role });
      onDone();
    } catch (er) { setErr(er instanceof ApiRequestError ? er.body.message : 'Greška.'); }
  }
  return (
    <Modal title={edit ? 'Izmena korisnika' : 'Novi korisnik'} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label className="field"><span>Ime</span><input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></label>
        <label className="field"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required readOnly={edit} /></label>
        <label className="field"><span>{edit ? 'Nova lozinka (opciono)' : 'Lozinka'}</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required={!edit} minLength={6} /></label>
        <div className="form-2col">
          <label className="field"><span>Rola</span><select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'user')}><option value="user">Korisnik</option><option value="admin">Admin</option></select></label>
          {edit && <label className="field"><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'disabled')}><option value="active">Aktivan</option><option value="disabled">Deaktiviran</option></select></label>}
        </div>
        {err && <div className="login-error">{err}</div>}
        <div className="form-actions"><button className="btn-primary">Sačuvaj</button></div>
      </form>
    </Modal>
  );
}

const fmtSize = (b: number | null): string => (b === null ? '—' : `${(b / 1024 / 1024).toFixed(1)} MB`);
const fmtTime = (iso: string | null): string =>
  iso === null ? '—' : new Date(iso).toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' });

/**
 * Backup radi worker jednom dnevno; ovde se vidi evidencija i može da se pokrene ručno.
 * Vraćanje iz backupa prepisuje CELU bazu — zato traži ukucanu potvrdu i razlog.
 */
function Backup(): React.JSX.Element {
  const [runs, setRuns] = useState<BackupRun[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<BackupRun | null>(null);

  async function load(): Promise<void> { setRuns(await api.get<BackupRun[]>('/backup/runs')); }
  useEffect(() => { void load(); }, []);

  async function runNow(): Promise<void> {
    setBusy(true); setMsg(null);
    try { await api.post('/backup/run', {}); setMsg('Backup napravljen.'); await load(); }
    catch (e) { setMsg(e instanceof ApiRequestError ? e.body.message : 'Backup nije uspeo.'); await load(); }
    finally { setBusy(false); }
  }

  if (!runs) return <p className="card-empty">Učitavanje…</p>;

  return (
    <section className="card">
      <div className="row" style={{ alignItems: 'center' }}>
        <h3 className="card-title">Evidencija backupa</h3>
        <button className="btn-primary btn-sm" onClick={runNow} disabled={busy}>{busy ? 'Radim…' : 'Napravi backup sada'}</button>
      </div>
      <p className="hint">Automatski backup se pravi jednom dnevno dok je aplikacija pokrenuta.</p>
      <div className="warn-box">
        <strong>Šta backup pokriva:</strong> celu <strong>bazu</strong> (klijenti, vozila, nalozi, dokumenti, termini).
        <br />
        <strong>Slike vozila NISU u ovom backupu</strong> — one žive na disku (<code>uploads/</code>) i štite se
        odvojenom sinhronizacijom na spoljno odredište. Razlog: slike se nikad ne menjaju, pa bi ih bilo besmisleno
        pakovati u svaki dnevni backup.
      </div>
      {msg && <div className={msg === 'Backup napravljen.' ? 'ok-box' : 'login-error'}>{msg}</div>}

      {runs.length === 0 ? <p className="card-empty">Još nema nijednog backupa.</p> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Početak</th><th>Kraj</th><th>Status</th><th>Veličina</th><th>Fajl</th><th></th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="mono" data-label="Početak">{fmtTime(r.startedAt)}</td>
                  <td className="mono" data-label="Kraj">{fmtTime(r.finishedAt)}</td>
                  <td data-label="Status">
                    <span className={`badge ${r.status === 'success' ? 'st-done' : 'st-cancel'}`}>{r.status === 'success' ? 'uspešan' : 'neuspešan'}</span>
                    {r.error && <div className="hint danger">{r.error}</div>}
                  </td>
                  <td className="mono" data-label="Veličina">{fmtSize(r.sizeBytes)}</td>
                  <td className="mono truncate" data-label="Fajl">{r.destination ?? '—'}</td>
                  <td className="ta-r">
                    {r.status === 'success' && <button className="btn-link danger" onClick={() => setRestoring(r)}>Vrati iz backupa</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {restoring && <RestoreModal run={restoring} onClose={() => setRestoring(null)} />}
    </section>
  );
}

const RESTORE_PHRASE = 'VRATI IZ BACKUPA';

function RestoreModal({ run, onClose }: { run: BackupRun; onClose: () => void }): React.JSX.Element {
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.post('/backup/restore', { runId: run.id, confirm, reason });
      // vraćanje gasi sve sesije; punim reloadom skidamo i stanje u memoriji
      window.location.href = '/';
    } catch (e2) {
      setErr(e2 instanceof ApiRequestError ? e2.body.message : 'Vraćanje nije uspelo.');
      setBusy(false);
    }
  }

  return (
    <Modal title="Vrati iz backupa" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="warn-box">
          <strong>Ovo prepisuje celu bazu.</strong> Svi podaci uneti posle {fmtTime(run.startedAt)} biće trajno izgubljeni.
          Svi korisnici, uključujući vas, biće odjavljeni.
        </div>
        <label className="field"><span>Razlog (obavezno)</span><input value={reason} onChange={(e) => setReason(e.target.value)} required /></label>
        <label className="field"><span>Ukucaj <code>{RESTORE_PHRASE}</code> da potvrdiš</span>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></label>
        {err && <div className="login-error">{err}</div>}
        <div className="form-actions">
          <button type="submit" className="btn-danger" disabled={busy || confirm !== RESTORE_PHRASE || !reason.trim()}>
            {busy ? 'Vraćam…' : 'Vrati iz backupa'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
