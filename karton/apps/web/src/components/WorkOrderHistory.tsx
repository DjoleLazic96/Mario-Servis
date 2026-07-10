import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkOrder, Paginated } from '@karton/shared';
import { labels } from '@karton/shared';
import { api } from '../api.ts';
import { statusClass } from '../lib/workOrderStatus.ts';

/**
 * Istorija naloga za jednog klijenta ili jedno vozilo (spec §3.3 i §3.5).
 * Bira se tačno jedan filter — otuda unija umesto dva opcionalna polja.
 */
type Scope = { customerId: number } | { vehicleId: number };

export function WorkOrderHistory({ scope, showVehicle = true }: { scope: Scope; showVehicle?: boolean }): React.JSX.Element {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<WorkOrder[] | null>(null);

  const key = 'customerId' in scope ? `customerId=${scope.customerId}` : `vehicleId=${scope.vehicleId}`;
  useEffect(() => {
    void (async () => {
      const res = await api.get<Paginated<WorkOrder>>(`/work-orders?${key}&pageSize=50&sort=received:desc`);
      setOrders(res.data);
    })();
  }, [key]);

  if (!orders) return <p className="card-empty">Učitavanje…</p>;
  if (orders.length === 0) return <p className="card-empty">Nema radnih naloga.</p>;

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr>
          <th>Broj</th>
          <th>Prijem</th>
          {showVehicle && <th>Vozilo</th>}
          <th>Zahtevani radovi</th>
          <th>Status</th>
        </tr></thead>
        <tbody>
          {orders.map((w) => (
            <tr key={w.id} className="clickable" onClick={() => navigate(`/nalozi/${w.id}`)}>
              <td className="mono strong" data-label="Broj">{w.number}</td>
              <td className="mono" data-label="Prijem">{w.receivedOn}</td>
              {showVehicle && <td data-label="Vozilo"><span className="mono">{w.vehicle.plate ?? '—'}</span> {w.vehicle.make} {w.vehicle.model}</td>}
              <td data-label="Zahtevani radovi" className="truncate">{w.requestedWork ?? '—'}</td>
              <td data-label="Status"><span className={`badge ${statusClass[w.status]}`}>{labels.workOrderStatus[w.status]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
