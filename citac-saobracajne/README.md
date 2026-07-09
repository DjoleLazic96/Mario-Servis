# Karton — čitač saobraćajne dozvole (lokalni helper)

Mala lokalna aplikacija koja se pokreće na računaru servisa, čita srpsku
saobraćajnu dozvolu preko PC/SC čitača i vraća podatke web aplikaciji
(dugme „Učitaj saobraćajnu" u formi vozila).

## Kako radi
- Sluša **isključivo na `127.0.0.1:8765`** (nije dostupno spolja).
- Prihvata samo dozvoljene **Origin**-e (CORS): u razvoju `http://localhost:5173`;
  za produkciju se domen prosleđuje kao argument.
- `GET /status` → `{ reader, cardPresent }`
- `GET /read` → `{ vin, make, model, fuel, year, plate, ownerName, ownerAddress }`

## Pokretanje (razvoj)
Potreban JDK 21+ (nosi `javax.smartcardio`). Iz `src/`:
```
java -Dfile.encoding=UTF-8 CitacServer.java
# za produkciju sa dozvoljenim domenom:
java -Dfile.encoding=UTF-8 CitacServer.java https://servis.example.rs
```

## Pakovanje u Windows instaler (bez zasebnog JRE)
```
javac -d out src/CitacServer.java
jpackage --type msi --name "Karton citac" --input out --main-jar ... 
```
(Detaljno pakovanje se radi pri isporuci; za sada je dovoljno pokretanje kroz `java`.)

## Status
Testirano na živoj kartici (Škoda Kodiaq, MTCOS kartica) — čita VIN, marku,
model, gorivo, godinu, tablicu i vlasnika. Radi.

## Licenca
Logika čitanja srpske saobraćajne (SELECT sekvence, redosled fajlova, BER-TLV
mapiranje tagova) je adaptirana iz open-source projekta **Baš Čelik**
(github.com/ubavic/bas-celik), koji je pod **AGPL-3.0**. Zato je i ovaj helper
pod istom licencom.
