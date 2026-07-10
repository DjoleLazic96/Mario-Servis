# Karton — vođenje auto servisa

Modularni monolit. Specifikacija je u nadređenom folderu (`specifikacija-finalna.md`, `baza-shema.sql`, `er-dijagram.mermaid`, `openapi.yaml`, `tehnicka-preporuka.md`).

Primopredaja i produkciona checklista: **`../PRIMOPREDAJA.md`**.

## Stack
Node.js 24+ · TypeScript · Fastify 5 · React 19 + Vite (PWA) · PostgreSQL 18 · pnpm workspaces.

## Struktura
```
apps/
  api/        Fastify API (config, pg, migracije, seed, rute, backup)
  worker/     scheduler: email podsetnici + auto-istek dokumenata + dnevni backup
  web/        React 19 SPA + PWA
packages/
  shared/     centralni statusi, tipovi, katalog grešaka, backup modul (deli se front/back)
tests/
  acceptance.py   acceptance/smoke test (45 provera) — vidi tests/README.md
```

## Pokretanje — najlakše

Iz nadređenog foldera dupli klik na **`pokreni.bat`**. Skript sam:
diže Docker Desktop, bazu i Mailpit, primeni migracije, pokrene API, worker,
web i čitač saobraćajne, pa otvori aplikaciju u browseru.

Za gašenje: **`zaustavi.bat`** (podaci u bazi ostaju sačuvani).

## Pokretanje — ručno

Preduslovi: Node 24+, pnpm, Docker Desktop (pokrenut), JDK 21 (za čitač).

```bash
pnpm install            # zavisnosti
cp .env.example .env    # lokalna konfiguracija
pnpm dev:db             # PostgreSQL 18 + Mailpit (Docker)
pnpm migrate            # napravi šemu iz apps/api/src/migrations
pnpm seed               # prvi admin + podešavanja
pnpm dev:api            # API na http://localhost:3000
pnpm dev:worker         # podsetnici + auto-istek dokumenata
pnpm dev:web            # aplikacija na http://localhost:5173
```

Čitač saobraćajne (poseban prozor):
```bash
cd ../citac-saobracajne/src && java -Dfile.encoding=UTF-8 CitacServer.java
```

Provera: `curl http://localhost:3000/health`

- **Admin (lokalno):** `admin` / `admin`
- **Baza:** `localhost:5544` (5432/5433 su zauzeti postojećim PostgreSQL-om na ovoj mašini)
- **Mailpit (uhvaćeni mejlovi):** http://localhost:8025

Zaustavljanje baze: `pnpm dev:db:down` (podaci ostaju u volumenu; `-v` ih briše).

## Napomene za deploy (teh. preporuka §10)
Sve razlike lokalno/server idu u `.env`; QR URL iz `APP_BASE_URL`; `Secure` kolačić samo u produkciji; baza isključivo migracijama; proces u UTC.
