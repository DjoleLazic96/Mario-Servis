import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Appointment, Mechanic, CalendarBlock } from '@karton/shared';
import { labels } from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { Modal } from '../components/Modal.tsx';
import { AppointmentForm } from '../components/AppointmentForm.tsx';

const DAYS = ['Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub', 'Ned'];
const statusClass: Record<string, string> = { scheduled: 'st-open', completed: 'st-done', cancelled: 'st-cancel', no_show: 'st-wait' };

function mondayOf(d: Date): Date { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
function iso(d: Date): string { return d.toLocaleDateString('sv-SE'); }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

export function Calendar(): React.JSX.Element {
  const navigate = useNavigate();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date('2026-07-10')));
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [mechFilter, setMechFilter] = useState('');
  const [dialog, setDialog] = useState<'new' | 'block' | null>(null);
  const [newDate, setNewDate] = useState('');
  const [selected, setSelected] = useState<Appointment | null>(null);

  const from = iso(weekStart), to = iso(addDays(weekStart, 6));
  const load = useCallback(async () => {
    const p = new URLSearchParams({ from, to });
    if (mechFilter) p.set('mechanicId', mechFilter);
    const [a, b] = await Promise.all([api.get<Appointment[]>(`/appointments?${p}`), api.get<CalendarBlock[]>('/calendar-blocks')]);
    setAppts(a); setBlocks(b);
  }, [from, to, mechFilter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void api.get<Mechanic[]>('/mechanics?status=active').then(setMechanics); }, []);

  function isBlocked(day: string): CalendarBlock | undefined { return blocks.find((b) => day >= b.fromDate && day <= b.toDate); }

  async function changeStatus(a: Appointment, status: string): Promise<void> {
    await api.post(`/appointments/${a.id}/status`, { status, version: a.version });
    setSelected(null); await load();
  }
  async function del(a: Appointment): Promise<void> {
    try { await api.del(`/appointments/${a.id}`); setSelected(null); await load(); }
    catch (e) { alert(e instanceof ApiRequestError ? e.body.message : 'Greška.'); }
  }

  return (
    <div className="page">
      <header className="page-head row">
        <div><h1>Kalendar</h1><p className="page-sub">{from} — {to}</p></div>
        <div className="btn-group">
          <select className="search" value={mechFilter} onChange={(e) => setMechFilter(e.target.value)}>
            <option value="">Svi majstori</option>{mechanics.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
          </select>
          <button className="btn-secondary" onClick={() => setDialog('block')}>Blokada dana</button>
          <button className="btn-primary" onClick={() => { setNewDate(from); setDialog('new'); }}>+ Novi termin</button>
        </div>
      </header>

      <div className="week-nav">
        <button className="btn-secondary btn-sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹ Prethodna</button>
        <button className="btn-secondary btn-sm" onClick={() => setWeekStart(mondayOf(new Date('2026-07-10')))}>Ova nedelja</button>
        <button className="btn-secondary btn-sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>Sledeća ›</button>
      </div>

      <div className="week-grid">
        {DAYS.map((dn, i) => {
          const day = iso(addDays(weekStart, i));
          const blk = isBlocked(day);
          const dayAppts = appts.filter((a) => a.date === day);
          return (
            <div className={`day-col ${blk ? 'blocked' : ''}`} key={day}>
              <div className="day-head">{dn} <span className="mono">{day.slice(8)}.{day.slice(5, 7)}</span></div>
              {blk && <div className="day-block">Blokirano{blk.reason ? `: ${blk.reason}` : ''}</div>}
              <div className="day-body">
                {dayAppts.map((a) => (
                  <button key={a.id} className={`appt ${statusClass[a.status]}`} onClick={() => setSelected(a)}>
                    <span className="appt-time mono">{a.time}</span>
                    <span className="appt-who">{a.customer.name}</span>
                    <span className="appt-veh">{a.vehicle.make} {a.vehicle.model}</span>
                    {a.mechanic && <span className="appt-mech">{a.mechanic.fullName}</span>}
                    {a.remindersEnabled && <span className="appt-rem" title={`podsetnik: ${a.reminderStatus ?? '—'}`}>✉</span>}
                  </button>
                ))}
                {!blk && <button className="day-add" onClick={() => { setNewDate(day); setDialog('new'); }}>+</button>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="legend">
        {(['scheduled', 'completed', 'cancelled', 'no_show'] as const).map((s) => (
          <span key={s} className="legend-item"><span className={`badge ${statusClass[s]}`}>{labels.appointmentStatus[s]}</span></span>
        ))}
      </div>

      {dialog === 'new' && (
        <Modal title="Novi termin" onClose={() => setDialog(null)} width={520}>
          <AppointmentForm mechanics={mechanics} defaultDate={newDate} onCreated={() => { setDialog(null); void load(); }} />
        </Modal>
      )}
      {dialog === 'block' && <BlockModal onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); }} blocks={blocks} />}
      {selected && (
        <Modal title={`Termin — ${selected.customer.name}`} onClose={() => setSelected(null)}>
          <div className="form">
            <dl className="kv">
              <dt>Kada</dt><dd className="mono">{selected.date} {selected.time} ({selected.durationMin}min)</dd>
              <dt>Vozilo</dt><dd>{selected.vehicle.make} {selected.vehicle.model} <span className="mono">{selected.vehicle.plate ?? ''}</span></dd>
              <dt>Majstor</dt><dd>{selected.mechanic?.fullName ?? '—'}</dd>
              <dt>Status</dt><dd><span className={`badge ${statusClass[selected.status]}`}>{labels.appointmentStatus[selected.status]}</span></dd>
              {selected.remindersEnabled && <><dt>Podsetnik</dt><dd>{selected.reminderStatus ?? '—'}</dd></>}
            </dl>
            <div className="btn-group" style={{ flexWrap: 'wrap' }}>
              {selected.status === 'scheduled' && <>
                <button className="btn-secondary btn-sm" onClick={() => changeStatus(selected, 'completed')}>Realizovano</button>
                <button className="btn-secondary btn-sm" onClick={() => changeStatus(selected, 'no_show')}>Nije se pojavio</button>
                <button className="btn-secondary btn-sm" onClick={() => changeStatus(selected, 'cancelled')}>Otkaži</button>
                <button className="btn-secondary btn-sm" onClick={() => del(selected)}>Obriši</button>
              </>}
              {selected.workOrderId && <button className="btn-link" onClick={() => navigate(`/nalozi/${selected.workOrderId}`)}>Otvori nalog</button>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function BlockModal({ onClose, onDone, blocks }: { onClose: () => void; onDone: () => void; blocks: CalendarBlock[] }): React.JSX.Element {
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [reason, setReason] = useState('');
  async function add(): Promise<void> { await api.post('/calendar-blocks', { fromDate: from, toDate: to || from, reason: reason.trim() || null }); onDone(); }
  async function remove(id: number): Promise<void> { await api.del(`/calendar-blocks/${id}`); onDone(); }
  return (
    <Modal title="Blokada dana" onClose={onClose}>
      <div className="form">
        <div className="form-2col">
          <label className="field"><span>Od</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field"><span>Do</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <label className="field"><span>Razlog</span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Praznik, godišnji…" /></label>
        <div className="form-actions"><button className="btn-primary" disabled={!from} onClick={add}>Blokiraj</button></div>
        {blocks.length > 0 && <ul className="contact-list">{blocks.map((b) => <li key={b.id}><span className="mono">{b.fromDate}{b.toDate !== b.fromDate ? `–${b.toDate}` : ''}</span> {b.reason} <button className="btn-link danger" onClick={() => remove(b.id)}>ukloni</button></li>)}</ul>}
      </div>
    </Modal>
  );
}
