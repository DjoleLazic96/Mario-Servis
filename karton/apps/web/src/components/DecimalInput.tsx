/**
 * Polje za decimalan broj (novac, sati, količine) koje prima I ZAREZ I TAČKU.
 *
 * Zašto nije `<input type="number">`:
 *
 *  1. ZAREZ — `type="number"` decimalni znak tumači po jeziku PREGLEDAČA. Isti unos
 *     „1,5" negde prođe, negde tiho ispadne, a mi na to nemamo nikakav uticaj. Prijavljeno
 *     17.07.2026: „Neće zarez da mi unese." Nije se moglo ponoviti u testu — što je i
 *     poenta: ne sme da zavisi od toga koji pregledač i koja tastatura su pred čovekom.
 *  2. STEP — bez `step` podrazumevani korak je 1, pa `type="number"` odbija SVAKU decimalu:
 *     „2500,50" je bilo nemoguće uneti, uz maglovito „Neispravna vrednost."
 *
 * `type="text"` + `inputMode="decimal"` rešava oba: telefon i dalje otvara brojčanu
 * tastaturu, a zarez pretvaramo u tačku sami. Napolje uvek izlazi tačka, jer to je ono
 * što `Number()` i baza razumeju.
 */

/** „1,5" → „1.5"; izbacuje sve što nije cifra ili tačka; ostavlja samo prvu tačku. */
export function toDecimal(raw: string): string {
  const s = raw.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const i = s.indexOf('.');
  if (i === -1) return s;
  return s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');
}

export function DecimalInput({
  value, onChange, required, placeholder, autoFocus, id,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  id?: string;
}): React.JSX.Element {
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      /* Traži bar jednu cifru pre tačke — bez ovoga bi sama „." prošla kao unos i
         završila kao NaN u iznosu. Poruka je srpska (vidi validationMessages.ts). */
      pattern="\d+([.]\d*)?"
      value={value}
      required={required}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => onChange(toDecimal(e.target.value))}
    />
  );
}
