# Karton — Primopredaja V1

Datum: 2026-07-10 · Grana: `main` · Repo: https://github.com/DjoleLazic96/Mario-Servis

Ovaj dokument je pripremljen za acceptance test i primopredaju V1. Sve tvrdnje su
proverene uživo protiv pokrenute aplikacije (vidi „Acceptance rezultati").

---

## 1–11. Pristup, pokretanje, komande

**1. Pristup aplikaciji (lokalno).** Web: `http://localhost:5173`. API: `http://localhost:5173/api/v1` (kroz Vite proxy) ili direktno `http://localhost:3000`. Najlakše pokretanje: dupli klik na `pokreni.bat` u korenu (diže sve i otvori browser).

**2. Nalozi za proveru rola.**
- Admin (seed): `admin@karton.local` / `admin123` — **samo za test, ugasiti pre produkcije** (vidi t. 15).
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

**11. SMTP / email.** ⚠️ **Važno — trenutno ponašanje:** worker koji stvarno šalje podsetnike čita **`SMTP_HOST` i `SMTP_PORT` iz `.env`** i šalje **bez autentifikacije** (podrazumevano Mailpit `localhost:1025`). SMTP polja u **Podešavanja → Servis** (host/port/korisnik/lozinka/pošiljalac) se **čuvaju u bazi ali ih slanje još ne koristi** — to je poznati tehnički dug (vidi t. 17). Za produkciju sa pravim mejlom trenutno se konfiguriše `.env`, a za autentifikovani SMTP treba dovezati `auth` u worker.

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

**15. Demo admin.** `admin@karton.local` / `admin123` postoji samo u `apps/api/src/seed.ts` za lokalni razvoj. **Pre produkcije obavezno:** napravi pravog admina, pa demo nalog ugasi (Podešavanja → Korisnici → status „isključen") ili obriši. Isto važi za sve `admin123` iz dokumentacije.

**16. Testovi.**
- **`karton/tests/acceptance.py`** — 45 provera protiv živog API-ja, u tri celine:
  - *Osnovni tok (18):* klijent → vozilo (VIN+vlasništvo+tablica) → ponuda → prihvatanje → nalog iz ponude → „Utvrđeno stanje" → rad/deo/eksterni/interna stavka → predračun → račun → plaćanje → izveštaj prihoda → dokumentna traka → prijemni list.
  - *Negativni (10):* drugi predračun, drugi račun, kopiranje računa, izmena snapshot-a, admin-only akcije kao korisnik, blokiran dan, van radnog vremena, zauzet majstor, zastarela verzija, `sort=DROP;--` i injection u pretrazi.
  - *Backup/restore (9):* kreiranje, evidencija, neuspeo restore + baza netaknuta, obavezna fraza i razlog, uspešan restore, odjava sesija, audit.
- **`pnpm -r typecheck`** — statička TypeScript provera nad api/worker/web/shared.

**17. Poznata ograničenja / tehnički dug.**
- **SMTP iz Podešavanja se ne koristi za slanje** (worker čita `.env`, bez `auth`). Vidi t. 11. — *najznačajniji dug.*
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
2. ☐ Ugasiti/obrisati `admin@karton.local` / `admin123`.
3. ☐ Obrisati test podatke (test klijenti, vozila, nalozi, dokumenti).
4. ☐ Postaviti pravi logo (Podešavanja → Servis → Logo).
5. ☐ Podesiti SMTP — **trenutno kroz `.env`** (`SMTP_HOST`/`SMTP_PORT`); za autentifikovani server prvo dovezati `auth` u worker (t. 17).
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
4. **`.env` (produkcija):** `NODE_ENV=production`, `APP_BASE_URL=https://domen` (odatle QR na prijemnom listu), **jak `SESSION_SECRET` (≥32)**, `SMTP_*`, `BACKUP_DIR` na trajnom disku, `TZ=UTC`.
5. **Baza — šema i admin:** `pnpm migrate`, pa `pnpm seed` → **odmah** napravi pravog admina i ugasi demo (checklista 1–2).
6. **Procesi:** API i worker pod systemd/pm2, auto-restart, UTC, restart posle reboota.
7. **Web + proxy:** proxy servira `dist`, prosleđuje `/api` na API; TLS terminacija na proxy-ju.
8. **Backup:** `BACKUP_DIR` na trajnom volumenu; cron za offsite kopiju i rotaciju/retenciju; probaj restore na staging bazi.
9. **Smoke test:** prijava, kreiranje zapisa, ručni backup, restore na staging-u; provera PWA „instaliraj" (traži HTTPS).
10. **Čitač saobraćajne:** ostaje **lokalno** na mašini u servisu sa fizičkim čitačem (`127.0.0.1` + Origin allowlist) — ne ide na VPS.

Kad checklista i acceptance prođu bez kritičnih problema, V1 se smatra prihvaćenom i može se u pripremu deploy-a.
