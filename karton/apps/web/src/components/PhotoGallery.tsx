import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { VehiclePhotoGroup, WorkOrderPhoto } from '@karton/shared';
import { api } from '../api.ts';
import { Modal } from './Modal.tsx';
import { formatDate } from '../lib/documentHelpers.ts';

/**
 * Galerija na kartonu vozila. Jedna grupa = jedna poseta (radni nalog),
 * pa se prirodno rešava „vozilo dolazi više puta" — svaki dolazak ima svoje slike.
 */
export function PhotoGallery({ vehicleId }: { vehicleId: number }): React.JSX.Element {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<VehiclePhotoGroup[] | null>(null);
  const [zoom, setZoom] = useState<WorkOrderPhoto | null>(null);

  useEffect(() => {
    void api.get<VehiclePhotoGroup[]>(`/vehicles/${vehicleId}/photos`).then(setGroups);
  }, [vehicleId]);

  if (!groups) return <p className="card-empty">Učitavanje…</p>;
  if (groups.length === 0) return <p className="card-empty">Nema slika ni za jedan prijem ovog vozila.</p>;

  return (
    <>
      {groups.map((g) => (
        <div className="gallery-visit" key={g.workOrderId}>
          <div className="gallery-visit-head">
            <span className="mono">{formatDate(g.receivedOn)}</span>
            <button className="btn-link mono" onClick={() => navigate(`/nalozi/${g.workOrderId}`)}>{g.workOrderNumber}</button>
            <span className="muted">· {g.photos.length} {g.photos.length === 1 ? 'slika' : 'slika'}</span>
          </div>
          <div className="photo-grid">
            {g.photos.map((p) => (
              <figure className="photo-thumb" key={p.id}>
                <img src={`/api/v1/photos/${p.id}`} alt="Slika vozila sa prijema" loading="lazy"
                  onClick={() => setZoom(p)}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).classList.add('missing'); }} />
              </figure>
            ))}
          </div>
        </div>
      ))}

      {zoom && (
        <Modal title="Slika sa prijema" onClose={() => setZoom(null)} width={900}>
          <img className="photo-full" src={`/api/v1/photos/${zoom.id}`} alt="Slika vozila sa prijema" />
          <p className="hint">{new Date(zoom.createdAt).toLocaleString('sr-RS')}{zoom.createdBy ? ` · slikao: ${zoom.createdBy}` : ''}</p>
        </Modal>
      )}
    </>
  );
}
