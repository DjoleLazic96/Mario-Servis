import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkOrderStatus } from '@karton/shared';
import { labels } from '@karton/shared';
import { api } from '../api.ts';
import { money } from '../lib/documentHelpers.ts';
import { statusClass } from '../lib/workOrderStatus.ts';

interface DashboardData {
  today: { appointments: { id: number; date: string; time: string; customer: string; make: string; model: string }[]; waitingParts: { number: string; plate: string | null }[] };
  business: {
    vehiclesInShop: number; openWorkOrders: number; pendingQuotes: number;
    inShopList: { id: number; number: string; status: WorkOrderStatus; make: string; model: string; plate: string | null; customer: string }[];
  };
  money: { monthRevenue: number; unpaidTotal: number; unpaidInvoices: { number: string; customer: string; due_on: string | null; total: number }[] };
}

export function Dashboard(): React.JSX.Element {
  const navigate = useNavigate();
  const [d, setD] = useState<DashboardData | null>(null);
  useEffect(() => { void api.get<DashboardData>('/dashboard').then(setD); }, []);

  if (!d) return <div className="page"><p className="card-empty">Učitavanje…</p></div>;

  return (
    <div className="page">
      <header className="page-head"><h1>Početna</h1></header>

      <h2 className="section-h">Danas</h2>
      <div className="card-grid">
        <section className="card">
          <h3 className="card-title">Termini (danas i sutra)</h3>
          {d.today.appointments.length === 0 ? <p className="card-empty">Nema termina.</p> :
            <ul className="mini-list">{d.today.appointments.map((a) => <li key={a.id}><span className="mono">{a.date} {a.time}</span> · {a.customer} · {a.make} {a.model}</li>)}</ul>}
        </section>
        <section className="card">
          <h3 className="card-title">Čeka delove</h3>
          {d.today.waitingParts.length === 0 ? <p className="card-empty">Nema vozila.</p> :
            <ul className="mini-list">{d.today.waitingParts.map((w) => <li key={w.number}><span className="mono">{w.plate ?? '—'}</span> · {w.number}</li>)}</ul>}
        </section>
      </div>

      <h2 className="section-h">Posao</h2>
      <div className="card-grid">
        <button className="stat-card" onClick={() => navigate('/vozila')}><span className="stat-num">{d.business.vehiclesInShop}</span><span className="stat-label">Vozila u servisu</span></button>
        <button className="stat-card" onClick={() => navigate('/nalozi')}><span className="stat-num">{d.business.openWorkOrders}</span><span className="stat-label">Otvorenih naloga</span></button>
        <button className="stat-card" onClick={() => navigate('/dokumenti')}><span className="stat-num">{d.business.pendingQuotes}</span><span className="stat-label">Ponuda na čekanju</span></button>
      </div>

      <section className="card">
        <h3 className="card-title">Vozila u servisu</h3>
        {d.business.inShopList.length === 0 ? <p className="card-empty">Nijedno vozilo nije u servisu.</p> : (
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
        )}
      </section>

      <h2 className="section-h">Novac</h2>
      <div className="card-grid">
        <section className="card stat-money"><span className="stat-label">Prihod ovog meseca</span><span className="stat-money-num mono">{money(d.money.monthRevenue)} RSD</span></section>
        <section className="card stat-money"><span className="stat-label">Nenaplaćeno</span><span className="stat-money-num mono danger">{money(d.money.unpaidTotal)} RSD</span></section>
      </div>
      {d.money.unpaidInvoices.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <h3 className="card-title">Nenaplaćeni računi</h3>
          <table className="mini-table">
            <thead><tr><th>Broj</th><th>Klijent</th><th>Dospeće</th><th className="ta-r">Iznos</th></tr></thead>
            <tbody>{d.money.unpaidInvoices.map((i) => <tr key={i.number} className="clickable" onClick={() => navigate('/dokumenti')}><td className="mono">{i.number}</td><td>{i.customer}</td><td className="mono">{i.due_on ?? '—'}</td><td className="ta-r mono">{money(i.total)}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
