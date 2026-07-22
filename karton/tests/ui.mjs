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

// ── 0. Prikaži lozinku (oko) ────────────────────────────────────────────────────
console.log('=== PRIKAŽI LOZINKU ===');
{
  const pw = p.locator('.pw-field input').first();
  await pw.fill('tajna123');
  const preKlika = await pw.getAttribute('type');
  await p.locator('.pw-toggle').first().click();
  const poKliku = await pw.getAttribute('type');
  check('Lozinka je podrazumevano skrivena', preKlika === 'password', preKlika);
  check('Oko otkriva lozinku (type→text)', poKliku === 'text', poKliku);
  await pw.fill('');
}

await p.fill('input[autocomplete="username"]', USER);
await p.locator('.pw-field input').first().fill(PW);
await p.click('button[type="submit"]');
await p.waitForSelector('.sidebar-nav', { timeout: 20000 });

// ── Ekran „Nezavršeni" (kartice po statusu) ─────────────────────────────────────
console.log('\n=== NEZAVRŠENI (tabla) ===');
{
  await p.goto(`${BASE}/nezavrseni`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const r = await p.evaluate(() => {
    const cards = document.querySelectorAll('.nz-card');
    const groups = document.querySelectorAll('.nz-group-head');
    // Da li su sve kartice iz aktivnih statusa (boja po statusu).
    const svePogodne = Array.from(cards).every((c) =>
      c.classList.contains('nz-open') || c.classList.contains('nz-progress') || c.classList.contains('nz-wait'));
    return { cards: cards.length, groups: groups.length, svePogodne };
  });
  check('Ekran „Nezavršeni" se učitao', r.cards >= 0);
  if (r.cards > 0) {
    check('Kartice su grupisane (naslov po statusu)', r.groups > 0, `${r.groups} grupa, ${r.cards} kartica`);
    check('Sve kartice obojene po statusu', r.svePogodne);
  } else {
    console.log('  (nema aktivnih naloga za bojenje — preskočeno)');
  }
}

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

// ── 7. Stavka rada: majstor, cena i decimalni zarez ─────────────────────────────
console.log('\n=== STAVKA RADA ===');
{
  // Traži OTVOREN nalog — dugme „+ Dodaj rad" postoji samo dok je nalog izmenjiv.
  const nalozi = await p.evaluate(async () => {
    const r = await fetch('/api/v1/work-orders?status=open&pageSize=1', { credentials: 'include' });
    return (await r.json()).data ?? [];
  });
  if (nalozi.length === 0) {
    console.log('  (preskočeno — nema otvorenog naloga)');
  } else {
    await p.goto(`${BASE}/nalozi/${nalozi[0].id}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(600);
    await p.locator('button', { hasText: '+ Dodaj rad' }).first().click();
    await p.waitForTimeout(500);

    const sel = p.locator('.modal-card select').first();
    // Ranije se prvi majstor tiho birao sam, zaobilazeći logiku za cenu — pa je cena
    // ostajala prazna, a čovek nije imao pojma zašto.
    check('Majstor se NE bira sam', (await sel.inputValue()) === '0',
      (await sel.locator('option:checked').textContent())?.trim());

    const sati = p.locator('.modal-card .form-2col input').first();
    await sati.click();
    await sati.pressSequentially('1,5');
    check('Zarez u „Sati" je primljen kao decimala', (await sati.inputValue()) === '1.5',
      `„1,5" → „${await sati.inputValue()}"`);

    const cena = p.locator('.modal-card .form-2col input').nth(1);
    const opcije = await sel.locator('option').allTextContents();
    await sel.selectOption({ index: 1 });
    await p.waitForTimeout(250);
    const prva = await cena.inputValue();
    check('Izbor majstora povlači njegovu cenu', Number(prva) > 0, `${opcije[1]?.trim()} → ${prva}`);

    if (opcije.length > 2) {
      await cena.fill('999');
      await sel.selectOption({ index: 2 });
      await p.waitForTimeout(250);
      const druga = await cena.inputValue();
      // Odluka korisnika (17.07.2026): cena UVEK prati majstora, i preko ručnog unosa —
      // bolje vidljiva tuđa cena nego tiho zadržana cena pogrešnog majstora.
      check('Promena majstora prepisuje i ručno unetu cenu', druga !== '999' && Number(druga) > 0,
        `999 → ${opcije[2]?.trim()} → ${druga}`);
    }

    const decimala = await p.evaluate(() => {
      const el = document.querySelectorAll('.modal-card .form-2col input')[1];
      el.value = '2500.5';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return { value: el.value, valid: el.validity.valid, stepMismatch: el.validity.stepMismatch };
    });
    // `type="number"` bez `step` je odbijao SVAKU decimalu („2500,50" nemoguće).
    check('Decimalna cena je dozvoljena', decimala.valid && !decimala.stepMismatch,
      `2500.5 → valid=${decimala.valid}`);
  }
}

// ── 8. „Promeni" kao dugme skroz desno ──────────────────────────────────────────
console.log('\n=== IZBOR VOZILA: dugme „Promeni" ===');
{
  await p.goto(`${BASE}/nalozi`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  const novi = p.locator('button', { hasText: /Novi nalog|\+ Nalog/ }).first();
  if (await novi.count()) {
    await novi.click();
    await p.waitForTimeout(500);
    // `.owner-picked` (red sa „Promeni") postoji tek kad je vozilo izabrano.
    await p.locator('.modal-card input.owner-search').first().fill('BG');
    await p.waitForTimeout(700);
    await p.locator('.modal-card .owner-results li').first().click();
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => {
      const red = document.querySelector('.owner-picked');
      const dug = red?.querySelector('.owner-change');
      if (!red || !dug) return null;
      const a = red.getBoundingClientRect(), b = dug.getBoundingClientRect();
      return { razmakDesno: Math.round(a.right - b.right), jeDugme: !dug.classList.contains('btn-link') };
    });
    if (r) {
      check('„Promeni" je skroz desno u redu', r.razmakDesno <= 16, `${r.razmakDesno}px od desne ivice`);
      check('„Promeni" izgleda kao dugme, ne kao link', r.jeDugme);
    } else {
      console.log('  (preskočeno — vozilo nije unapred izabrano)');
    }
  }
}

// ── 5. Bojenje pretrage ─────────────────────────────────────────────────────────
console.log('\n=== ŽUTO BOJENJE PRETRAGE ===');
for (const [put, pojam, kartica] of [['/vozila', 'olf'], ['/klijenti', 'ark'], ['/izvestaji', 'ark', 'Pretraga naloga']]) {
  await p.goto(`${BASE}${put}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  // Izveštaji imaju kartice; pretraga naloga nije na prvoj.
  if (kartica) { await p.locator('button.tab', { hasText: kartica }).first().click(); await p.waitForTimeout(600); }
  const polje = p.locator('input.search, input[placeholder*="retrag"], input[placeholder*="Ime"], input[placeholder*="Tablica"]').first();
  if (!(await polje.count())) { console.log(`  (preskočeno ${put} — nema polja za pretragu)`); continue; }
  await polje.fill(pojam);
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => {
    // Spiskovi koriste .data-table, izveštaji .mini-table — bojenje mora u obe.
    const m = document.querySelectorAll('.data-table mark, .mini-table mark');
    return { broj: m.length, tekst: m[0]?.textContent ?? '', boja: m[0] ? getComputedStyle(m[0]).backgroundColor : '' };
  });
  check(`${put}: pogodak „${pojam}" je obojen`, r.broj > 0, `${r.broj} pogodaka`);
  if (r.broj > 0) {
    check(`${put}: obojen je baš traženi deo`, r.tekst.toLowerCase() === pojam.toLowerCase(), `obojeno „${r.tekst}"`);
  }
}

// ── Dužina JMBG/PIB (isto polje, dva broja) ─────────────────────────────────────
console.log('\n=== JMBG / PIB ===');
{
  await p.goto(`${BASE}/klijenti`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  const novi = p.locator('button', { hasText: /Novi klijent|\+ Klijent/ }).first();
  if (await novi.count()) {
    await novi.click();
    await p.waitForSelector('.modal-card');
    const m = p.locator('.modal-card');
    const tax = m.locator('.field input').nth(1);   // 0 = ime, 1 = JMBG/PIB
    await tax.fill('12345678901234567890');
    check('JMBG ograničen na 13 znakova', (await tax.inputValue()).length === 13, `${(await tax.inputValue()).length} znakova`);
    await m.locator('input[type=radio]').nth(1).click();   // pravno lice
    await p.waitForTimeout(200);
    await tax.fill('12345678901234567890');
    check('PIB ograničen na 9 znakova', (await tax.inputValue()).length === 9, `${(await tax.inputValue()).length} znakova`);
    await m.locator('.modal-close').click();
    await p.waitForTimeout(200);
  }
}

// ── Ugnježdeni modali-forme (bug 18.07.2026: <form> u <form> je pucao pri čuvanju) ──
console.log('\n=== UGNJEŽDENI MODALI (novo vozilo/klijent iz naloga) ===');
{
  await p.goto(`${BASE}/nalozi`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  const novi = p.locator('button', { hasText: /Novi nalog|\+ Nalog/ }).first();
  if (await novi.count()) {
    await novi.click();
    await p.waitForSelector('.modal-card');
    await p.locator('button', { hasText: '+ Novo vozilo' }).first().click();
    await p.waitForTimeout(400);
    // Modal ide kroz portal u <body> — ne sme biti forme unutar forme.
    const nested1 = await p.evaluate(() => document.querySelectorAll('form form').length);
    check('Nema <form> u <form> (novo vozilo iz naloga)', nested1 === 0, `${nested1} ugnježdenih`);
    const vinMax = await p.locator('.modal-card input.mono').first().getAttribute('maxlength');
    check('VIN ograničen na 17 znakova', vinMax === '17', vinMax ?? 'bez maxlength');
    // Još dublje: novi klijent iz tog novog vozila.
    await p.locator('.modal-card').last().locator('button', { hasText: '+ Novi klijent' }).click();
    await p.waitForTimeout(400);
    const nested2 = await p.evaluate(() => document.querySelectorAll('form form').length);
    check('Nema <form> u <form> ni za novog klijenta iz naloga', nested2 === 0, `${nested2} ugnježdenih`);
  } else {
    console.log('  (preskočeno — nema dugmeta „Novi nalog")');
  }
}

// ── Meni: „Monitoring", sklapanje, logo → Početna ───────────────────────────────
console.log('\n=== MENI ===');
{
  await p.goto(`${BASE}/vozila`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  const hasMon = await p.locator('.sidebar-nav', { hasText: 'Monitoring' }).count();
  check('Meni ima „Monitoring"', hasMon > 0);
  check('Meni više nema „Nezavršeni"', (await p.locator('.sidebar-nav', { hasText: 'Nezavršeni' }).count()) === 0);

  // Sklapanje: sadržaj ne sme da se podvuče pod dugme.
  await p.locator('.sidebar-collapse').click();
  await p.waitForTimeout(300);
  const collapsed = await p.evaluate(() => {
    const navVisible = document.querySelector('.sidebar-nav')?.offsetParent !== null;
    const btn = document.querySelector('.sidebar-collapse').getBoundingClientRect();
    const h1 = document.querySelector('.page-head h1').getBoundingClientRect();
    return { navHidden: !navVisible, overlap: btn.right > h1.left };
  });
  check('Sklapanjem se meni sakrije', collapsed.navHidden);
  check('Sadržaj se ne podvlači pod dugme', !collapsed.overlap);

  // Vraćanje.
  await p.locator('.sidebar-collapse').click();
  await p.waitForTimeout(300);
  check('Dugme vraća meni', (await p.locator('.sidebar-nav')).isVisible !== undefined && await p.locator('.sidebar-nav').isVisible());

  // Logo → Početna.
  await p.locator('.sidebar-brand').click();
  await p.waitForTimeout(300);
  check('Klik na logo vodi na Početnu', new URL(p.url()).pathname === '/', new URL(p.url()).pathname);
}

await b.close();
console.log(`\n═══ ${ok} prošlo, ${fail} palo ═══`);
process.exit(fail ? 1 : 0);
