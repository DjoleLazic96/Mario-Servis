# Tehnička preporuka — „Karton" (vođenje auto servisa)

**Verzija 1.0 · 8.7.2026.**

Zasnovano na specifikaciji v3 sa dopunama (sekcija 7 u .docx) i odlukama usvojenim 7–8.7.2026. Dokument ne otvara ponovo presečene dileme — pretače ih u konkretan tehnički plan za izvođača. Prateći fajlovi: `specifikacija-aplikacije-v3.docx`, `er-dijagram.mermaid`, `servis-mockup ver.3.html`.

> **Ažurirano 8.7.2026 (v1.1):** funkcionalno merodavna je `specifikacija-finalna.md` (v4). Ključne izmene u odnosu na tekst ispod: broj naloga je `RN-` (ne `N-`); nazivi u kodu, bazi i API-ju su **engleski**, UI srpski (odluka 27) — API nacrt iz tačke 4 zamenjen je punom specifikacijom u `openapi.yaml`; šema baze je u `baza-shema.sql`; tabela brojača se zove `number_sequence`; audit log ulazi u v1.

## 0. Rešena kolizija (tačka 16 odluka)

„Interno — ne naplaćuje se": stavka ostaje evidentirana na radnom nalogu, na dokument za klijenta se **ne prenosi** i ne ulazi u iznos. Oznaka se vodi na stavkama naloga (`stavka_dela.interno_ne_naplacuje_se`, `stavka_eksterni.interno_ne_naplacuje_se`); polje na `dokument_stavka` je uklonjeno iz modela. Štampa radnog naloga je interni dokument i prikazuje ove stavke sa oznakom „interno" — ako se nalog ikada štampa za klijenta, dodati opciju štampe bez internih stavki.

## 1. Stack (rezime)

| Sloj | Izbor | Napomena |
|---|---|---|
| Hosting | VPS (2 vCPU / 4 GB RAM je dovoljno) | Ubuntu LTS; Docker Compose ili systemd servisi |
| HTTPS | Caddy (ili nginx + certbot) | automatski Let's Encrypt sertifikati |
| Frontend | **React 19 + TypeScript** (potvrđeno 9.7.2026) | Vite build; **PWA** — manifest + service worker, instalacija na telefon bez prodavnica, automatska ažuriranja |
| Backend | **Node.js 24 LTS + TypeScript + Fastify 5** (potvrđeno 9.7.2026) | modularni monolit; alternative (NestJS/Laravel/.NET) više nisu u igri |
| ORM / migracije | Prisma (ili Drizzle) | verzionisane migracije od prvog dana |
| Baza | **PostgreSQL 18** (potvrđeno 9.7.2026) | jedina baza za sve, uključujući queue (odluka 5) |
| Poslovi / queue | pg-boss | queue u samom Postgresu: retry, backoff, cron — bez dodatne infrastrukture |
| Email | nodemailer → SMTP | SMTP parametri iz Podešavanja |
| Struktura | monorepo (pnpm workspaces) | `apps/web`, `apps/api`, `apps/worker`, `packages/shared` |

`packages/shared` nosi statuse, tipove i validacione šeme (npr. Zod) koje front koristi za UX — ali backend **uvek validira samostalno**; deljeni kod je pomoć, ne izvor istine (odluka 4).

## 2. Arhitektura — modularni monolit (odluka 2)

- Dva procesa iz istog codebase-a: **api** (HTTP + serviranje SPA statike) i **worker** (scheduler + queue). Ista baza, isti domenski moduli.
- Domenski moduli: auth, klijenti, vozila, majstori, termini, nalozi, dokumenti, podsetnici, izveštaji, podešavanja, backup.
- SPA se služi sa istog domena (`/api/*` prefiks) — bez CORS-a u produkciji.
- Poslovna pravila žive u domenskim servisima koje dele api i worker — nikad u kontrolerima, nikad samo na frontu.

## 3. Baza, transakcije, konkurentnost (odluke 5–6)

- **Numeracija**: tabela `number_sequence(doc_type, year, last_number)`; dodela broja u istoj transakciji kao INSERT naloga/dokumenta, uz `SELECT … FOR UPDATE`. UNIQUE indeks na broju kao dodatna zaštita. Bez `MAX(broj)+1`. Sekvence po tipu (P/RN/PR/R), reset 1. januara.
- **Optimističko zaključavanje**: kolona `version` na `work_order`, `document`, `appointment`, `settings`; `UPDATE … WHERE id=? AND version=?`; neuspeh → HTTP 409, front nudi osvežavanje podataka. Ovo zamenjuje „poslednji upis pobeđuje" iz speca 6.2 za kritične operacije.
- **Statusne tranzicije kao mašina stanja**: dozvoljeni prelazi po centralnom spisku statusa; provera i izmena u istoj transakciji.
- **Snapshot dokumenta** nastaje u istoj transakciji u kojoj se dodeljuje broj; interne stavke se preskaču. Veza `source_document_id` + `source_relation_type` upisuje se na novonastali dokument i pokazuje unazad na izvor (copy/convert/correct — nikad obrnuto).
- **Ograničenja u bazi**: UNIQUE VIN; parcijalni UNIQUE — jedan aktivan vlasnik i jedna aktivna tablica po vozilu (`datum_do IS NULL`); FK svuda; CHECK ili lookup za statuse.
- **Zajedničke kolone**: `created_at`, `updated_at`, `kreirao_korisnik_id` na svim tabelama.
- Ništa se ne briše fizički (osim neisteklih termina) — arhiviranje statusom.

## 4. API

Puna specifikacija: **`openapi.yaml`** (engleski nazivi, odluka 27). Konvencije: REST/JSON pod `/api/v1`; paginacija `?page&pageSize` (default iz podešavanja, 20); sortiranje `?sort=field:asc`; pretraga `?q` (case-insensitive, ignoriše razmake) — sve server-side, nad celim skupom podataka. Model greške i katalog kodova: `specifikacija-finalna.md` §8; tabela tranzicija §6; mapa ekrana → endpointi §9.

Backend samostalno sprovodi (odluka 4): lanac Ponuda → Nalog → Predračun → Račun (ponuda→nalozi je 1:N), editabilnost po statusu, ispravku računa, numeraciju, snapshot, duplikate (VIN, PIB/JMBG), zauzetost majstora (preklapanje termina po trajanju + nedostupnosti), radno vreme, obračun prihoda isključivo iz plaćenih računa po datumu plaćanja, role i audit log.

## 5. Worker: scheduler i queue (odluke 7–8)

| Posao | Ritam | Šta radi |
|---|---|---|
| Istek dokumenata | dnevno 00:05 | ponuda → `istekla`; predračun → `istekao` (transakciono) |
| Podsetnici — upis | pri kreiranju/izmeni termina | generisanje `termin_podsetnik` zapisa sa planiranim vremenom (globalno podešavanje, default 09:00 dan pre) |
| Podsetnici — slanje | na 1–5 min | dospeli u statusu `zakazano` → `obrada` (`FOR UPDATE SKIP LOCKED`) → slanje → `poslato` / `greska`; `broj_pokusaja++`, `poslednja_greska`; retry sa rastućim razmakom (npr. 5 → 15 → 60 min, max 5 pokušaja) |
| Backup | dnevno | `pg_dump` lokalno + upload na cloud storage (S3-kompatibilan / rclone); retencija 30 dana |

Uslovi slanja se proveravaju **u trenutku slanja**: termin i dalje u statusu `zakazano` i klijent ima email. „Vrati iz backupa" — samo admin, uz eksplicitnu potvrdu; periodično test-vraćanje (v. tačku 9.3).

## 6. Bezbednost (odluke 12–13)

- Cookie sesije (HttpOnly, Secure, SameSite=Lax), trajanje 30 dana klizno (aktivnost produžava — bitno da QR skeniranje sa štampe po pravilu otvara nalog bez login koraka); login podržava `?redirect=` na internu putanju (open redirect zabranjen). Session store u Postgresu — infrastrukturna `session` tabela je u `baza-shema.sql` (kompatibilna sa connect-pg-simple; ako je biblioteka sama kreira, DDL se preskače). CSRF: `XSRF-TOKEN` cookie + obavezan `X-CSRF-Token` header na svakom non-GET zahtevu (403 `CSRF_FAILED`) — ugovor definisan u `openapi.yaml`. Bez JWT.
- Lozinke argon2id; rate-limit na prijavu; admin kreira korisnike i resetuje lozinke (bez samoregistracije, bez email reseta u v1).
- Role: `admin` (sve + Podešavanja + korisnici), `korisnik` (sve ostalo) — provera na backendu po ruti.
- HTTPS obavezan; backup fajlovi na privatnom bucket-u.
- Čitač saobraćajne (v1 — vidi §8.1): helper aplikacija sluša isključivo na `127.0.0.1`, prihvata samo Origin aplikacije, uparivanje kratkotrajnim tokenom; nikada otvoren endpoint dostupan proizvoljnim sajtovima. Osnova: Baš Čelik / JEvrc (PC/SC).

## 7. Dokumenti: prikaz, štampa, izvoz (odluke 9–10)

- **v1**: HTML prikaz dokumenta + A4 `@media print` CSS + browser štampa / „Save as PDF". Tri rubrike (Rad zbirno po tipu / Delovi / Eksterni servis), prazne se ne prikazuju; EUR informativno gde je unet.
- Štampa radnog naloga = prijemni list, jedina standardna štampa: podaci iz aplikacije + ručni upis radova (majstor), skica oštećenja, kontrola vozila (sa nivoom goriva) i dva potpisa klijenta (predaja i povrat); u zaglavlju QR kod sa URL-om naloga (biblioteka tipa `qrcode`). Rukom popunjeni delovi se ne unose u softver u v1; prazne tabele stavki se ne štampaju. Unos stavki: papirna staza (kancelarija prekucava) ili direktno telefon/tablet — ravnopravno; QR sa štampe vodi pravo na nalog.
- **v1**: Excel izvoz (`.xlsx`, exceljs): izveštaji + pun izvoz cele baze **jednim dugmetom** na ekranu Izveštaji — jedan fajl, sheetovi: nalozi / ponude / predračuni / računi + stavke (spec §4.18; `GET /export/all.xlsx`).
- **Faza 2**: server-side PDF — renderovanje **istog** HTML-a kroz headless Chromium (Playwright) daje identičan izgled bez dupliranja šablona; automatsko slanje PDF-a emailom; Word izvoz ako se pokaže konkretna potreba.

## 8. Obim: v1 (MVP) i faza 2

**v1:** svih 13 ekrana; login + role; ceo lanac dokumenata sa svim pravilima i 1:N ponuda→nalozi; snapshot; transakciona numeracija; kalendar sa trajanjem termina, zauzetošću majstora i blokadama dana; email podsetnici sa retry mehanizmom; automatski isteci ponuda/predračuna; backup + vraćanje; 4 izveštaja + Excel; A4 štampa; server-side filtriranje/sortiranje/pretraga/paginacija; arhiviranje umesto brisanja; ručni unos vozila; izlazak na teren na nalogu; cenovnik usluga (paušal / po km) i tri načina obračuna stavke rada; mobilni prikaz (tabele → kartice); PWA (instalacija na telefon bez prodavnica); čitač saobraćajne (§8.1).

### 8.1 Čitač saobraćajne (v1, odluka 9.7.2026)
Premešten iz faze 2 u v1. Zaseban mini-projekat, nezavisan od hostinga (živi na računaru servisa i kad je glavna aplikacija na VPS-u).
- **Stack:** Java helper koji preuzima proverenu logiku čitanja srpske saobraćajne iz **Baš Čelik / JEvrc** (AGPL — helper je zato open-source). Ugrađeni `HttpServer` na `127.0.0.1` (bez frameworka); pakovanje kroz `jpackage` u Windows instaler sa ugrađenim runtime-om (nije potreban zaseban JRE).
- **Bezbednost:** sluša samo na `127.0.0.1`; prihvata isključivo Origin glavne aplikacije (u produkciji VPS domen); uparivanje kratkotrajnim tokenom; nikada otvoren endpoint dostupan proizvoljnim sajtovima.
- **Tok:** dugme „Učitaj saobraćajnu" u formi vozila → poziv lokalnog servisa → JSON (VIN, marka, model, godina, gorivo, tablica, vlasnik) → popuni formu, uz proveru duplikata VIN. Ako servis nije pokrenut, dugme objasni i forma radi ručno.
- **Verifikacija:** mogu da izgradim i proverim sve osim samog čitanja čipa (servis se diže, bezbednosni handshake, JSON ugovor, integracija u formu, fallback). Stvarno čitanje kartice testira se sa fizičkim čitačem + karticom na strani servisa.

**Faza 2:** server-side PDF + slanje dokumenata emailom; Word izvoz; istorija izmena (kolone `kreirao_korisnik_id`/`updated_at` postoje od v1 — UI kasnije); fotografije na nalogu; upozorenje na dashboardu za ponude koje ističu; SMS podsetnici.

## 9. Rizici i napomene

1. **Isporuka emailova sa VPS-a**: slanje direktno sa VPS IP adrese često završava u spamu. Preporuka: SMTP relay (mail nalog servisa kod postojećeg provajdera ili servis tipa SES/Brevo) + SPF/DKIM zapisi na domenu. SMTP polja u Podešavanjima to već podržavaju.
2. **Štampa naloga i interne stavke**: nalog je interni dokument; ako se štampa za klijenta, dodati opciju „bez internih stavki" (v. tačku 0).
3. **Backup vredi koliko i poslednje uspešno test-vraćanje** — spec već traži periodični test; predlog: mesečna rutina.

## 10. Razvoj lokalno → produkcija (odluka 9.7.2026)

Razvoj ide **prvo lokalno**, deploy na VPS kasnije. Prelazak je jednostavan samo ako se od prvog dana poštuje sledeće.

**Lokalno okruženje:** Node 24 · PostgreSQL 18 kroz Docker (ista verzija kao na serveru) · **Mailpit** kao lažni SMTP — podsetnici se hvataju u lokalno sanduče, bez pravog mejl naloga.

**Pet pravila (bez njih deploy boli):**
1. Sve što se razlikuje između lokalnog i servera ide u **env promenljive** (baza, SMTP, `APP_BASE_URL`, tajna sesije) — nikad u kod.
2. **Nikad hardkodovan `localhost`**, posebno u QR kodu naloga: URL dolazi iz `APP_BASE_URL`, inače odštampani nalozi vode u prazno posle prelaska na domen.
3. Kolačić `Secure` se uključuje **samo u produkciji** (ne radi na `http://localhost`).
4. Baza se pravi **isključivo migracijama** od prvog dana — produkciona se podiže istim skriptama.
5. Proces radi u **UTC**, poslovna logika u Europe/Belgrade — lokalna zona računara ne sme da uđe u podatke.

**Ograničenje lokalnog rada:** QR i PWA su namenjeni telefonu, a telefon ne vidi `localhost`; preko LAN-a nema HTTPS-a pa PWA instalacija i service worker ne rade. Do domena se telefon testira simulacijom u browseru; pravi test („skeniram QR → otvara se nalog", ikonica na početnom ekranu) tek na VPS-u.

**Trenutak prelaska:** kad prorade nalozi i dokumenti. Izveštaji, podešavanja i backup dovršavaju se već na živom sistemu.

**Deploy (≈ pola dana, uglavnom čekanje DNS-a):** VPS + Docker → `.env` sa pravim vrednostima → DNS zapis → Caddy (automatski HTTPS) → migracije → prvi admin korisnik → cron za backup → SMTP relay + SPF/DKIM (v. rizik 9.1).

## 11. Sledeći koraci

1. Izbor izvođača → potvrda React/Vue i Node/alternative (odluke 3–4).
2. OpenAPI specifikacija + katalog grešaka — **urađeno** (`openapi.yaml`, `specifikacija-finalna.md` §8).
3. Migracije baze po `baza-shema.sql` (finalizovana 8.7.2026).
4. Mockup se **ne dorađuje** (odluka 8.7.2026) — služi kao dizajn osnova. Umesto toga, checklist za implementaciju UI-ja:
   - Ekrani i forme koje mockup ne pokriva: login, izveštaj „Po tipu vozila", blokiranje dana, brisanje termina, dodaj/zameni telefon/email, potvrda „Vrati iz backupa".
   - Usklađivanje sa odlukama: polje „Trajanje" u formi termina; dugme „Nalozi (N)" na ekranu ponude (1:N); oznaka „interno" na stavkama naloga + opcija štampe naloga bez internih stavki; SMTP polja i logo u Podešavanjima; status korisnika u upravljanju korisnicima; ukloniti „Izvezi Word" dugmad (faza 2); Excel izvoz samo na izveštajima.
   - Tehničko: self-hostovati fontove (mockup ih vuče sa Google Fonts); proveriti/dizajnirati mobilne kartične prikaze tabela (spec: kritičan zahtev); zadržati A4 print CSS pristup.
5. Predlog redosleda isporuke: skeleton (auth, layout, klijenti/vozila) → nalozi + dokumenti → kalendar + podsetnici → izveštaji + podešavanja + backup.
