/**
 * Da li se aplikacija sama osveži kad na server stigne nova verzija.
 *
 * Regresija (17.07.2026): posle deploya je korisnik i dalje gledao STARU verziju i prijavio
 * da izmene „ne rade" — iako su bile na serveru. Uzrok: service worker servira svoju keširanu
 * kopiju, a ubačeni `registerSW.js` je samo registrovao SW i nikad nije osvežio stranu.
 *
 * ZAŠTO OVAJ TEST POSTOJI ODVOJENO: obični testovi (`ui.mjs`, `responsive.mjs`) kreću iz
 * PRAZNOG pregledača — bez service workera i bez keša — pa uvek dobiju novu verziju i uvek
 * prođu. Fizički ne mogu da vide ovaj kvar. Zato ovaj test namerno:
 *   1. napravi dva različita builda (v1 i v2),
 *   2. servira v1 i sačeka da service worker preuzme kontrolu,
 *   3. podmetne v2 pod isti server,
 *   4. jednom osveži i proveri da li je aplikacija STVARNO prešla na v2.
 *
 * Bez ispravke u `lib/swRefresh.ts` ovaj test pada: naslov ostaje v1.
 *
 * Pokretanje (ne traži pokrenut stack — sam diže statički server):
 *   node tests/sw-update.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const KOREN = resolve(import.meta.dirname, '..');
const DIST = join(KOREN, 'apps/web/dist');
const INDEX_SRC = join(KOREN, 'apps/web/index.html');
const RAD = join(tmpdir(), 'karton-sw-test');
const V1 = join(RAD, 'v1'), V2 = join(RAD, 'v2'), SERVIRA = join(RAD, 'current');

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json' };

let ok = 0, fail = 0;
const check = (label, cond, detail = '') => {
  console.log(`  [${cond ? 'OK  ' : 'FAIL'}] ${label}${detail ? `  → ${detail}` : ''}`);
  cond ? ok++ : fail++;
};

const original = readFileSync(INDEX_SRC, 'utf8');
rmSync(RAD, { recursive: true, force: true });

function build(naslov) {
  writeFileSync(INDEX_SRC, original.replace(/<title>[^<]*<\/title>/, `<title>${naslov}</title>`), 'utf8');
  execSync('pnpm --filter @karton/web build', { cwd: KOREN, stdio: 'pipe' });
}

try {
  console.log('=== pravim dva builda (traje ~15s) ===');
  build('VERZIJA-1');
  cpSync(DIST, V1, { recursive: true });
  build('VERZIJA-2');
  cpSync(DIST, V2, { recursive: true });
} finally {
  writeFileSync(INDEX_SRC, original, 'utf8');   // izvorni index.html se NE sme ostaviti izmenjen
}

// Provera da su buildovi zaista različiti — inače test ništa ne dokazuje.
const sw1 = readFileSync(join(V1, 'sw.js'), 'utf8');
const sw2 = readFileSync(join(V2, 'sw.js'), 'utf8');
check('Dva builda se stvarno razlikuju (sw.js)', sw1 !== sw2);

cpSync(V1, SERVIRA, { recursive: true });

const server = createServer((req, res) => {
  const put = decodeURIComponent((req.url || '/').split('?')[0]);
  let fajl = join(SERVIRA, put === '/' ? 'index.html' : put);
  if (!existsSync(fajl)) fajl = join(SERVIRA, 'index.html');       // SPA
  try {
    const telo = readFileSync(fajl);
    res.writeHead(200, {
      'Content-Type': MIME[extname(fajl)] ?? 'application/octet-stream',
      // Ista pravila kao Caddy na produkciji — inače test ne meri isto što i stvarnost.
      'Cache-Control': put.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(telo);
  } catch { res.writeHead(500); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
console.log(`=== server: ${BASE} ===`);

const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();

// 1. Prvo otvaranje: instalira se service worker za v1.
await p.goto(BASE, { waitUntil: 'networkidle' });
await p.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })
  .catch(() => {});
const kontrolise = await p.evaluate(() => navigator.serviceWorker.controller !== null);
check('Service worker je preuzeo kontrolu nad stranom', kontrolise);
check('Prikazana je v1', (await p.title()) === 'VERZIJA-1', await p.title());

// 2. Deploy: pod isti server ide v2.
rmSync(SERVIRA, { recursive: true, force: true });
cpSync(V2, SERVIRA, { recursive: true });
console.log('=== podmetnut v2 (kao deploy) ===');

// 3. Jedno osvežavanje — kao kad korisnik otvori aplikaciju posle deploya.
await p.reload({ waitUntil: 'networkidle' });

// Aplikacija sama treba da se osveži kad novi SW preuzme kontrolu.
let presla = false;
try {
  await p.waitForFunction(() => document.title === 'VERZIJA-2', null, { timeout: 15000 });
  presla = true;
} catch { /* ostalo na v1 */ }

check('Posle JEDNOG osvežavanja aplikacija je na v2', presla, `naslov: ${await p.title()}`);

await b.close();
server.close();
rmSync(RAD, { recursive: true, force: true });

console.log(`\n═══ ${ok} prošlo, ${fail} palo ═══`);
process.exit(fail ? 1 : 0);
