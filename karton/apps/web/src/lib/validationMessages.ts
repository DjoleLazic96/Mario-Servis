/**
 * Srpske poruke za ugrađenu HTML validaciju.
 *
 * Zašto uopšte postoji: browser ispisuje te poruke na jeziku SAMOG BROWSERA, a ne po
 * `<html lang="sr">`. Na engleskom Chrome-u Mario dobija „Please fill out this field".
 * Ne postoji podešavanje kojim se to menja — jedini način je preuzeti poruku ručno.
 *
 * Zašto globalno, a ne polje po polje: `required` stoji na 45 mesta u 22 forme. Ovako
 * i svako buduće polje dobija srpsku poruku bez da se iko toga seti.
 */

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** 1 znak · 2–4 znaka · 5+ znakova (ali 11–14 idu na „znakova"). */
function znak(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (dd >= 11 && dd <= 14) return 'znakova';
  if (d === 1) return 'znak';
  if (d >= 2 && d <= 4) return 'znaka';
  return 'znakova';
}

function messageFor(el: Field): string {
  const v = el.validity;
  if (v.valueMissing) return el instanceof HTMLSelectElement ? 'Izaberite stavku iz liste.' : 'Obavezno polje.';
  if (v.typeMismatch) {
    if (el instanceof HTMLInputElement && el.type === 'email') return 'Unesite ispravnu email adresu.';
    if (el instanceof HTMLInputElement && el.type === 'url') return 'Unesite ispravnu internet adresu.';
    return 'Neispravan format.';
  }
  if (v.tooShort && 'minLength' in el) return `Najmanje ${el.minLength} ${znak(el.minLength)}.`;
  if (v.tooLong && 'maxLength' in el) return `Najviše ${el.maxLength} ${znak(el.maxLength)}.`;
  if (v.rangeUnderflow && 'min' in el) return `Najmanja vrednost je ${el.min}.`;
  if (v.rangeOverflow && 'max' in el) return `Najveća vrednost je ${el.max}.`;
  if (v.stepMismatch) return 'Neispravna vrednost.';
  if (v.badInput) return 'Unesite ispravnu vrednost.';
  if (v.patternMismatch) return 'Neispravan format.';
  return 'Neispravan unos.';
}

/** Poziva se jednom pri pokretanju aplikacije. */
export function installSerbianValidation(): void {
  // `invalid` ne putuje naviše (ne „bubbla"), pa se hvata u fazi spuštanja — zato `true`.
  document.addEventListener('invalid', (e) => {
    const el = e.target as Field;
    if (!el?.validity) return;
    el.setCustomValidity(messageFor(el));
  }, true);

  // Bez ovoga polje ostaje ZAUVEK neispravno: postavljena poruka sama po sebi znači
  // grešku, pa se mora obrisati čim korisnik ispravi unos.
  const clear = (e: Event): void => {
    const el = e.target as Field;
    if (el?.setCustomValidity) el.setCustomValidity('');
  };
  document.addEventListener('input', clear, true);
  document.addEventListener('change', clear, true);
}
