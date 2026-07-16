import { useEffect, useState } from 'react';
import { formatDate } from '../lib/documentHelpers.ts';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import type { WorkOrderDetail } from '@karton/shared';
import { labels } from '@karton/shared';
import { api } from '../api.ts';

interface Shop { shopName: string; address: string | null; taxId: string | null; phone: string | null; logo: string | null }

/** Radni nalog (A4) — jedina standardna štampa naloga (spec §4.4). */
export function WorkOrderPrint(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [wo, setWo] = useState<WorkOrderDetail | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [qr, setQr] = useState('');

  useEffect(() => {
    void (async () => {
      const [w, s] = await Promise.all([api.get<WorkOrderDetail>(`/work-orders/${id}`), api.get<Shop>('/settings')]);
      setWo(w); setShop(s);
      setQr(await QRCode.toDataURL(`${window.location.origin}/nalozi/${id}`, { margin: 0, width: 200 }));
    })();
  }, [id]);

  // Otvori dijalog štampe kad je sve iscrtano
  useEffect(() => { if (wo && shop && qr) setTimeout(() => window.print(), 300); }, [wo, shop, qr]);

  if (!wo || !shop) return <div className="fullscreen-msg">Priprema štampe…</div>;

  const printedAt = new Date().toLocaleString('sr-RS');
  const Blank = (): React.JSX.Element => <span className="pl-blank" />;
  const Cb = ({ on }: { on?: boolean }): React.JSX.Element => <span className={`pl-cb ${on ? 'on' : ''}`} />;

  return (
    <div className="pl-sheet">
      <div className="pl-head">
        <div className="pl-brand">
          {shop.logo
            ? <img className="pl-logo-img" src={shop.logo} alt="" />
            : <div className="pl-logo">LOGO</div>}
          <div>
            <div className="pl-shop">{shop.shopName}</div>
            <div className="pl-shop-meta">
              {shop.address ?? ''}{shop.taxId ? ` · PIB ${shop.taxId}` : ''}{shop.phone ? ` · ${shop.phone}` : ''}
            </div>
          </div>
        </div>
        <div className="pl-id">
          <div className="pl-title">Radni nalog</div>
          <div className="pl-num">{wo.number}</div>
          <div className="pl-sub">
            <span className="pl-pill">{labels.workOrderStatus[wo.status]}</span>
            <span className="pl-printed">štampano {printedAt}</span>
          </div>
        </div>
        {qr && <img className="pl-qr" src={qr} alt="QR nalog" />}
      </div>

      <div className="pl-cols">
        <div>
          <div className="pl-sec">Klijent</div>
          <dl className="pl-kv">
            <dt>Tip</dt><dd>{wo.customer.type === 'company' ? 'Pravno lice' : 'Fizičko lice'}</dd>
            <dt>{wo.customer.type === 'company' ? 'Naziv' : 'Ime i prezime'}</dt><dd>{wo.customer.name}</dd>
          </dl>
        </div>
        <div>
          <div className="pl-sec">Vozilo</div>
          <dl className="pl-kv">
            <dt>Marka i model</dt><dd>{wo.vehicle.make} {wo.vehicle.model}</dd>
            <dt>Reg. oznaka</dt><dd className="mono">{wo.vehicle.plate ?? '—'}</dd>
            <dt>Broj šasije</dt><dd className="mono">{wo.vehicle.vin}</dd>
            <dt>Kilometraža</dt><dd className="mono">{wo.odometerKm != null ? `${wo.odometerKm.toLocaleString('sr-RS')} km` : '—'}</dd>
          </dl>
        </div>
      </div>

      <div className="pl-strip">
        <div><span className="pl-lbl">Datum prijema</span><span className="mono">{formatDate(wo.receivedOn)}</span></div>
        <div><span className="pl-lbl">Vreme prijema</span>{wo.receivedTime ? <span className="mono">{wo.receivedTime}</span> : <Blank />}</div>
        <div><span className="pl-lbl">Datum predaje</span>{wo.completedOn ? <span className="mono">{formatDate(wo.completedOn)}</span> : <Blank />}</div>
        <div><span className="pl-lbl">Vreme predaje</span>{wo.completedTime ? <span className="mono">{wo.completedTime}</span> : <Blank />}</div>
      </div>

      {wo.fieldVisit && (
        <>
          <div className="pl-sec">Izlazak na teren</div>
          <div className="pl-strip">
            <div><span className="pl-lbl">Datum izlaska</span>{wo.fieldVisitDate ? <span className="mono">{formatDate(wo.fieldVisitDate)}</span> : <Blank />}</div>
            <div><span className="pl-lbl">Vreme izlaska</span>{wo.fieldVisitTime ? <span className="mono">{wo.fieldVisitTime}</span> : <Blank />}</div>
            <div><span className="pl-lbl">Lokacija</span>{wo.fieldVisitLocation ?? <Blank />}</div>
            <div><span className="pl-lbl">Pređeni km</span>{wo.fieldVisitKm != null ? <span className="mono">{wo.fieldVisitKm}</span> : <Blank />}</div>
          </div>
          <div className="pl-row">
            <span className="pl-row-name">Vozilo u voznom stanju</span>
            <span className="pl-opts"><span><Cb on={wo.vehicleDrivable === true} />Da</span><span><Cb on={wo.vehicleDrivable === false} />Ne</span></span>
            <span className="pl-row-name">Ishod</span>
            <span className="pl-opts">
              <span><Cb on={wo.fieldVisitOutcome === 'solved_on_site'} />Rešeno na terenu</span>
              <span><Cb on={wo.fieldVisitOutcome === 'arrives_driving'} />Dolazi na točkovima</span>
              <span><Cb on={wo.fieldVisitOutcome === 'arrives_towed'} />Dolazi na šlepu</span>
              <span><Cb on={wo.fieldVisitOutcome === 'customer_declined'} />Klijent odustao</span>
            </span>
          </div>
        </>
      )}

      <div className="pl-sec">Opis posla</div>
      <div className="pl-text"><span className="pl-lbl">Zahtevani radovi</span>{wo.requestedWork ?? ''}</div>
      <div className="pl-text"><span className="pl-lbl">Napomena</span>{wo.note ?? ''}</div>

      <div className="pl-sec">Izvršeni radovi</div>
      <table className="pl-hand">
        <thead><tr><th style={{ width: 26 }}>RB</th><th>Opis radova</th><th style={{ width: 50 }}>Sati</th><th style={{ width: '33%' }}>Utrošeni delovi</th></tr></thead>
        <tbody>{[1, 2, 3, 4, 5, 6].map((n) => <tr key={n}><td>{n}</td><td /><td /><td /></tr>)}</tbody>
      </table>

      <div className="pl-duo">
        <div>
          <div className="pl-sec">Kontrola vozila</div>
          <div className="pl-checklist">
            <div className="pl-row"><span className="pl-row-name">Kontrola izvršena</span><span className="pl-opts"><span><Cb />Da</span><span><Cb />Ne</span></span></div>
            {['Ulje motora', 'Kočiono ulje', 'Rashladna tečnost'].map((t) => (
              <div className="pl-row" key={t}>
                <span className="pl-row-name">{t}</span>
                <span className="pl-opts"><span><Cb />OK</span><span><Cb />Doliveno <span className="pl-qty" /></span></span>
              </div>
            ))}
            <div className="pl-row"><span className="pl-row-name">Nivo goriva</span>
              <span className="pl-opts pl-fuel">{['E', '¼', '½', '¾', 'F'].map((f) => <span key={f}><Cb />{f}</span>)}</span></div>
          </div>
        </div>
        <div>
          <div className="pl-sec">Oštećenja vozila</div>
          <img className="pl-sketch" src="/skica-vozila.png" alt="Skica vozila" />
          <div className="pl-legend"><strong>O</strong> = ogrebotina · <strong>U</strong> = udubljenje · <strong>X</strong> = lom / nedostaje</div>
          <div className="pl-rule" />
        </div>
      </div>

      <div className="pl-consent">Potpisom predaje potvrđujem tačnost podataka, označeno zatečeno stanje vozila i saglasnost za navedene radove.</div>
      <div className="pl-signs">
        <div><div className="pl-sign-line" /><div className="pl-sign-lbl">Predaja vozila servisu — potpis klijenta</div></div>
        <div><div className="pl-sign-line" /><div className="pl-sign-lbl">Povrat vozila — potpis klijenta</div></div>
      </div>

      <div className="pl-foot">
        <span>Interni dokument — nije fiskalni račun · Servis ne odgovara za lične stvari ostavljene u vozilu.</span>
        <span>{wo.number} · strana 1/1</span>
      </div>
    </div>
  );
}
