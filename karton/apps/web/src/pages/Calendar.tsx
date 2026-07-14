import { useEffect, useState, useCallback } from 'react';
import { DateInput } from '../components/DateInput.tsx';
import { formatDate } from '../lib/documentHelpers.ts';
import { useNavigate } from 'react-router-dom';
import type { Appointment, Mechanic, CalendarBlock, WorkOrder, Paginated } from '@karton/shared';
import { labels } from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { Modal } from '../components/Modal.tsx';
import { AppointmentForm } from '../components/AppointmentForm.tsx';

const DAYS = ['Ponedeljak', 'Utorak', 'Sreda', 'Četvrtak', 'Petak', 'Subota', 'Nedelja'];
const DAYS_SHORT = ['Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub', 'Ned'];
const HOUR_H = 46; // visina jednog sata u px
const statusClass: Record<string, string> = { scheduled: 'st-open', completed: 'st-done', cancelled: 'st-cancel', no_show: 'st-wait' };
// Bedž statusa podsetnika: jasno razdvaja poslato (zeleno), grešku (crveno) i
// poslovno preskakanje (neutralno sivo — NIJE greška).
const REM_CLASS: Record<string, string> = { scheduled: 'st-open', processing: 'st-progress', sent: 'st-done', failed: 'rem-error', skipped: 'rem-skip' };
function remClass(s: string | null): string { return s ? REM_CLASS[s] ?? 'st-open' : 'st-open'; }

const mondayOf = (d: Date): Date => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x; };
const iso = (d: Date): string => d.toLocaleDateString('sv-SE');
const addDays = (d: Date, n: number): Date => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const toMin = (t: string): number => { const [h, m] = t.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };

export function Calendar(): React.JSX.Element {
  const navigate = useNavigate();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [mechFilter, setMechFilter] = useState('');
  const [hours, setHours] = useState({ from: 7, to: 20 });
  const [dialog, setDialog] = useState<'new' | 'block' | 'edit' | 'complete' | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('09:00');
  const [selected, setSelected] = useState<Appointment | null>(null);

  const from = iso(weekStart), to = iso(addDays(weekStart, 6));

  const load = useCallback(async () => {
    const p = new URLSearchParams({ from, to });
    if (mechFilter) p.set('mechanicId', mechFilter);
    const [a, b] = await Promise.all([api.get<Appointment[]>(`/appointments?${p}`), api.get<CalendarBlock[]>('/calendar-blocks')]);
    setAppts(a); setBlocks(b);
  }, [from, to, mechFilter]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void api.get<Mechanic[]>('/mechanics?status=active').then(setMechanics);
    void api.get<{ workHoursFrom: string; workHoursTo: string }>('/settings').then((s) => {
      const f = Math.max(0, Math.floor(toMin(s.workHoursFrom) / 60) - 1);
      const t = Math.min(24, Math.ceil(toMin(s.workHoursTo) / 60) + 1);
      setHours({ from: f, to: Math.max(f + 4, t) });
    });
  }, []);

  const rows = hours.to - hours.from;
  const gridStart = hours.from * 60;
  const blockOn = (day: string): CalendarBlock | undefined => blocks.find((b) => day >= b.fromDate && day <= b.toDate);

  async function changeStatus(a: Appointment, status: string, workOrderId?: number | null): Promise<void> {
    try {
      await api.post(`/appointments/${a.id}/status`, { status, version: a.version, ...(workOrderId ? { workOrderId } : {}) });
      setSelected(null); setDialog(null); await load();
    } catch (e) { alert(e instanceof ApiRequestError ? e.body.message : 'Greška.'); }
  }
  async function del(a: Appointment): Promise<void> {
    try { await api.del(`/appointments/${a.id}`); setSelected(null); await load(); }
    catch (e) { alert(e instanceof ApiRequestError ? e.body.message : 'Greška.'); }
  }

  return (
    <div className="page">
      <header className="page-head row">
        <div><h1>Kalendar</h1><p className="page-sub">{formatDate(from)} — {formatDate(to)}</p></div>
        <div className="btn-group">
          <select className="search" value={mechFilter} onChange={(e) => setMechFilter(e.target.value)}>
            <option value="">Svi majstori</option>{mechanics.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
          </select>
          <button className="btn-secondary" onClick={() => setDialog('block')}>Blokada dana</button>
          <button className="btn-primary" onClick={() => { setNewDate(from); setNewTime('09:00'); setDialog('new'); }}>+ Novi termin</button>
        </div>
      </header>

      <div className="week-nav">
        <button className="btn-secondary btn-sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹ Prethodna</button>
        <button className="btn-secondary btn-sm" onClick={() => setWeekStart(mondayOf(new Date()))}>Ova nedelja</button>
        <button className="btn-secondary btn-sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>Sledeća ›</button>
      </div>

      <div className="cal">
        <div className="cal-scroll">
        {/* zaglavlje sa danima — unutar skrola i lepljivo, da se kolone poklope sa danima */}
        <div className="cal-head">
          <div className="cal-gutter" />
          {DAYS_SHORT.map((dn, i) => {
            const day = iso(addDays(weekStart, i));
            const blk = blockOn(day);
            const today = day === iso(new Date());
            return (
              <div className={`cal-day-head ${today ? 'today' : ''}`} key={day} title={DAYS[i]}>
                <span>{dn}</span> <span className="mono">{day.slice(8)}.{day.slice(5, 7)}.</span>
                {blk && <span className="cal-blocked-tag">blokirano</span>}
              </div>
            );
          })}
        </div>

        {/* mreža sa satima */}
        <div className="cal-body" style={{ height: rows * HOUR_H }}>
          <div className="cal-gutter">
            {Array.from({ length: rows }, (_, i) => (
              <div className="cal-hour" style={{ height: HOUR_H }} key={i}>
                <span className="mono">{String(hours.from + i).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>

          {DAYS_SHORT.map((_, i) => {
            const day = iso(addDays(weekStart, i));
            const blk = blockOn(day);
            const dayAppts = appts.filter((a) => a.date === day);
            return (
              <div className={`cal-day ${blk ? 'blocked' : ''}`} key={day}
                style={{ backgroundSize: `100% ${HOUR_H}px` }}
                onClick={(e) => {
                  if (blk || (e.target as HTMLElement).closest('.cal-appt')) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const h = hours.from + Math.floor((e.clientY - rect.top) / HOUR_H);
                  setNewDate(day); setNewTime(`${String(h).padStart(2, '0')}:00`); setDialog('new');
                }}>
                {dayAppts.map((a) => {
                  const top = ((toMin(a.time) - gridStart) / 60) * HOUR_H;
                  const h = Math.max(24, (a.durationMin / 60) * HOUR_H - 2);
                  return (
                    <button key={a.id} className={`cal-appt ${statusClass[a.status]}`} style={{ top, height: h }}
                      onClick={(e) => { e.stopPropagation(); setSelected(a); }}>
                      <span className="cal-appt-time mono">{a.time}</span>
                      <span className="cal-appt-who">{a.customer.name}</span>
                      <span className="cal-appt-veh">{a.vehicle.make} {a.vehicle.model}</span>
                      {a.remindersEnabled && <span className="cal-appt-rem" title={`podsetnik: ${a.reminderStatus ? labels.reminderStatus[a.reminderStatus] : 'zakazan'}`}>✉</span>}
                    </button>
                  );
                })}
                {blk && <div className="cal-block-note">{blk.reason ?? 'Blokirano'}</div>}
              </div>
            );
          })}
        </div>
        </div>
      </div>

      <div className="legend">
        {(['scheduled', 'completed', 'cancelled', 'no_show'] as const).map((s) => (
          <span key={s} className={`badge ${statusClass[s]}`}>{labels.appointmentStatus[s]}</span>
        ))}
      </div>

      {dialog === 'new' && (
        <Modal title="Novi termin" onClose={() => setDialog(null)} width={520}>
          <AppointmentForm mechanics={mechanics} defaultDate={newDate} defaultTime={newTime} onCreated={() => { setDialog(null); void load(); }} />
        </Modal>
      )}
      {dialog === 'block' && <BlockModal onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); }} blocks={blocks} />}
      {dialog === 'edit' && selected && (
        <Modal title={`Izmena termina — ${selected.customer.name}`} onClose={() => setDialog(null)} width={520}>
          <AppointmentForm mechanics={mechanics} defaultDate={selected.date} initial={selected}
            onCreated={() => { setDialog(null); setSelected(null); void load(); }} />
        </Modal>
      )}
      {dialog === 'complete' && selected && (
        <Modal title="Termin je realizovan" onClose={() => setDialog(null)} width={520}>
          <CompleteModal appt={selected} onDone={(woId) => changeStatus(selected, 'completed', woId)} />
        </Modal>
      )}
      {selected && (
        <Modal title={`Termin — ${selected.customer.name}`} onClose={() => setSelected(null)}>
          <div className="form">
            <dl className="kv">
              <dt>Kada</dt><dd className="mono">{formatDate(selected.date)} {selected.time} ({selected.durationMin} min)</dd>
              <dt>Vozilo</dt><dd>{selected.vehicle.make} {selected.vehicle.model} <span className="mono">{selected.vehicle.plate ?? ''}</span></dd>
              <dt>Majstor</dt><dd>{selected.mechanic?.fullName ?? '—'}</dd>
              <dt>Status</dt><dd><span className={`badge ${statusClass[selected.status]}`}>{labels.appointmentStatus[selected.status]}</span></dd>
              {selected.remindersEnabled && <>
                <dt>Podsetnik</dt>
                <dd>
                  <span className={`badge ${remClass(selected.reminderStatus)}`}>
                    {selected.reminderStatus ? labels.reminderStatus[selected.reminderStatus] : 'Zakazan'}
                  </span>
                  {(selected.reminderStatus === 'skipped' || selected.reminderStatus === 'failed') && (
                    <div className="hint">{selected.reminderReason ?? (selected.reminderStatus === 'skipped' ? 'klijent nema email u trenutku slanja' : 'greška pri slanju')}</div>
                  )}
                </dd>
              </>}
            </dl>
            <div className="btn-group" style={{ flexWrap: 'wrap' }}>
              {selected.status === 'scheduled' && <>
                <button className="btn-secondary btn-sm" onClick={() => setDialog('complete')}>Realizovano</button>
                <button className="btn-secondary btn-sm" onClick={() => setDialog('edit')}>Izmeni</button>
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
          <label className="field"><span>Od</span><DateInput value={from} onChange={setFrom} /></label>
          <label className="field"><span>Do</span><DateInput value={to} onChange={setTo} /></label>
        </div>
        <label className="field"><span>Razlog</span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Praznik, godišnji…" /></label>
        <div className="form-actions"><button className="btn-primary" disabled={!from} onClick={add}>Blokiraj</button></div>
        {blocks.length > 0 && <ul className="contact-list">{blocks.map((b) => <li key={b.id}><span className="mono">{b.fromDate}{b.toDate !== b.fromDate ? `–${b.toDate}` : ''}</span> {b.reason} <button className="btn-link danger" onClick={() => remove(b.id)}>ukloni</button></li>)}</ul>}
      </div>
    </Modal>
  );
}

/**
 * Kad se termin realizuje, može odmah da se veže za radni nalog istog vozila.
 * Veza nije obavezna — ali kad postoji, termin se više ne može vratiti na „zakazan" (BR-28).
 */
function CompleteModal({ appt, onDone }: { appt: Appointment; onDone: (workOrderId: number | null) => void }): React.JSX.Element {
  const [orders, setOrders] = useState<WorkOrder[] | null>(null);
  const [picked, setPicked] = useState<string>('');

  useEffect(() => {
    void (async () => {
      const res = await api.get<Paginated<WorkOrder>>(`/work-orders?vehicleId=${appt.vehicle.id}&pageSize=20`);
      setOrders(res.data);
    })();
  }, [appt.vehicle.id]);

  return (
    <div className="form">
      <p className="hint">Vezivanje za nalog je opciono, ali se posle ne može poništiti bez administratora.</p>
      <label className="field"><span>Radni nalog ovog vozila</span>
        <select value={picked} onChange={(e) => setPicked(e.target.value)}>
          <option value="">— bez naloga —</option>
          {orders?.map((w) => <option key={w.id} value={w.id}>{w.number} · {formatDate(w.receivedOn)}</option>)}
        </select>
      </label>
      {orders?.length === 0 && <p className="hint">Ovo vozilo nema nijedan radni nalog.</p>}
      <div className="form-actions">
        <button className="btn-primary" onClick={() => onDone(picked ? Number(picked) : null)}>Označi kao realizovano</button>
      </div>
    </div>
  );
}
