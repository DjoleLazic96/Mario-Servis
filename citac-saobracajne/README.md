# AUTO SERVIS S23 — čitač saobraćajne dozvole (lokalni helper)

Mali lokalni program koji se pokreće na računaru servisa, čita srpsku saobraćajnu dozvolu
preko PC/SC čitača i vraća podatke web aplikaciji (dugme „Učitaj saobraćajnu" u formi vozila).

**Zašto uopšte postoji:** sajt u pregledaču ne sme da priđe USB čitaču — to je bezbednosni
zid svakog pregledača. Zato mora da radi jedan mali program na računaru pored čitača.

## Šta se isporučuje: `go/` (jedan mali .exe)

Aktuelna verzija je u [`go/`](go/) — jedan `.exe` od ~5.5 MB, **bez Jave i bez foldera**.

- `go/main.go` — ceo program (HTTP na 127.0.0.1:8765, čitanje kartice, CORS)
- `go/napravi.bat` — pravi `.exe` (treba Go 1.21+; rezultat je jedan fajl)
- `go/samopokretanje.bat` — postavi da se sam pokreće pri paljenju računara (bez admin prava)

Na računaru servisa: pokrene se `AUTO SERVIS S23 citac.exe`, ostavi otvoren. Ništa se ne
instalira. Sajt ga nudi na preuzimanje (dugme „Preuzmi čitač" kad čitač nije pokrenut).

## Kako radi

- Sluša **isključivo na `127.0.0.1:8765`** (nedostupno spolja).
- Odgovara samo sajtovima sa **spiska dozvoljenih** (`allowed` u `main.go`) — inače bi bilo
  koja stranica mogla da čita saobraćajne. Produkcijski domen je **ugrađen** (ne prosleđuje se).
- Šalje `Access-Control-Allow-Private-Network` — bez toga noviji Chrome blokira poziv sa
  javnog sajta ka 127.0.0.1.
- `GET /status` → `{ reader, cardPresent }`
- `GET /read` → `{ vin, make, model, fuel, year, plate, ownerName, ownerAddress }`

## Ako čitanje ne radi — prvo ovo

Otvoriti u pregledaču na tom računaru: **http://127.0.0.1:8765/status**

Kucanjem adrese nema Origin-a, pa provera sajta ne važi — vidi se pravo stanje:

| Odgovor | Znači |
|---|---|
| `{"reader":"…","cardPresent":true}` | Čitač i program rade. Problem je između sajta i programa (verzija). |
| `{"error":"Nema priključenog čitača."}` | Program ne vidi čitač — priključiti ga i pokrenuti program ponovo. |
| `{"error":"Kartici se ne može pristupiti…"}` | Druga aplikacija drži karticu — zatvoriti zvaničnu MUP aplikaciju. |
| ništa / greška veze | Program nije pokrenut. |

## Čitač je nezavisan od modela

Koristi PC/SC (`github.com/ebfe/scard`) i uzima prvi čitač u kome IMA kartice — nigde nema
imena ni modela čitača. Drugi čitač ne traži izmenu koda; treba mu samo drajver (Windows ga
obično sam instalira, CCID standard).

## Status

Provereno na živoj kartici (Škoda Kodiaq) — čita VIN, marku, model, gorivo, godinu, tablicu
i vlasnika. Sloj oko čitanja (dozvoljeni sajtovi, CORS, PNA) pokriva `karton/tests/citac.py`.

## Reference

- `src/CitacServer.java`, `src/ReadCard.java` — **prethodna** Java verzija (Go port je nastao
  iz nje). Više se ne isporučuje; ostaje kao referenca.
- `ref_*.go` — izvorni „Baš Čelik" kod (AGPL), referenca za logiku čitanja.

## Licenca

Logika čitanja srpske saobraćajne adaptirana je iz **Baš Čelik** (github.com/ubavic/bas-celik),
pod **AGPL-3.0**. Zato je i ovaj helper pod istom licencom.
