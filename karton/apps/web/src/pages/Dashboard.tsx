import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkOrderStatus } from '@karton/shared';
import { labels } from '@karton/shared';
import { useAuth } from '../auth.tsx';
import { api } from '../api.ts';
import { money, formatDate } from '../lib/documentHelpers.ts';
import { statusClass } from '../lib/workOrderStatus.ts';

interface DashboardData {
  today: { appointments: { id: number; date: string; time: string; customer: string; make: string; model: string }[]; waitingParts: { number: string; plate: string | null }[] };
  business: {
    vehiclesInShop: number; openWorkOrders: number; pendingQuotes: number;
    inShopList: { id: number; number: string; status: WorkOrderStatus; make: string; model: string; plate: string | null; customer: string }[];
  };
  money: { monthRevenue: number; unpaidTotal: number; unpaidInvoices: { number: string; customer: string; due_on: string | null; total: number }[] };
}

const DANI = ['nedelja', 'ponedeljak', 'utorak', 'sreda', 'četvrtak', 'petak', 'subota'];
const MESECI = ['januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar'];

/** Brojčanik (dial): broj je podatak, luk je samo vizuelni nagoveštaj „koliko".
 *  Luk se blago puni sa vrednošću (bez izmišljenog maksimuma) i nikad nije pun. */
function Gauge({ value, label, warn, onClick }: { value: number; label: string; warn?: boolean; onClick: () => void }): React.JSX.Element {
  const ARC = 151; // dužina 270° luka za r=32 (obim ≈ 201)
  const frac = value <= 0 ? 0 : Math.min(value / (value + 6), 0.95);
  const fill = value <= 0 ? 0 : Math.max(0.09, frac) * ARC;
  return (
    <button className={`gauge${warn ? ' warn' : ''}`} onClick={onClick}>
      <div className="dial">
        <svg viewBox="0 0 76 76">
          <circle className="track" cx="38" cy="38" r="32" strokeDasharray="151 201" />
          <circle className="fill" cx="38" cy="38" r="32" strokeDasharray={`${fill.toFixed(1)} 201`} />
        </svg>
        <span className="num">{value}</span>
      </div>
      <div className="lbl">{label}</div>
    </button>
  );
}

export function Dashboard(): React.JSX.Element {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [d, setD] = useState<DashboardData | null>(null);
  useEffect(() => { void api.get<DashboardData>('/dashboard').then(setD); }, []);

  const now = new Date();
  const longDate = `${DANI[now.getDay()]}, ${now.getDate()}. ${MESECI[now.getMonth()]} ${now.getFullYear()}.`;
  const firstName = (user?.name ?? '').trim().split(/\s+/)[0];

  if (!d) return <div className="page"><p className="card-empty">Učitavanje…</p></div>;

  return (
    <div className="page">
      <div className="dash-head">
        <div className="hello">{longDate}</div>
        <h1>Zdravo{firstName ? `, ${firstName}` : ''} 👋</h1>
      </div>

      <div className="quick">
        <button onClick={() => navigate('/nalozi')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 9h6M9 13h4" /></svg>
          Radni nalozi
        </button>
        <button onClick={() => navigate('/kalendar')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>
          Kalendar
        </button>
        <button onClick={() => navigate('/klijenti')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-5.5 8-5.5s6.5 1.5 8 5.5" /></svg>
          Klijenti
        </button>
      </div>

      <div className="dash-cols">
        <div className="dash-main">
          <div className="section-label">Posao</div>
          <div className="gauges">
            <Gauge value={d.business.vehiclesInShop} label="Vozila u servisu" onClick={() => navigate('/vozila')} />
            <Gauge value={d.business.openWorkOrders} label="Otvorenih naloga" onClick={() => navigate('/nalozi')} />
            <Gauge value={d.business.pendingQuotes} label="Ponuda na čekanju" warn={d.business.pendingQuotes > 0} onClick={() => navigate('/dokumenti')} />
          </div>

          <div className="section-label">Vozila u servisu</div>
          <div className="panel-card">
            {d.business.inShopList.length === 0 ? <p className="panel-empty">Nijedno vozilo nije u servisu.</p> : (
              <div className="scroll-table">
                <table className="mini-table">
                  <thead><tr><th>Nalog</th><th>Vozilo</th><th>Klijent</th><th>Status</th></tr></thead>
                  <tbody>
                    {d.business.inShopList.map((w) => (
                      <tr key={w.id} className="clickable" onClick={() => navigate(`/nalozi/${w.id}`)}>
                        <td className="mono">{w.number}</td>
                        <td><span className="mono">{w.plate ?? '—'}</span> {w.make} {w.model}</td>
                        <td>{w.customer}</td>
                        <td><span className={`badge ${statusClass[w.status]}`}>{labels.workOrderStatus[w.status]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="section-label">Novac</div>
          <div className="dash-money">
            <div className="panel-card stat-money"><span className="stat-label">Prihod ovog meseca</span><span className="stat-money-num mono">{money(d.money.monthRevenue)} RSD</span></div>
            <div className="panel-card stat-money"><span className="stat-label">Nenaplaćeno</span><span className="stat-money-num mono danger">{money(d.money.unpaidTotal)} RSD</span></div>
          </div>
          {d.money.unpaidInvoices.length > 0 && (
            <div className="panel-card" style={{ marginTop: 12 }}>
              <div className="panel-head"><div className="panel-title"><span className="dot amber" />Nenaplaćeni računi</div></div>
              <div className="scroll-table">
                <table className="mini-table">
                  <thead><tr><th>Broj</th><th>Klijent</th><th>Dospeće</th><th className="ta-r">Iznos</th></tr></thead>
                  <tbody>{d.money.unpaidInvoices.map((i) => <tr key={i.number} className="clickable" onClick={() => navigate('/dokumenti')}><td className="mono">{i.number}</td><td>{i.customer}</td><td className="mono">{formatDate(i.due_on)}</td><td className="ta-r mono">{money(i.total)}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="dash-side">
          <div className="section-label">Danas</div>
          <div className="panel-card">
            <div className="panel-head"><div className="panel-title"><span className="dot" />Termini (danas i sutra)</div></div>
            {d.today.appointments.length === 0
              ? <div className="panel-empty">Nema zakazanih termina.<button className="btn-mini" onClick={() => navigate('/kalendar')}>+ Novi termin</button></div>
              : <ul className="mini-list scroll-list">{d.today.appointments.map((a) => <li key={a.id}><span className="mono">{formatDate(a.date)} {a.time}</span> · {a.customer} · {a.make} {a.model}</li>)}</ul>}
          </div>
          <div className="panel-card">
            <div className="panel-head"><div className="panel-title"><span className="dot amber" />Čeka delove</div></div>
            {d.today.waitingParts.length === 0
              ? <p className="panel-empty">Nijedno vozilo ne čeka delove.</p>
              : <ul className="mini-list scroll-list">{d.today.waitingParts.map((w) => <li key={w.number}><span className="mono">{w.plate ?? '—'}</span> · {w.number}</li>)}</ul>}
          </div>
        </div>
      </div>
    </div>
  );
}
