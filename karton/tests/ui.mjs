/**
 * Regresije u pregledaču — stvari koje se ne vide iz koda, nego tek kad se izmeri.
 *
 * Svaka provera ovde postoji zbog konkretnog bug-a prijavljenog 16–17.07.2026:
 *
 *  1. ŠTAMPA NA A4     — `.app-shell` je grid „232px 1fr" (meni | sadržaj). Za štampu se
 *                        meni krije sa `display:none`, pa je sadržaj upadao u kolonu od
 *                        232px: račun je izlazio iz štampača kao uska traka niz levu ivicu.
 *  2. STATUS NA PAPIRU — „VAŽI"/„Neplaćeno" je stanje u aplikaciji, ne podatak za mušteriju.
 *  3. PROZOR TERMINA   — „Izmeni" je otvarao formu, ali je prozor sa detaljima ostajao
 *                        iscrtan PREKO nje (poslednji u DOM-u), pa je dugme delovalo mrtvo.
 *  4. .warn-box        — `display:flex; flex-direction:column` je svaki inline deo rečenice
 *                        („celu", <strong>bazu</strong>, „(klijenti…)") pretvarao u zaseban red.
 *  5. BOJENJE PRETRAGE — pogodak mora da bude obojen, i to baš onaj deo koji je pogođen.
 *  6. SRPSKE PORUKE    — browser ispisuje „Please fill out this field" na svom jeziku.
 *
 * Pokretanje (traži pokrenut stack i Playwright):
 *   APP_USER=admin APP_PW=admin node tests/ui.mjs http://localhost:5173
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
const USER = process.env.APP_USER || 'admin';
const PW = process.env.APP_PW || 'admin';

let ok = 0, fail = 0;
const check = (label, cond, detail = '') => {
  console.log(`  [${cond ? 'OK  ' : 'FAIL'}] ${label}${detail ? `  → ${detail}` : ''}`);
  cond ? ok++ : fail++;
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();

await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await p.fill('input[autocomplete="username"]', USER);
await p.fill('input[type="password"]', PW);
await p.click('button[type="submit"]');
await p.waitForSelector('.sidebar-nav', { timeout: 20000 });

// ── 1 + 2. Papir dokumenta: širina u štampi i status ────────────────────────────
console.log('\n=== ŠTAMPA DOKUMENTA ===');
await p.goto(`${BASE}/dokumenti`, { waitUntil: 'networkidle' });
await p.waitForTimeout(500);
await p.locator('.data-table tbody tr').first().click();
await p.waitForSelector('.doc-paper', { timeout: 15000 });

const naEkranu = await p.evaluate(() => Math.round(document.querySelector('.doc-paper').getBoundingClientRect().width));
await p.emulateMedia({ media: 'print' });
await p.waitForTimeout(200);
const uStampi = await p.evaluate(() => {
  const el = document.querySelector('.doc-paper');
  const head = document.querySelector('.page-head');
  return {
    papir: Math.round(el.getBoundingClientRect().width),
    telo: Math.round(document.body.getBoundingClientRect().width),
    zaglavljeEkrana: head ? getComputedStyle(head).display : 'nema',
    statusNaPapiru: document.querySelectorAll('.doc-paper .badge').length,
    // `getClientRects()` je prazan za sve što je stvarno skriveno (i preko roditelja),
    // za razliku od `getComputedStyle(el).display`, koji gleda samo sam element.
    statusVidljiv: Array.from(document.querySelectorAll('.badge'))
      .filter((x) => x.getClientRects().length > 0).map((x) => x.textContent.trim()),
  };
});

// Prag: papir mora da zauzme bar 85% širine strane. Bug je davao 232px na 1280 (18%).
const dovoljno = uStampi.papir >= uStampi.telo * 0.85;
check('Papir u štampi popunjava stranu', dovoljno, `${uStampi.papir}px od ${uStampi.telo}px (ekran: ${naEkranu}px)`);
check('Papir u štampi nije stisnut na širinu menija', uStampi.papir > 400, `${uStampi.papir}px`);
check('Zaglavlje ekrana se ne štampa', uStampi.zaglavljeEkrana === 'none', uStampi.zaglavljeEkrana);
check('Status nije ugrađen u papir', uStampi.statusNaPapiru === 0, `${uStampi.statusNaPapiru} oznaka u .doc-paper`);
check('Nijedan status se ne vidi u štampi', uStampi.statusVidljiv.length === 0, uStampi.statusVidljiv.join(', ') || 'nema nijednog');

const sadrzaj = await p.evaluate(() => ({
  naslov: document.querySelector('.doc-kind')?.textContent?.trim() ?? '',
  naslovPx: Math.round(parseFloat(getComputedStyle(document.querySelector('.doc-kind')).fontSize)),
  brojPx: Math.round(parseFloat(getComputedStyle(document.querySelector('.doc-no')).fontSize)),
  poravnanje: getComputedStyle(document.querySelector('.doc-ident')).textAlign,
  podnozje: document.querySelector('.doc-foot')?.textContent ?? '',
}));
check('Naslov je veći od broja dokumenta', sadrzaj.naslovPx > sadrzaj.brojPx, `${sadrzaj.naslov} ${sadrzaj.naslovPx}px vs broj ${sadrzaj.brojPx}px`);
check('Naslov je centriran', sadrzaj.poravnanje === 'center', sadrzaj.poravnanje);
check('Podnožje nosi poresku napomenu', /PDV/i.test(sadrzaj.podnozje));
check('Podnožje: „punovažan bez pečata"', /bez pečata/i.test(sadrzaj.podnozje));
await p.emulateMedia({ media: 'screen' });

// ── 3. Prozor termina ───────────────────────────────────────────────────────────
console.log('\n=== KALENDAR: „Izmeni" ===');
await p.goto(`${BASE}/kalendar`, { waitUntil: 'networkidle' });
await p.waitForTimeout(600);
const termin = p.locator('.cal-appt, .appt, [class*="appt"]').first();
if (await termin.count()) {
  await termin.click();
  await p.waitForSelector('.modal-card', { timeout: 5000 }).catch(() => {});
  const izmeni = p.locator('button', { hasText: /^Izmeni$/ }).first();
  if (await izmeni.count()) {
    await izmeni.click();
    await p.waitForTimeout(400);
    const st = await p.evaluate(() => {
      const naslovi = Array.from(document.querySelectorAll('.modal-card .modal-head'))
        .map((x) => x.textContent.trim());
      return { brojProzora: document.querySelectorAll('.modal-card').length, naslovi };
    });
    check('Otvoren je TAČNO jedan prozor', st.brojProzora === 1, `${st.brojProzora}: ${st.naslovi.join(' | ')}`);
    check('Vidi se forma za izmenu, ne detalj', st.naslovi.some((t) => /Izmena termina/i.test(t)), st.naslovi.join(' | '));
    const polje = await p.locator('form .field').count();
    check('Forma je stvarno upotrebljiva (ima polja)', polje > 0, `${polje} polja`);
  } else {
    check('Dugme „Izmeni" postoji', false, 'nije nađeno — ima li zakazanih termina?');
  }
} else {
  console.log('  (preskočeno — nema termina u kalendaru)');
}

// ── 4. .warn-box ────────────────────────────────────────────────────────────────
console.log('\n=== PODEŠAVANJA: okvir sa napomenom ===');
await p.goto(`${BASE}/podesavanja`, { waitUntil: 'networkidle' });
await p.waitForTimeout(400);
const bkp = p.locator('button', { hasText: /^Backup$/ }).first();
if (await bkp.count()) {
  await bkp.click();
  await p.waitForTimeout(500);
  const wb = await p.evaluate(() => {
    const el = document.querySelector('.warn-box');
    if (!el) return null;
    const s = getComputedStyle(el);
    // Broj vizuelnih redova: koliko različitih `top` vrednosti imaju delovi rečenice.
    const vrhovi = new Set(Array.from(el.querySelectorAll('strong, code'))
      .map((x) => Math.round(x.getBoundingClientRect().top)));
    return { display: s.display, redova: vrhovi.size, delova: el.querySelectorAll('strong, code').length };
  });
  if (wb) {
    check('.warn-box nije flex-stubac', wb.display !== 'flex', wb.display);
    // Bug: svaki <strong>/<code> je bio u svom redu → redova === delova.
    check('Rečenica nije razlomljena na stubac', wb.redova < wb.delova, `${wb.delova} delova u ${wb.redova} reda`);
  } else {
    check('.warn-box postoji', false);
  }
}

// ── 6. Srpske poruke validacije ─────────────────────────────────────────────────
console.log('\n=== SRPSKE PORUKE ===');
await p.goto(`${BASE}/klijenti`, { waitUntil: 'networkidle' });
await p.waitForTimeout(400);
const novi = p.locator('button', { hasText: /Novi klijent|\+ Klijent|Dodaj/ }).first();
if (await novi.count()) {
  await novi.click();
  await p.waitForTimeout(400);
  const poruka = await p.evaluate(() => {
    const f = document.querySelector('.modal-card form');
    if (!f) return null;
    const polje = f.querySelector('input[required], select[required], textarea[required]');
    if (!polje) return 'NEMA_REQUIRED';
    polje.value = '';
    f.reportValidity();               // isto što browser radi na „Sačuvaj"
    return polje.validationMessage;
  });
  if (poruka && poruka !== 'NEMA_REQUIRED') {
    check('Poruka o obaveznom polju je na srpskom', /Obavezno polje|Izaberite/i.test(poruka), `„${poruka}"`);
    check('Poruka nije na engleskom', !/Please|fill out|field/i.test(poruka), `„${poruka}"`);
  } else {
    console.log(`  (preskočeno — ${poruka})`);
  }
}

// ── 5. Bojenje pretrage ─────────────────────────────────────────────────────────
console.log('\n=== ŽUTO BOJENJE PRETRAGE ===');
for (const [put, pojam] of [['/vozila', 'olf'], ['/klijenti', 'ark']]) {
  await p.goto(`${BASE}${put}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  const polje = p.locator('input.search, input[placeholder*="retrag"], input[placeholder*="Ime"], input[placeholder*="Tablica"]').first();
  if (!(await polje.count())) { console.log(`  (preskočeno ${put} — nema polja za pretragu)`); continue; }
  await polje.fill(pojam);
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => {
    const m = document.querySelectorAll('.data-table mark');
    return { broj: m.length, tekst: m[0]?.textContent ?? '', boja: m[0] ? getComputedStyle(m[0]).backgroundColor : '' };
  });
  check(`${put}: pogodak „${pojam}" je obojen`, r.broj > 0, `${r.broj} pogodaka`);
  if (r.broj > 0) {
    check(`${put}: obojen je baš traženi deo`, r.tekst.toLowerCase() === pojam.toLowerCase(), `obojeno „${r.tekst}"`);
  }
}

await b.close();
console.log(`\n═══ ${ok} prošlo, ${fail} palo ═══`);
process.exit(fail ? 1 : 0);
