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

## Statička provera

```bash
pnpm -r typecheck   # TypeScript nad sva 4 paketa
```
