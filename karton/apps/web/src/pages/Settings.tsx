import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api.ts';
import { Modal } from '../components/Modal.tsx';

interface SettingsData {
  shopName: string; address: string | null; taxId: string | null; phone: string | null;
  smtpHost: string | null; smtpPort: number | null; smtpUsername: string | null; senderEmail: string | null;
  workHoursFrom: string; workHoursTo: string; defaultValidityDays: number; reminderSendTime: string; pageSize: number; version: number;
}
interface User { id: number; name: string; email: string; role: 'admin' | 'user'; status: 'active' | 'disabled' }

export function Settings(): React.JSX.Element {
  const [tab, setTab] = useState<'servis' | 'korisnici'>('servis');
  return (
    <div className="page">
      <header className="page-head"><h1>Podešavanja</h1></header>
      <div className="tabs" style={{ marginBottom: 16, width: 'fit-content' }}>
        <button className={`tab ${tab === 'servis' ? 'active' : ''}`} onClick={() => setTab('servis')}>Servis</button>
        <button className={`tab ${tab === 'korisnici' ? 'active' : ''}`} onClick={() => setTab('korisnici')}>Korisnici</button>
      </div>
      {tab === 'servis' ? <ServiceSettings /> : <Users />}
    </div>
  );
}

function ServiceSettings(): React.JSX.Element {
  const [s, setS] = useState<SettingsData | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { void api.get<SettingsData>('/settings').then(setS); }, []);
  if (!s) return <p className="card-empty">Učitavanje…</p>;
  const set = (patch: Partial<SettingsData>): void => setS({ ...s, ...patch });

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault(); setSaving(true); setMsg(null);
    try { setS(await api.patch<SettingsData>('/settings', s)); setMsg('Sačuvano.'); }
    catch (err) { setMsg(err instanceof ApiRequestError ? err.body.message : 'Greška.'); }
    finally { setSaving(false); }
  }
  return (
    <form className="card" onSubmit={save} style={{ maxWidth: 640 }}>
      <div className="form">
        <h3 className="card-title">Podaci servisa</h3>
        <label className="field"><span>Naziv</span><input value={s.shopName} onChange={(e) => set({ shopName: e.target.value })} required /></label>
        <div className="form-2col">
          <label className="field"><span>Adresa</span><input value={s.address ?? ''} onChange={(e) => set({ address: e.target.value })} /></label>
          <label className="field"><span>PIB</span><input value={s.taxId ?? ''} onChange={(e) => set({ taxId: e.target.value })} /></label>
        </div>
        <label className="field"><span>Telefon</span><input value={s.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} /></label>

        <h3 className="card-title" style={{ marginTop: 8 }}>Radno vreme i rokovi</h3>
        <div className="form-2col">
          <label className="field"><span>Radno vreme od</span><input type="time" value={s.workHoursFrom} onChange={(e) => set({ workHoursFrom: e.target.value })} /></label>
          <label className="field"><span>do</span><input type="time" value={s.workHoursTo} onChange={(e) => set({ workHoursTo: e.target.value })} /></label>
        </div>
        <div className="form-2col">
          <label className="field"><span>Rok važenja (dana)</span><input type="number" min={1} value={s.defaultValidityDays} onChange={(e) => set({ defaultValidityDays: Number(e.target.value) })} /></label>
          <label className="field"><span>Vreme podsetnika</span><input type="time" value={s.reminderSendTime} onChange={(e) => set({ reminderSendTime: e.target.value })} /></label>
        </div>
        <label className="field"><span>Redova po strani</span><input type="number" min={5} value={s.pageSize} onChange={(e) => set({ pageSize: Number(e.target.value) })} /></label>

        <h3 className="card-title" style={{ marginTop: 8 }}>Email (SMTP)</h3>
        <div className="form-2col">
          <label className="field"><span>SMTP host</span><input value={s.smtpHost ?? ''} onChange={(e) => set({ smtpHost: e.target.value })} /></label>
          <label className="field"><span>Port</span><input type="number" value={s.smtpPort ?? ''} onChange={(e) => set({ smtpPort: Number(e.target.value) })} /></label>
        </div>
        <label className="field"><span>Email pošiljaoca</span><input value={s.senderEmail ?? ''} onChange={(e) => set({ senderEmail: e.target.value })} /></label>

        {msg && <div className={msg === 'Sačuvano.' ? 'ok-box' : 'login-error'}>{msg}</div>}
        <div className="form-actions"><button className="btn-primary" disabled={saving}>{saving ? 'Čuvanje…' : 'Sačuvaj'}</button></div>
      </div>
    </form>
  );
}

function Users(): React.JSX.Element {
  const [list, setList] = useState<User[]>([]);
  const [dialog, setDialog] = useState<{ mode: 'new' } | { mode: 'edit'; user: User } | null>(null);
  const load = (): void => { void api.get<User[]>('/users').then(setList); };
  useEffect(load, []);
  return (
    <>
      <div className="row-end"><button className="btn-primary" onClick={() => setDialog({ mode: 'new' })}>+ Novi korisnik</button></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Ime</th><th>Email</th><th>Rola</th><th>Status</th></tr></thead>
          <tbody>{list.map((u) => (
            <tr key={u.id} className="clickable" onClick={() => setDialog({ mode: 'edit', user: u })}>
              <td className="strong">{u.name}</td><td>{u.email}</td><td>{u.role === 'admin' ? 'Admin' : 'Korisnik'}</td>
              <td>{u.status === 'active' ? 'Aktivan' : <span className="muted">Deaktiviran</span>}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {dialog && <UserModal dialog={dialog} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
    </>
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
