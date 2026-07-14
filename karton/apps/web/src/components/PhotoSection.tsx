import { useEffect, useRef, useState } from 'react';
import type { WorkOrderPhoto } from '@karton/shared';
import { api, ApiRequestError } from '../api.ts';
import { Modal } from './Modal.tsx';

const MAX_PHOTOS = 10;
const MAX_EDGE = 1600;   // duža stranica
const QUALITY = 0.8;     // JPEG

/** Telefon slika 3–8 MB. Smanjujemo i kompresujemo U BROWSERU pre slanja (~250 KB),
 *  pa server ne treba native biblioteku za slike, a upload je brz i na slabom internetu. */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Slika se ne može učitati.')); };
    img.src = url;
  });
}

async function compress(file: File): Promise<string> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Obrada slike nije moguća u ovom browseru.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', QUALITY);
}

const kb = (b: number): string => `${Math.round(b / 1024)} KB`;

/** Slike sa prijema vozila. Dodaju se/brišu samo dok je nalog otvoren (posle su dokaz — zaključane). */
export function PhotoSection({ workOrderId, editable }: { workOrderId: number; editable: boolean }): React.JSX.Element {
  const [photos, setPhotos] = useState<WorkOrderPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState<WorkOrderPhoto | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.get<WorkOrderPhoto[]>(`/work-orders/${workOrderId}/photos`).then(setPhotos);
  }, [workOrderId]);

  async function upload(files: FileList): Promise<void> {
    setErr(null);
    const slobodno = MAX_PHOTOS - photos.length;
    if (slobodno <= 0) { setErr(`Dostignut limit od ${MAX_PHOTOS} slika.`); return; }

    const izabrane = [...files].slice(0, slobodno);
    if (files.length > slobodno) setErr(`Može još samo ${slobodno} — višak je preskočen.`);

    setBusy(true);
    try {
      for (const f of izabrane) {
        const dataUrl = await compress(f);
        setPhotos(await api.post<WorkOrderPhoto[]>(`/work-orders/${workOrderId}/photos`, { dataUrl }));
      }
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.body.message : (e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove(p: WorkOrderPhoto): Promise<void> {
    if (!confirm('Obrisati ovu sliku?')) return;
    setBusy(true);
    try { setPhotos(await api.del<WorkOrderPhoto[]>(`/work-orders/${workOrderId}/photos/${p.id}`)); }
    catch (e) { setErr(e instanceof ApiRequestError ? e.body.message : 'Greška pri brisanju.'); }
    finally { setBusy(false); }
  }

  const puno = photos.length >= MAX_PHOTOS;

  return (
    <section className="card">
      <div className="row" style={{ alignItems: 'center' }}>
        <h2 className="card-title">Slike sa prijema <span className="muted">({photos.length}/{MAX_PHOTOS})</span></h2>
        {editable && (
          <div className="btn-group">
            <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files; if (f && f.length) void upload(f); }} />
            <button className="btn-secondary btn-sm" disabled={busy || puno} onClick={() => fileRef.current?.click()}>
              {busy ? 'Otpremam…' : puno ? 'Limit dostignut' : '📷 Dodaj slike'}
            </button>
          </div>
        )}
      </div>

      {!editable && <p className="hint">Nalog je završen — slike su zaključane (dokaz stanja pri prijemu).</p>}
      {err && <div className="login-error">{err}</div>}

      {photos.length === 0
        ? <p className="card-empty">Nema slika sa prijema.</p>
        : (
          <div className="photo-grid">
            {photos.map((p) => (
              <figure className="photo-thumb" key={p.id}>
                <img src={`/api/v1/photos/${p.id}`} alt="Slika vozila sa prijema" loading="lazy"
                  onClick={() => setZoom(p)}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).classList.add('missing'); }} />
                {editable && <button className="photo-del" title="Obriši sliku" onClick={() => remove(p)}>×</button>}
                <figcaption>{kb(p.sizeBytes)}{p.createdBy ? ` · ${p.createdBy}` : ''}</figcaption>
              </figure>
            ))}
          </div>
        )}

      {zoom && (
        <Modal title="Slika sa prijema" onClose={() => setZoom(null)} width={900}>
          <img className="photo-full" src={`/api/v1/photos/${zoom.id}`} alt="Slika vozila sa prijema" />
          <p className="hint">{new Date(zoom.createdAt).toLocaleString('sr-RS')}{zoom.createdBy ? ` · slikao: ${zoom.createdBy}` : ''}</p>
        </Modal>
      )}
    </section>
  );
}
