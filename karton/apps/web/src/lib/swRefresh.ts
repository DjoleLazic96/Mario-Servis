/**
 * Osvežavanje strane kad service worker dovuče novu verziju aplikacije.
 *
 * ZAŠTO POSTOJI — ovo je bilo uzrok najgoreg kvara do sada:
 *
 * Aplikacija je PWA; service worker drži kopiju `index.html` i `/assets/*` u svom kešu i
 * servira ih BEZ pitanja servera (zato radi bez interneta). Ubačeni `registerSW.js` je radio
 * samo `navigator.serviceWorker.register('/sw.js')` — registruje se i ništa više. Nova verzija
 * bi se instalirala u pozadini, ali strana koja je već otvorena i dalje vrti STARI JavaScript.
 *
 * Posledica: posle svakog deploya, prvo otvaranje pokaže staru verziju. Korisnik gleda ekran
 * na kome njegove izmene „ne rade", iako su na serveru. Prijavljeno 17.07.2026: srpske poruke,
 * žuto bojenje i tekstovi u podnožju — sve troje „ne radi", a sve troje je bilo gore.
 *
 * `registerType: 'autoUpdate'` u `vite.config.ts` daje `skipWaiting` + `clientsClaim`, pa novi
 * SW odmah preuzme kontrolu. Ali preuzimanje kontrole NE osvežava stranu — to je ovde.
 *
 * Zašto ne postoji test: ovo se ne može uhvatiti Playwright-om na uobičajen način, jer svaki
 * test kreće iz praznog pregledača — bez service workera i bez keša. Baš zato mi je i promaklo:
 * test je prolazio, a korisnik je gledao staru verziju. Provera je u `tests/sw-update.mjs`,
 * koja namerno pravi dva različita builda i menja ih pod istim serverom.
 */
export function installServiceWorkerRefresh(): void {
  if (!('serviceWorker' in navigator)) return;

  // Ako strana pri učitavanju NIJE bila pod kontrolom SW-a, ovo je prva instalacija.
  // Tada `clientsClaim` takođe okine `controllerchange`, ali osvežavati nema šta —
  // strana već prikazuje najnoviju verziju. Bez ove provere bi se svaka prva poseta
  // besmisleno ponovo učitala.
  const bioPodKontrolom = Boolean(navigator.serviceWorker.controller);
  if (!bioPodKontrolom) return;

  let osvežavam = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // `controllerchange` ume da se javi više puta; bez brave bi se strana vrtela u krug.
    if (osvežavam) return;
    osvežavam = true;
    window.location.reload();
  });
}
