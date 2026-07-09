import { useEffect, useState } from 'react';
import type { Mechanic } from '@karton/shared';
import { api } from '../api.ts';
import { money } from '../lib/documentHelpers.ts';

type Tab = 'revenue' | 'orders' | 'mechanic' | 'vehicle';

export function Reports(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('revenue');
  return (
    <div className="page">
      <header className="page-head row">
        <div><h1>Izveštaji</h1></div>
        <a className="btn-primary" href="/api/v1/export/all.xlsx" download>Izvezi sve u Excel</a>
      </header>
      <div className="tabs" style={{ marginBottom: 16, width: 'fit-content' }}>
        <button className={`tab ${tab === 'revenue' ? 'active' : ''}`} onClick={() => setTab('revenue')}>Prihod</button>
        <button className={`tab ${tab === 'orders' ? 'active' : ''}`} onClick={() => setTab('orders')}>Pretraga naloga</button>
        <button className={`tab ${tab === 'mechanic' ? 'active' : ''}`} onClick={() => setTab('mechanic')}>Po majstoru</button>
        <button className={`tab ${tab === 'vehicle' ? 'active' : ''}`} onClick={() => setTab('vehicle')}>Po tipu vozila</button>
      </div>
      {tab === 'revenue' && <Revenue />}
      {tab === 'orders' && <OrderSearch />}
      {tab === 'mechanic' && <ByMechanic />}
      {tab === 'vehicle' && <ByVehicle />}
    </div>
  );
}

function Revenue(): React.JSX.Element {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [data, setData] = useState<{ total: number; count: number; byMonth: { month: string; total: number; count: number }[] } | null>(null);
  const load = (): void => {
    const p = new URLSearchParams(); if (from) p.set('from', from); if (to) p.set('to', to);
    void api.get<typeof data>(`/reports/revenue?${p}`).then(setData);
  };
  useEffect(load, [from, to]);
  return (
    <div className="card">
      <div className="report-filter">
        <label className="field"><span>Od</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span>Do</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {data && <>
        <div className="report-stats">
          <div className="stat-box"><span className="stat-num">{money(data.total)}</span><span className="stat-label">Ukupan prihod (RSD)</span></div>
          <div className="stat-box"><span className="stat-num">{data.count}</span><span className="stat-label">Plaćenih računa</span></div>
        </div>
        <table className="mini-table" style={{ marginTop: 12 }}>
          <thead><tr><th>Mesec</th><th className="ta-r">Računa</th><th className="ta-r">Prihod</th></tr></thead>
          <tbody>{data.byMonth.map((m) => <tr key={m.month}><td className="mono">{m.month}</td><td className="ta-r mono">{m.count}</td><td className="ta-r mono">{money(m.total)}</td></tr>)}
            {data.byMonth.length === 0 && <tr><td colSpan={3} className="card-empty">Nema plaćenih računa u periodu.</td></tr>}</tbody>
        </table>
      </>}
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function OrderSearch(): React.JSX.Element {
  const [q, setQ] = useState(''); const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { const t = setTimeout(() => { const p = new URLSearchParams(); if (q) p.set('q', q); void api.get<any[]>(`/reports/work-orders?${p}`).then(setRows); }, 250); return () => clearTimeout(t); }, [q]);
  return (
    <div className="card">
      <input className="search" placeholder="Klijent, vozilo, tablica…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      <table className="mini-table">
        <thead><tr><th>Broj</th><th>Datum</th><th>Klijent</th><th>Vozilo</th><th>Delovi</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.number}><td className="mono">{r.number}</td><td className="mono">{r.received_on}</td><td>{r.customer}</td><td>{r.make} {r.model} <span className="mono muted">{r.plate ?? ''}</span></td><td className="muted">{r.parts ?? '—'}</td></tr>)}
          {rows.length === 0 && <tr><td colSpan={5} className="card-empty">Nema rezultata.</td></tr>}</tbody>
      </table>
    </div>
  );
}

function ByMechanic(): React.JSX.Element {
  const [mechanics, setMechanics] = useState<Mechanic[]>([]); const [id, setId] = useState(''); const [data, setData] = useState<any>(null);
  useEffect(() => { void api.get<Mechanic[]>('/mechanics').then((m) => { setMechanics(m); if (m[0]) setId(String(m[0].id)); }); }, []);
  useEffect(() => { if (id) void api.get<any>(`/reports/mechanics/${id}`).then(setData); }, [id]);
  return (
    <div className="card">
      <select className="search" value={id} onChange={(e) => setId(e.target.value)} style={{ marginBottom: 12 }}>{mechanics.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}</select>
      {data && <div className="report-stats">
        <div className="stat-box"><span className="stat-num">{data.orders}</span><span className="stat-label">Naloga</span></div>
        <div className="stat-box"><span className="stat-num">{data.hours}</span><span className="stat-label">Sati rada</span></div>
        <div className="stat-box"><span className="stat-num">{money(data.value)}</span><span className="stat-label">Vrednost rada (RSD)</span></div>
      </div>}
    </div>
  );
}

function ByVehicle(): React.JSX.Element {
  const [make, setMake] = useState(''); const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { const t = setTimeout(() => { const p = new URLSearchParams(); if (make) p.set('make', make); void api.get<any[]>(`/reports/vehicle-types?${p}`).then(setRows); }, 250); return () => clearTimeout(t); }, [make]);
  return (
    <div className="card">
      <input className="search" placeholder="Marka (npr. Volkswagen)…" value={make} onChange={(e) => setMake(e.target.value)} style={{ marginBottom: 12 }} />
      <table className="mini-table">
        <thead><tr><th>Broj</th><th>Datum</th><th>Vozilo</th><th>Opis</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.number}><td className="mono">{r.number}</td><td className="mono">{r.received_on}</td><td>{r.make} {r.model} {r.year ? `· ${r.year}` : ''} {r.fuel ? `· ${r.fuel}` : ''}</td><td className="muted">{r.description ?? '—'}</td></tr>)}
          {rows.length === 0 && <tr><td colSpan={4} className="card-empty">Nema rezultata.</td></tr>}</tbody>
      </table>
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
