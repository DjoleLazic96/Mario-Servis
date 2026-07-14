import { useEffect, useRef, useState } from 'react';

/**
 * Datum u srpskom formatu: DD.MM.GGGG — kucanjem ILI klikom u kalendar.
 *
 * Ne koristimo <input type="date"> jer ga browser prikazuje po SVOJOJ lokalizaciji
 * (na en-US mašini ispadne `mm/dd/yyyy`, a i sam kalendar bude na engleskom).
 * Zato je i kalendar naš — srpski nazivi dana i meseci, nedelja počinje ponedeljkom.
 *
 * Vrednost koju komponenta prima i emituje ostaje ISO `YYYY-MM-DD` — baza i API se NE diraju.
 */
const DANI = ['Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub', 'Ned'];
const MESECI = ['Januar', 'Februar', 'Mart', 'April', 'Maj', 'Jun',
  'Jul', 'Avgust', 'Septembar', 'Oktobar', 'Novembar', 'Decembar'];

const pad = (n: number): string => String(n).padStart(2, '0');
/** ISO iz komponenti — bez `toISOString()`, koji bi pomerio dan zbog vremenske zone. */
const isoOf = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`;

function isoToSr(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}.${m}.${y}` : '';
}

function srToIso(sr: string): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(sr);
  if (!m) return '';
  const [, d, mo, y] = m;
  const dd = Number(d), mm = Number(mo), yy = Number(y);
  // Provera bez `new Date('...T00:00:00')` — to se parsira kao LOKALNO vreme, pa bi
  // u Beogradu (UTC+2) getUTCDate() vratio dan ranije i odbio ispravan datum.
  if (mm < 1 || mm > 12 || dd < 1 || yy < 1900 || yy > 2999) return '';
  const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (dd > daysInMonth) return '';   // odbacuje 31.02., 31.04. …
  return isoOf(yy, mm, dd);
}

/** Cifre → maskiran tekst: 1507 → „15.07", 15072026 → „15.07.2026" */
function mask(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length > 4) return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`;
  if (d.length > 2) return `${d.slice(0, 2)}.${d.slice(2)}`;
  return d;
}

export function DateInput({ value, onChange, required, autoFocus, id, className }: {
  value: string;                       // ISO 'YYYY-MM-DD' ili ''
  onChange: (iso: string) => void;     // emituje ISO (ili '' dok je nepotpun)
  required?: boolean;
  autoFocus?: boolean;
  id?: string;
  className?: string;
}): React.JSX.Element {
  const [text, setText] = useState(() => isoToSr(value));
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => firstOfMonth(value));
  const wrapRef = useRef<HTMLDivElement>(null);

  function firstOfMonth(iso: string): { y: number; m: number } {
    const t = new Date();
    if (iso) {
      const [y, m] = iso.split('-').map(Number);
      if (y && m) return { y, m };
    }
    return { y: t.getFullYear(), m: t.getMonth() + 1 };
  }

  // spolja promenjena vrednost (npr. reset forme) — ne diramo dok korisnik kuca
  useEffect(() => {
    if (srToIso(text) !== value) setText(isoToSr(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // klik van komponente / Esc → zatvori kalendar
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  function handle(raw: string): void {
    const t = mask(raw);
    setText(t);
    const iso = srToIso(t);
    onChange(iso);
    if (iso) setView(firstOfMonth(iso));
  }

  function pick(y: number, m: number, d: number): void {
    const iso = isoOf(y, m, d);
    setText(isoToSr(iso));
    onChange(iso);
    setOpen(false);
  }

  function shiftMonth(delta: number): void {
    setView((v) => {
      const m = v.m + delta;
      if (m < 1) return { y: v.y - 1, m: 12 };
      if (m > 12) return { y: v.y + 1, m: 1 };
      return { y: v.y, m };
    });
  }

  // mreža meseca — nedelja počinje ponedeljkom
  const daysInMonth = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate();
  const firstWeekday = (new Date(Date.UTC(view.y, view.m - 1, 1)).getUTCDay() + 6) % 7; // Pon = 0
  const today = new Date();
  const todayIso = isoOf(today.getFullYear(), today.getMonth() + 1, today.getDate());

  return (
    <div className="date-wrap" ref={wrapRef}>
      <input
        id={id}
        className={className}
        type="text"
        inputMode="numeric"
        placeholder="DD.MM.GGGG"
        maxLength={10}
        value={text}
        onChange={(e) => handle(e.target.value)}
        required={required}
        autoFocus={autoFocus}
        title="Kucaj cifre (15072026) ili klikni na kalendar"
      />
      <button type="button" className="date-btn" onClick={() => { setView(firstOfMonth(value)); setOpen((o) => !o); }}
        title="Otvori kalendar" tabIndex={-1}>📅</button>

      {open && (
        <div className="date-pop">
          <div className="date-pop-head">
            <button type="button" onClick={() => shiftMonth(-1)} title="Prethodni mesec">‹</button>
            <span>{MESECI[view.m - 1]} {view.y}</span>
            <button type="button" onClick={() => shiftMonth(1)} title="Sledeći mesec">›</button>
          </div>
          <div className="date-pop-grid">
            {DANI.map((d) => <span className="date-dow" key={d}>{d}</span>)}
            {Array.from({ length: firstWeekday }, (_, i) => <span key={`x${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const d = i + 1;
              const iso = isoOf(view.y, view.m, d);
              return (
                <button type="button" key={d}
                  className={`date-day ${iso === value ? 'sel' : ''} ${iso === todayIso ? 'today' : ''}`}
                  onClick={() => pick(view.y, view.m, d)}>{d}</button>
              );
            })}
          </div>
          <div className="date-pop-foot">
            <button type="button" className="btn-link" onClick={() => {
              const t = new Date(); pick(t.getFullYear(), t.getMonth() + 1, t.getDate());
            }}>Danas</button>
            <button type="button" className="btn-link danger" onClick={() => { setText(''); onChange(''); setOpen(false); }}>Obriši</button>
          </div>
        </div>
      )}
    </div>
  );
}
