/**
 * Responzivnost — provera u PRAVOM pregledaču, na 7 širina ekrana (320–1440px).
 *
 * Zašto postoji: 16.07.2026. je prijavljeno sa telefona (Xiaomi 13) da se kartice
 * klijenata stapaju u beli blok, a filteri i polja u Podešavanjima beže van ekrana.
 * Uzrok je bio red u CSS-u: mobilni `@media` blok je stajao PRE osnovnih pravila,
 * pa ga je kaskada tiho gazila (medijski upit ne nosi veću težinu).
 *
 * Test hvata: vodoravno pomeranje stranice, sadržaj koji beži van glavnog okvira,
 * slepljene/preklopljene kartice i tabelu koja na telefonu nije providna.
 *
 * Pokretanje (traži pokrenut stack i Playwright):
 *   APP_USER=admin APP_PW=admin node tests/responsive.mjs http://localhost:5173
 */
import { chromium } from 'playwright';

const SIRINE = [
  { w: 320, h: 700, ime: 'mali telefon (320)' },
  { w: 360, h: 800, ime: 'Xiaomi 13 (360)' },
  { w: 390, h: 844, ime: 'iPhone (390)' },
  { w: 412, h: 915, ime: 'veci Android (412)' },
  { w: 768, h: 1024, ime: 'tablet (768)' },
  { w: 1024, h: 768, ime: 'mali laptop (1024)' },
  { w: 1440, h: 900, ime: 'desktop (1440)' },
];
const STRANE = [
  ['/', 'Pocetna'], ['/klijenti', 'Klijenti'], ['/vozila', 'Vozila'],
  ['/nalozi', 'Radni nalozi'], ['/kalendar', 'Kalendar'], ['/dokumenti', 'Dokumenti'],
  ['/cenovnik', 'Cenovnik'], ['/izvestaji', 'Izvestaji'], ['/podesavanja', 'Podesavanja'],
];

const BASE = process.argv[2] || 'https://autoserviss23.rs';
const b = await chromium.launch();
let problema = 0;

for (const s of SIRINE) {
  const ctx = await b.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[autocomplete="username"]', process.env.APP_USER || 'mario');
  await p.fill('input[type="password"]', process.env.APP_PW);
  await p.click('button[type="submit"]');
  // React Router menja adresu bez učitavanja strane — čekamo da se pojavi meni.
  await p.waitForSelector('.sidebar-nav', { timeout: 15000 });

  const loši = [];
  for (const [put, ime] of STRANE) {
    await p.goto(`${BASE}${put}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => {
      const nalazi = [];
      const de = document.documentElement;
      if (de.scrollWidth - de.clientWidth > 1) nalazi.push(`stranica se pomera vodoravno ${de.scrollWidth - de.clientWidth}px`);

      // Ono što korisnik stvarno vidi: sadržaj koji prelива UNUTAR glavnog okvira.
      // (.app-main ima overflow:auto, pa se stranica ne pomera — ali delovi ipak beže.)
      const main = document.querySelector('.app-main');
      if (main && main.scrollWidth - main.clientWidth > 1) {
        nalazi.push(`sadržaj beži ${main.scrollWidth - main.clientWidth}px van okvira`);
      }

      // Konkretni krivci: šta viri desno od svog roditelja (a nije namerni skroler).
      const krivci = [];
      const okvir = main || document.body;
      const granica = okvir.getBoundingClientRect().right;
      for (const el of okvir.querySelectorAll('*')) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (b.right > granica + 1) {
          let rod = el.parentElement, uSkroleru = false;
          while (rod && rod !== okvir) {
            const ps = getComputedStyle(rod);
            if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') { uSkroleru = true; break; }
            rod = rod.parentElement;
          }
          if (uSkroleru) continue;
          krivci.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().trim().split(' ')[0]} (+${Math.round(b.right - granica)}px)`);
        }
      }
      if (krivci.length) nalazi.push(`viri: ${[...new Set(krivci)].slice(0, 3).join(', ')}`);

      // Na telefonu tabela postaje kartice: okvir tabele mora da NESTANE, inače
      // kartice plivaju u belom bloku i izgledaju spojeno (prijava korisnika).
      if (window.innerWidth <= 720) {
        for (const tw of document.querySelectorAll('.table-wrap')) {
          if (!tw.querySelector('.data-table tbody > tr')) continue;
          const st = getComputedStyle(tw);
          const providan = st.backgroundColor === 'rgba(0, 0, 0, 0)' || st.backgroundColor === 'transparent';
          if (!providan) nalazi.push(`okvir tabele nije providan (${st.backgroundColor}) — kartice izgledaju spojeno`);
          break;
        }
      }

      // Kartice na telefonu moraju da budu ODVOJENE — ni preklopljene ni slepljene.
      // (Korisnik je prijavio da izgledaju „spojeno, sa belim između".)
      if (window.innerWidth <= 720) {
        for (const tb of document.querySelectorAll('.data-table tbody')) {
          const red = [...tb.querySelectorAll(':scope > tr')].filter((r) => r.getBoundingClientRect().height > 0);
          for (let i = 1; i < red.length; i++) {
            const a = red[i - 1].getBoundingClientRect(), b = red[i].getBoundingClientRect();
            const razmak = Math.round(b.top - a.bottom);
            if (razmak < 6) {
              nalazi.push(razmak < 0 ? `kartice se PREKLAPAJU (${-razmak}px)` : `kartice slepljene (razmak samo ${razmak}px)`);
              break;
            }
          }
        }
      }
      return nalazi;
    });
    if (r.length) loši.push(`${ime}: ${r.join(' · ')}`);
  }
  const status = loši.length === 0 ? 'OK  ' : 'FAIL';
  console.log(`  [${status}] ${s.ime}`);
  for (const l of loši) { console.log(`         ${l}`); problema++; }
  await ctx.close();
}
await b.close();
console.log(problema === 0 ? '\n═══ Nema prelivanja ni na jednoj širini ═══' : `\n═══ ${problema} problema ═══`);
process.exit(problema ? 1 : 0);
