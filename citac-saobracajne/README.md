# Karton — čitač saobraćajne dozvole (lokalni helper)

Mala lokalna aplikacija koja se pokreće na računaru servisa, čita srpsku
saobraćajnu dozvolu preko PC/SC čitača i vraća podatke web aplikaciji
(dugme „Učitaj saobraćajnu" u formi vozila).

## Kako radi
- Sluša **isključivo na `127.0.0.1:8765`** (nije dostupno spolja).
- Prihvata samo sajtove sa **spiska dozvoljenih** (CORS). Bez toga bi bilo koja stranica sa
  interneta mogla da čita saobraćajne dok je čitač uključen.
- `GET /status` → `{ reader, cardPresent }`
- `GET /read` → `{ vin, make, model, fuel, year, plate, ownerName, ownerAddress }`

## Pokretanje

**Na računaru servisa:** dvoklik na `pokreni-citac.bat`. Ostaviti uključeno dok se radi.

**U razvoju**, iz `src/` (potreban JDK 21+, nosi `javax.smartcardio`):
```
java -Dfile.encoding=UTF-8 --add-opens java.smartcardio/sun.security.smartcardio=ALL-UNNAMED CitacServer.java
```
Prvi argument dodaje **još jedan** dozvoljen sajt; produkcijski domen je već ugrađen.

## Dozvoljeni sajtovi — zašto su u kodu

Produkcijski domen (`https://autoserviss23.rs`) stoji **ugrađen** u `ALLOWED`.

Ranije se dodavao samo ako se prosledi kao argument, a `pokreni.bat` ga nije prosleđivao —
pa je helper živom sajtu vraćao **403 na svakom računaru**. Pri tom je aplikacija javljala
„Čitač nije pokrenut", iako je uredno radio: iz JavaScript-a se odbijen zahtev (CORS) i
ugašen server vide potpuno isto. Tako je izgledalo kao kvar čitača, a bio je domen.

Pravilo: **dozvoljeni sajt se ne sme oslanjati na to da se neko seti argumenta.**
Čuva ga `karton/tests/citac.py`.

## Ako čitanje ne radi — prvo ovo

Otvoriti u pregledaču na tom računaru: **http://127.0.0.1:8765/status**

Kucanjem adrese nema Origin-a, pa provera sajta ne važi — vidi se pravo stanje:

| Odgovor | Znači |
|---|---|
| `{"reader":"…","cardPresent":true}` | Čitač i helper rade. Problem je između sajta i helpera (domen/verzija). |
| `{"error":"Nema priključenog čitača."}` | Helper ne vidi čitač: uključiti ga **pre** pokretanja helpera, ili zatvoriti drugi program koji drži karticu. |
| ništa / greška veze | Helper nije pokrenut. |

## Pakovanje u Windows instaler (bez zasebnog JRE)
```
javac -d out src/CitacServer.java
jpackage --type msi --name "Karton citac" --input out --main-jar ... 
```
(Detaljno pakovanje se radi pri isporuci; za sada je dovoljno pokretanje kroz `java`.)

## Zašto --add-opens
SunPCSC kešira PC/SC kontekst. Ako se čitač priključi *posle* pokretanja helpera,
`terminals().list()` trajno pada. Helper tada refleksijom resetuje kontekst i probа ponovo —
za to je potreban `--add-opens java.smartcardio/sun.security.smartcardio=ALL-UNNAMED`.

## Status
Testirano na živoj kartici (Škoda Kodiaq, MTCOS kartica) — čita VIN, marku,
model, gorivo, godinu, tablicu i vlasnika. Radi.

Sloj oko čitanja (dozvoljeni sajtovi, CORS, PNA) pokriva `karton/tests/citac.py` — 11 provera,
ne traži ni čitač ni karticu. Samo čitanje kartice se ne testira automatski: za to treba
fizička saobraćajna.

**Čitač je nezavisan od modela.** Koristi PC/SC (`javax.smartcardio`) i uzima prvi čitač u kome
IMA kartice — nigde nema imena ni modela čitača. Drugi čitač ne traži nikakvu izmenu koda;
treba mu samo drajver (Windows ga obično sam instalira, CCID standard).

## Licenca
Logika čitanja srpske saobraćajne (SELECT sekvence, redosled fajlova, BER-TLV
mapiranje tagova) je adaptirana iz open-source projekta **Baš Čelik**
(github.com/ubavic/bas-celik), koji je pod **AGPL-3.0**. Zato je i ovaj helper
pod istom licencom.
