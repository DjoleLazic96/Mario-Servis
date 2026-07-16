# Testovi

## `acceptance.py` — acceptance / smoke test (45 provera)

Vozi ceo poslovni tok kroz živi API i proverava rezultate. Sam pravi svoje
podatke (klijent, vozilo, ponuda, nalog, dokumenti), pa se može pokretati
više puta zaredom.

Pokriva:

- **Osnovni tok (18):** klijent → vozilo (VIN + vlasništvo + tablica) →
  ponuda → prihvatanje → radni nalog iz ponude → „Utvrđeno stanje" →
  rad/deo/eksterni/interna stavka → predračun → račun → plaćanje →
  izveštaj prihoda → dokumentna traka → ruta prijemnog lista.
- **Negativni (10):** drugi predračun/račun, kopiranje računa, izmena
  snapshot dokumenta, admin-only akcije kao običan korisnik, blokiran dan,
  van radnog vremena, zauzet majstor, zastarela verzija, `sort=DROP;--` i
  SQL injection u pretrazi.
- **Backup/restore (9):** kreiranje backupa, evidencija, namerno neuspeo
  restore (baza ostaje netaknuta), obavezna fraza i razlog, uspešan restore,
  odjava svih sesija, audit zapis.

### Preduslovi

1. Podignut stack (DB, API, worker, web) — vidi glavni `README.md`.
2. Postoji demo admin `admin` / `admin` (kreira ga `pnpm seed`).
3. Python 3 i `docker` na PATH-u (test radi par provera direktno nad bazom
   kroz `docker exec karton-db`).

### Pokretanje

```bash
python tests/acceptance.py
```

> **Pažnja:** test je DESTRUKTIVAN — deo backup/restore stvarno vrati bazu iz
> dumpa i odjavi sve sesije. Pokretati isključivo nad razvojnom/test bazom,
> nikad nad produkcijom.

Izlazni kod je 0 kad sve prođe, 1 ako nešto padne.

## `photos.py` — fotografije sa prijema (15 provera)

Upload, serviranje iza prijave (bez sesije → 401), folder `vozila/<VIN>/<datum>_<RN>/`,
fajl stvarno na disku, **limit 10**, brisanje dok je nalog otvoren (i fajl nestaje sa diska),
**zaključavanje posle završetka naloga** (dodavanje i brisanje odbijeni, slike sačuvane),
galerija na kartonu vozila grupisana po posetama.

```bash
python tests/photos.py
```

## `reminders.py` — kada se šalju podsetnici (3 provere)

Regresija za bug od 15.07.2026: vreme podsetnika iz Podešavanja je **beogradsko zidno
vreme**, ali se upisivalo kroz `::timestamptz` uz UTC sesiju baze — pa je 09:00 postajalo
11:00 po Beogradu (podsetnici su kasnili 2h leti, 1h zimi). Test pravi termin i tvrdi da je
podsetnik zakazan **dan pre termina, u vreme iz Podešavanja, po Europe/Belgrade**.

```bash
python tests/reminders.py
```

Nije destruktivan — svoj termin/klijenta/vozilo pravi i briše sam.

## `smtp.py` — šifrovanje lozinke i slanje kroz Podešavanja (13 provera)

Regresija za stanje pre 16.07.2026: worker je slao preko `SMTP_*` iz `.env` i **potpuno
ignorisao ekran Podešavanja**, a lozinku čuvao u čistom tekstu. Kvar se nije video —
ništa ne pukne, podsetnik prosto ne stigne.

Test tvrdi: lozinka je u bazi šifrovana (AES-GCM `v1:…`), API je nikad ne vraća, probni
mejl ide kroz **Podešavanja** (ne `.env`), stvarno stigne u Mailpit sa ispravnim
pošiljaocem, a neispravan SMTP daje `422 SMTP_FAILED` sa porukom provajdera.

```bash
python tests/smtp.py
```

Traži podignut Mailpit (`docker compose up -d`). Vraća SMTP podešavanja na zatečeno.

## `responsive.mjs` — responzivnost na 7 širina ekrana (320–1440px)

Regresija za prijavu sa telefona (16.07.2026): kartice klijenata su se stapale u beli
blok, a filteri i polja u Podešavanjima bežali van ekrana. Uzrok: mobilni `@media`
blok je stajao PRE osnovnih pravila u `styles.css`, pa ga je kaskada gazila —
medijski upit NE nosi veću težinu od običnog pravila napisanog kasnije.

**Zato mobilni blok mora da ostane na KRAJU `styles.css`.**

Test vozi pravi Chromium kroz svih 9 ekrana na 7 širina i traži: vodoravno pomeranje
stranice, sadržaj koji beži van okvira, slepljene kartice, tabelu koja nije providna.

```bash
APP_USER=admin APP_PW=admin node tests/responsive.mjs http://localhost:5173
```

Traži Playwright (`pnpm dlx playwright install chromium`).

## Statička provera

```bash
pnpm -r typecheck   # TypeScript nad sva 4 paketa
```
