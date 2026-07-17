import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkOrder, WorkOrderStatus, Paginated } from '@karton/shared';
import { labels } from '@karton/shared';
import { api } from '../api.ts';
import { formatDate } from '../lib/documentHelpers.ts';

/**
 * Radionica na jedan pogled: samo NEZAVRŠENI nalozi, grupisani po statusu i obojeni po njemu.
 * Kartice se slažu (4/red na računaru, 1/red na telefonu); između grupa naslov + linija.
 * Poenta: Mario odmah vidi šta je otvoreno, šta je u radu i šta čeka delove — i dokad.
 */

// Redosled grupa: kako posao teče kroz radionicu.
const GROUPS: WorkOrderStatus[] = ['open', 'in_progress', 'waiting_parts'];

const FILTERS: { key: 'all' | WorkOrderStatus; label: string }[] = [
  { key: 'all', label: 'Svi' },
  { key: 'open', label: 'Otvoren' },
  { key: 'in_progress', label: 'U radu' },
  { key: 'waiting_parts', label: 'Čeka delove' },
];

const cardClass: Record<WorkOrderStatus, string> = {
  open: 'nz-open', in_progress: 'nz-progress', waiting_parts: 'nz-wait',
  completed: '', cancelled: '',
};

/** Danas u lokalnom (beogradskom) zidnom vremenu — za poređenje sa rokom za delove. */
const today = (): string => new Date().toLocaleDateString('sv-SE');

export function Nezavrseni(): React.JSX.Element {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | WorkOrderStatus>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Sve aktivne odjednom (bez paginacije) — radionica retko ima na stotine otvorenih.
      const r = await api.get<Paginated<WorkOrder>>('/work-orders?active=true&pageSize=200&sort=received');
      setOrders(r.data);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = GROUPS.filter((g) => filter === 'all' || filter === g);
  const count = (s: WorkOrderStatus): number => orders.filter((o) => o.status === s).length;

  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <h1>Monitoring</h1>
          <p className="page-sub">{orders.length} {orders.length === 1 ? 'aktivan nalog' : 'aktivnih naloga'}</p>
        </div>
        <button className="btn-primary" onClick={() => navigate('/nalozi')}>Svi nalozi</button>
      </header>

      <div className="tabs" style={{ marginBottom: 16, width: 'fit-content' }}>
        {FILTERS.map((f) => (
          <button key={f.key} className={`tab ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}{f.key !== 'all' && count(f.key as WorkOrderStatus) > 0 ? ` (${count(f.key as WorkOrderStatus)})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="card-empty">Učitavanje…</p>
      ) : orders.length === 0 ? (
        <p className="card-empty">Nema nezavršenih naloga — sve je gotovo. 🎉</p>
      ) : (
        shown.map((status) => {
          const group = orders.filter((o) => o.status === status);
          if (group.length === 0) return null;
          return (
            <section className="nz-group" key={status}>
              <h2 className={`nz-group-head ${cardClass[status]}`}>
                {labels.workOrderStatus[status]} <span className="nz-count">{group.length}</span>
              </h2>
              <div className="nz-grid">
                {group.map((o) => <Card key={o.id} o={o} onClick={() => navigate(`/nalozi/${o.id}`)} />)}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function Card({ o, onClick }: { o: WorkOrder; onClick: () => void }): React.JSX.Element {
  const overdue = o.partsExpectedOn != null && o.partsExpectedOn < today();
  return (
    <button className={`nz-card ${cardClass[o.status]}`} onClick={onClick}>
      <div className="nz-card-top">
        <span className="mono nz-num">{o.number}</span>
        <span className="nz-date mono">{formatDate(o.receivedOn)}</span>
      </div>
      <div className="nz-veh">
        <span className="mono">{o.vehicle.plate ?? o.vehicle.vin}</span> {o.vehicle.make} {o.vehicle.model}
      </div>
      <div className="nz-cust">{o.customer.name}</div>
      {o.requestedWork && <div className="nz-complaint">„{o.requestedWork}"</div>}
      {o.status === 'waiting_parts' && (o.partsExpectedOn || o.partsNote) && (
        <div className={`nz-parts ${overdue ? 'overdue' : ''}`}>
          {o.partsExpectedOn && <span>Delovi: {formatDate(o.partsExpectedOn)}{overdue ? ' — kasni!' : ''}</span>}
          {o.partsNote && <span className="nz-parts-note">{o.partsNote}</span>}
        </div>
      )}
    </button>
  );
}
