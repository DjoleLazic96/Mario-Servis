# Karton — Primopredaja V1

Datum: 2026-07-10 · Grana: `main` · Repo: https://github.com/DjoleLazic96/Mario-Servis

Ovaj dokument je pripremljen za acceptance test i primopredaju V1. Sve tvrdnje su
proverene uživo protiv pokrenute aplikacije (vidi „Acceptance rezultati").

---

## 1–11. Pristup, pokretanje, komande

**1. Pristup aplikaciji (lokalno).** Web: `http://localhost:5173`. API: `http://localhost:5173/api/v1` (kroz Vite proxy) ili direktno `http://localhost:3000`. Najlakše pokretanje: dupli klik na `pokreni.bat` u korenu (diže sve i otvori browser).

**2. Nalozi za proveru rola.**
- Admin (seed): `admin` / `admin` — **samo za test, ugasiti pre produkcije** (vidi t. 15).
- Običan korisnik: ne postoji u seed-u. Napravi ga kao admin: **Podešavanja → Korisnici → Novi korisnik**, rola „korisnik". (Acceptance test ga sam kreira radi provere rola.)

**3. Lokalno pokretanje od nule** (Node 24+, pnpm, Docker Desktop pokrenut):
```bash
cd karton
pnpm install
cp .env.example .env      # lokalna konfiguracija
pnpm dev:db               # PostgreSQL 18 + Mailpit (Docker)
pnpm migrate              # šema iz apps/api/src/migrations
pnpm seed                 # prvi admin + podešavanja (singleton)
pnpm dev:api              # API  → http://localhost:3000
pnpm dev:worker           # podsetnici + auto-istek + dnevni backup
pnpm dev:web              # web  → http://localhost:5173
```

**4. Baza iz nule.** `pnpm dev:db` (Docker PostgreSQL 18, host port **5544**). Potpuni reset: `pnpm dev:db:down` pa `docker volume rm karton_karton-db-data`, zatim ponovo `dev:db` + `migrate` + `seed`.

**5. Migracije.** `pnpm migrate` (= `node --env-file=../../.env src/migrate.ts`). Baza se menja **isključivo** migracijama, nikad ručno (teh. preporuka §10).

**6. API / worker / frontend.** `pnpm dev:api` · `pnpm dev:worker` · `pnpm dev:web` (svaki u svom terminalu; ili `pokreni.bat` pokrene sve odjednom).

**7. Svi testovi.**
```bash
python karton/tests/acceptance.py   # acceptance/smoke (45 provera, traži pokrenut stack)
cd karton && pnpm -r typecheck      # TypeScript nad sva 4 paketa
```
Acceptance test je **destruktivan** (deo backup/restore stvarno vraća bazu) — samo nad razvojnom bazom. Detalji: `karton/tests/README.md`.

**8. Struktura projekta.**
```
specifikacija-finalna.md, baza-shema.sql, er-dijagram.mermaid,
openapi.yaml, tehnicka-preporuka.md   ← specifikacija (autoritet za pravila)
PRIMOPREDAJA.md                        ← ovaj dokument
pokreni.bat / zaustavi.bat             ← one-click launcher/stopper
citac-saobracajne/                     ← Java helper za čitač saobraćajne (127.0.0.1)
karton/
  apps/api/     Fastify API — config, pg, migracije, seed, rute, backup
  apps/worker/  scheduler: podsetnici + auto-istek dokumenata + dnevni backup
  apps/web/     React 19 SPA + PWA
  packages/shared/  statusi, DTO tipovi, katalog grešaka, backup modul
  tests/        acceptance.py + README
```

**9. Deployment na VPS (sažetak).** Detaljan predlog redosleda je na dnu dokumenta. Ukratko: sve razlike lokalno/prod idu u `.env`; web se builduje (`pnpm --filter @karton/web build`) i servira preko reverse proxy-ja sa TLS-om; API i worker idu pod process manager (systemd/pm2) u UTC; baza samo migracijama; `Secure` kolačić se pali automatski kad je `NODE_ENV=production`.

**10. Backup / restore.**
- **Automatski:** worker pravi backup jednom dnevno (`BACKUP_HOUR`, podrazumevano 02:00 po beogradskom vremenu) dok je pokrenut; ishod ide u tabelu `backup_run`.
- **Ručno:** Podešavanja → Backup → „Napravi backup sada".
- **Vraćanje:** Podešavanja → Backup → „Vrati iz backupa". Traži admina, ukucanu frazu `VRATI IZ BACKUPA` i obavezan razlog.
- **Garancije:** vraćanje je sve-ili-ništa (`psql --single-transaction`) — neuspeli restore ostavlja bazu netaknutom; tabele `session` i `backup_run` se ne vraćaju iz dumpa (sve sesije se gase, evidencija backupa preživljava); lozinka baze ide kroz `PGPASSWORD`, nikad kroz argumente procesa.
- **Lokacija:** `BACKUP_DIR` u `.env` (podrazumevano `./backups`, sidreno na koren monorepoa). Direktorijum je u `.gitignore`.
- ⚠️ **Šta backup NE pokriva: fotografije vozila.** One žive na disku (`UPLOADS_DIR`, podrazumevano `./uploads`) i štite se **odvojenom inkrementalnom sinhronizacijom** (rsync na offsite odredište, npr. Hetzner Storage Box). Razlog: slike se nikad ne menjaju, pa bi ih bilo besmisleno pakovati u svaki dnevni backup. **Na VPS-u ovo MORA da se podesi** — inače gubitak diska znači gubitak slika. Aplikacija to izričito piše na Backup ekranu.

**11. SMTP / email.** Slanje koristi SMTP iz **Podešavanja → Servis** (host, port, korisnik, lozinka, pošiljalac). Čita se pri svakom krugu, pa izmena važi odmah — bez restarta. Prijava se šalje kad su upisani korisnik i lozinka; TLS se bira po portu (**465** odmah šifrovano, **587** STARTTLS obavezan, ostalo bez TLS-a — lokalni Mailpit). Ako host u Podešavanjima nije upisan, pada na `SMTP_*` iz `.env`.

- **Lozinka se čuva šifrovano** (AES-256-GCM). Ključ je `SECRETS_KEY` iz `.env` i **nije u bazi** — backup baze sam po sebi ne otkriva lozinku. Ako se ključ izgubi, lozinka se ne može pročitati; ukuca se ponovo u Podešavanjima. **Ključ čuvaj uz backup plan.**
- API nikad ne vraća lozinku — samo `hasSmtpPassword: true/false`.
- **„Pošalji probni mejl"** (dugme u Podešavanjima) šalje istim putem kao pravi podsetnik i prikazuje odgovor mail servera. Koristi **sačuvana** podešavanja — prvo „Sačuvaj", pa test.
- **Gmail:** port **587**, korisnik = cela adresa, lozinka = **App Password** (nalog mora imati 2FA; obična lozinka ne radi). Gmail **prepisuje** adresu pošiljaoca na onu kojom se prijavljuje — ako se „Email pošiljaoca" razlikuje od korisnika, mušterija ipak vidi korisničku adresu.

**Pravila podsetnika (potvrđena i ugrađena, spec §4.11):**
1. Klijent može bez emaila; email se dodaje naknadno; može ih imati više (prvi = primarni).
2. Podsetnik se **naoruža** čim je uključen i termin je `scheduled` — bez obzira na email (klijent bez emaila daje meko upozorenje, ne grešku).
3. Šalje se **samo ako** je u trenutku slanja: termin `scheduled` + podsetnik uključen + klijent ima email.
4. Email dodat **pre** vremena slanja → podsetnik se pošalje. Email dodat **posle** → podsetnik se terminalno **preskoči** (`skipped`), bez zakašnjelog slanja.
Sve četiri stavke su dokazane end-to-end (worker + Mailpit).

---

## 12–20. Potvrde

| # | Provera | Status |
|---|---|---|
| 12 | `.env` nije u repou, `.env.example` jeste | ✅ `.env` ignorisan; `karton/.env.example` praćen |
| 13 | `backups/` nije u repou | ✅ ignorisan; 0 backup fajlova u gitu |
| 14 | Nema hardkodovanih lozinki / tokena / tajni | ✅ `git grep` čist; `SESSION_SECRET` i lozinke iz `.env` (min 32) |
| 15 | Demo admin je samo za test i mora se ugasiti pre produkcije | ✅ potvrđeno (vidi t. 15 ispod) |
| 16 | Spisak testova i pokrivenost | ✅ vidi ispod |
| 17 | Poznata ograničenja / tehnički dug | ✅ vidi ispod |
| 18 | Changelog poslednje isporuke | ✅ vidi ispod |
| 19 | `openapi.yaml`, baza i implementacija usklađeni | ✅ vidi ispod |
| 20 | Dokumentacija ažurirana | ✅ vidi ispod |

**15. Demo admin.** Nalog `admin` / `admin` (pojednostavljen za lokalno testiranje) kreira `apps/api/src/seed.ts`. **Pre produkcije obavezno:** napravi pravog admina sa jakom lozinkom, pa demo nalog ugasi (Podešavanja → Korisnici → status „isključen") ili obriši.

**16. Testovi.**
- **`karton/tests/acceptance.py`** — 45 provera protiv živog API-ja, u tri celine:
  - *Osnovni tok (18):* klijent → vozilo (VIN+vlasništvo+tablica) → ponuda → prihvatanje → nalog iz ponude → „Utvrđeno stanje" → rad/deo/eksterni/interna stavka → predračun → račun → plaćanje → izveštaj prihoda → dokumentna traka → prijemni list.
  - *Negativni (10):* drugi predračun, drugi račun, kopiranje računa, izmena snapshot-a, admin-only akcije kao korisnik, blokiran dan, van radnog vremena, zauzet majstor, zastarela verzija, `sort=DROP;--` i injection u pretrazi.
  - *Backup/restore (9):* kreiranje, evidencija, neuspeo restore + baza netaknuta, obavezna fraza i razlog, uspešan restore, odjava sesija, audit.
- **`karton/tests/photos.py`** — 15 provera fotografija sa prijema: upload, serviranje iza prijave (bez sesije → 401), folder `vozila/<VIN>/<datum>_<RN>/`, fajl na disku, **limit 10**, brisanje dok je nalog otvoren, **zaključavanje posle završetka**, galerija po posetama.
- **`pnpm -r typecheck`** — statička TypeScript provera nad api/worker/web/shared.

**17. Poznata ograničenja / tehnički dug.**
- ~~SMTP iz Podešavanja se ne koristi za slanje~~ — **rešeno 16.07.2026** (worker čita Podešavanja, `auth` + TLS, lozinka šifrovana, dugme „Pošalji probni mejl"). Vidi t. 11.
- **`admin` / `admin`** je namerno slaba demo prijava — **zameniti pravim nalogom i jakom lozinkom pre prave upotrebe.**
- **Sinhronizacija fotografija na VPS-u nije podešena** (ops korak, ne kod): `rsync` iz `UPLOADS_DIR` na offsite odredište. Bez toga slike nisu zaštićene. Vidi t. 10.
- **Čitač saobraćajne** je lokalni desktop helper (PC/SC, `127.0.0.1`); nije deo VPS-a i radi samo na mašini sa fizičkim čitačem.
- **Fontovi** su sistemski (self-host odložen dok ne stigne Marijev logo/brend).
- **PWA ikonice** su privremene (čekaju finalni logo).
- **Faza 2 (van V1 po dogovoru):** server-side PDF + slanje mejlom + PDF arhiva, Word izvoz, UI pregled audit loga, fotografije na nalogu, digitalno obeležavanje oštećenja, SMS podsetnici, magacin, praćenje troška/marže.
- Sortiranje na malim listama (Cenovnik, Korisnici) je na klijentu; velike liste sortira server.

**18. Changelog (isporuka „Zatvorene sve preostale v1 praznine", commit `a2e0159`).**
- Radni nalog: forma za izmenu zaglavlja — unos „Utvrđenog stanja" (findings), datumi/vremena, teren; ručna ispravka datuma završetka uz razlog + audit (BR-11). Veži/skini ponudu (rute nove). Dokumentna traka na nalogu i vozilu.
- Dokumenti: izmena ponude/predračuna, EUR iznos, admin ispravka plaćanja (`invoice.payment_changed`).
- Klijent/vozilo: liste vozila i istorije naloga (bili placeholderi), statistika vozila, filter „u servisu".
- Termini: izmena termina, vezivanje za nalog, odsustva majstora u proveri, admin korekcija (`appointment.corrected`).
- Backup: dnevni posao + `/backup/run|runs|restore`; sve-ili-ništa restore; izuzeti `session`/`backup_run`; lozinka kroz `PGPASSWORD`.
- Podešavanja/izveštaji: logo upload, SMTP polja, `page_size` na sve liste, Excel po izveštaju, filteri.
- Ostalo: dashboard lista vozila u servisu, sortiranje na svim tabelama, mobilne kartice, svih 9 audit događaja iz §11, `openapi.yaml`+spec usklađeni.

**19. Usklađenost openapi / baza / implementacija.**
- **Baza ↔ implementacija:** ovog kruga **nije menjana šema** (jedina migracija je `001_init.sql` iz inicijalnog commita); sve kolone/tabele koje nova logika koristi (`work_order.completed_on_manual`, `settings.logo`, `backup_run`, `mechanic_unavailability`) već postoje i proverene su. 45/45 acceptance provera prolazi protiv te baze.
- **openapi ↔ implementacija:** sinhronizovano u ovoj isporuci — dodate rute `/backup/run|runs|restore`, `/vehicles/{id}/stats`, `/documents/{id}/payment`, `/settings/logo` (PUT/DELETE), `/work-orders/{id}/link-quote|unlink-quote`; usklađen filter `inShop`; nove šifre grešaka (`INVOICE_NOT_PAID`, `BACKUP_FAILED`, `BACKUP_UNUSABLE`, `RESTORE_FAILED`). YAML je validan.

**20. Dokumentacija ažurirana.** `openapi.yaml` i `specifikacija-finalna.md` usklađeni sa kodom; `karton/README.md` osvežen (uklonjeni zastareli „uskoro" markeri za web/worker); dodati `karton/tests/README.md` i ovaj `PRIMOPREDAJA.md`.

---

## Acceptance rezultati (uživo, 45/45 ✅)

Pokrenuto `python karton/tests/acceptance.py` protiv svežeg API-ja:

```
OSNOVNI POSLOVNI TOK ....... 18/18   klijent→vozilo→ponuda→nalog→dokumenti→plaćanje→traka→prijemni list
NEGATIVNI TESTOVI .......... 10/10   dupli predračun/račun, kopija računa, snapshot, role, kalendar, verzija, injection
BACKUP / RESTORE ...........  9/9    kreiranje, evidencija, neuspeo restore→baza netaknuta, fraza+razlog, uspeh, odjava, audit
──────────────────────────────────
UKUPNO ..................... 45/45 prošlo
```
Ključni dokazi: interna stavka ostaje na nalogu ali NE ide na predračun/račun; prihod se broji po datumu plaćanja; dokumentna traka `P-…·RN-…·PR-…·R-…` kompletna; `sort=DROP;--` i `' OR 1=1--` bezbedno odbačeni; neuspeo restore ostavlja svih 26 tabela netaknutih.

---

## Produkciona checklista (pre stvarne upotrebe)

1. ☐ Napraviti pravog admin korisnika (Podešavanja → Korisnici).
2. ☐ Ugasiti/obrisati `admin` / `admin`.
3. ☐ Obrisati test podatke (test klijenti, vozila, nalozi, dokumenti).
4. ☐ Postaviti pravi logo (Podešavanja → Servis → Logo).
5. ☐ Podesiti SMTP u **Podešavanja → Servis** (Gmail: port 587, App Password) i potvrditi dugmetom **„Pošalji probni mejl"** — mora stići pravi mejl, ne verovati na reč.
6. ☐ Backup: `BACKUP_DIR` na trajnom disku + offsite kopija + retencija (rotacija starih dumpova).
7. ☐ Proveriti da restore radi na svežoj bazi (na staging-u, ne na produkciji).
8. ☐ Proveriti da se aplikacija podigne posle restarta servera (systemd/pm2 auto-start).
9. ☐ Proveriti da nema zombi procesa / konflikta portova (API po portu, ne po imenu procesa).
10. ☐ Proveriti mobilni prikaz na telefonu (tabele → kartice; PWA „instaliraj").

---

## Predlog redosleda za deployment na VPS

> Principi (teh. preporuka §10): sve okruženjske razlike u `.env`; nikad hardkodovan localhost; `Secure` kolačić samo u produkciji; baza samo migracijama; proces u UTC.

1. **Server:** VPS (Ubuntu 24.04), Node 24, pnpm, PostgreSQL 18 (native ili Docker), reverse proxy (Caddy ili nginx) sa **TLS** — obavezno za `Secure` kolačić i PWA.
2. **Baza:** kreiraj bazu i app korisnika; postavi `DATABASE_URL`. Bez javno izloženog porta.
3. **Kod:** `git clone`, `pnpm install`, build weba: `pnpm --filter @karton/web build` (statika u `apps/web/dist`).
4. **`.env` (produkcija):** `NODE_ENV=production`, `APP_BASE_URL=https://domen` (odatle QR na prijemnom listu), **jak `SESSION_SECRET` (≥32)**, **jak `SECRETS_KEY` (≥32, čuvati uz backup — bez njega se SMTP lozinka ne čita)**, `BACKUP_DIR` na trajnom disku, `TZ=UTC`. `SMTP_*` je samo rezerva — pravi SMTP se unosi kroz Podešavanja.
5. **Baza — šema i admin:** `pnpm migrate`, pa `pnpm seed` → **odmah** napravi pravog admina i ugasi demo (checklista 1–2).
6. **Procesi:** API i worker pod systemd/pm2, auto-restart, UTC, restart posle reboota.
7. **Web + proxy:** proxy servira `dist`, prosleđuje `/api` na API; TLS terminacija na proxy-ju.
8. **Backup + slike:** `BACKUP_DIR` i `UPLOADS_DIR` na trajnom disku. Dva odvojena posla:
   - baza → dnevni `pg_dump`, rotacija/retencija, kopija offsite;
   - **slike → inkrementalni `rsync` iz `UPLOADS_DIR` na Hetzner Storage Box** (slike se nikad ne menjaju, pa se kopira samo novo).
   Probaj restore baze na staging-u i vrati slike sa Storage Box-a.
9. **Smoke test:** prijava, kreiranje zapisa, ručni backup, restore na staging-u; provera PWA „instaliraj" (traži HTTPS).
10. **Čitač saobraćajne:** ostaje **lokalno** na mašini u servisu sa fizičkim čitačem (`127.0.0.1` + Origin allowlist) — ne ide na VPS.

Kad checklista i acceptance prođu bez kritičnih problema, V1 se smatra prihvaćenom i može se u pripremu deploy-a.
