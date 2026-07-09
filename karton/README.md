# Karton — vođenje auto servisa

Modularni monolit. Specifikacija je u nadređenom folderu (`specifikacija-finalna.md`, `baza-shema.sql`, `er-dijagram.mermaid`, `openapi.yaml`, `tehnicka-preporuka.md`).

## Stack
Node.js 24+ · TypeScript · Fastify 5 · React 19 (uskoro) · PostgreSQL 18 · pnpm workspaces.

## Struktura
```
apps/
  api/        Fastify API (config, pg, migracije, seed, rute)
  worker/     scheduler + email podsetnici (uskoro)
  web/        React SPA + PWA (uskoro)
packages/
  shared/     centralni statusi, tipovi, katalog grešaka (deli se front/back)
```

## Pokretanje (lokalno)

Preduslovi: Node 24+, pnpm, Docker Desktop (pokrenut).

```bash
pnpm install            # zavisnosti
cp .env.example .env    # lokalna konfiguracija (već postoji)
pnpm dev:db             # PostgreSQL 18 + Mailpit (Docker)
pnpm migrate            # napravi šemu iz apps/api/src/migrations
pnpm seed               # prvi admin + podešavanja
pnpm dev:api            # API na http://localhost:3000 (watch)
```

Provera: `curl http://localhost:3000/health`

- **Admin (lokalno):** `admin@karton.local` / `admin123`
- **Baza:** `localhost:5544` (5432/5433 su zauzeti postojećim PostgreSQL-om na ovoj mašini)
- **Mailpit (uhvaćeni mejlovi):** http://localhost:8025

Zaustavljanje baze: `pnpm dev:db:down` (podaci ostaju u volumenu; `-v` ih briše).

## Napomene za deploy (teh. preporuka §10)
Sve razlike lokalno/server idu u `.env`; QR URL iz `APP_BASE_URL`; `Secure` kolačić samo u produkciji; baza isključivo migracijama; proces u UTC.
