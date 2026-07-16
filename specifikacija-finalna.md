# Karton — finalna funkcionalna i tehnička specifikacija

**Verzija 4.0 · 8.7.2026.**

Konsolidacija: specifikacija v3 (.docx) + dopune 7.1–7.11 + konačne odluke 1–35 od 8.7.2026. U slučaju razlike, **ovaj dokument je merodavan**. Prateći artefakti:

| Artefakt | Fajl |
|---|---|
| ER dijagram (finalni) | `er-dijagram.mermaid` |
| PostgreSQL šema (predlog) | `baza-shema.sql` |
| OpenAPI specifikacija | `openapi.yaml` |
| Tehnička preporuka (stack, infrastruktura) | `tehnicka-preporuka.md` |
| Dizajn osnova | `servis-mockup ver.3.html` + dorade (§12) |
| Konflikti i primenjena rešenja | §13 |

---

## 1. Obim

**Prva verzija (v1):** svih 13 ekrana; login + role (admin/korisnik); klijenti, vozila (VIN + istorije vlasništva i tablica), majstori + cenovnik usluga; radni nalozi sa tri vrste stavki, tri načina obračuna rada (sat/km/paušal), izlaskom na teren i opcijom „Interno — ne naplaćuje se"; ceo dokumentni lanac (Ponuda → RN → Predračun → Račun) sa snapshot pravilom, transakcionom numeracijom, konverzijom i ispravkom računa; kalendar sa trajanjem termina, upozorenjima i blokadama; email podsetnici sa retry mehanizmom; automatski isteci; prihod i nenaplaćeno; 4 izveštaja (+ Excel ako ostane potreba); A4 štampa iz browsera; server-side pretraga/filtriranje/sortiranje/paginacija; arhiviranje umesto brisanja; **audit log (upis)**; automatski backup sa evidencijom; mobilni prikaz (tabele → kartice); **PWA** — aplikacija se na telefon instalira preko „Dodaj na početni ekran" (manifest + service worker), bez Play Store/App Store distribucije, sa automatskim ažuriranjem (odluka 9.7.2026); **čitač saobraćajne** — lokalna helper aplikacija na računaru servisa, čita čip preko PC/SC i puni formu vozila (odluka 9.7.2026 — premešten iz faze 2 u v1). Ručni unos uvek radi kao fallback.

**Faza 2:** server-side PDF + automatsko slanje emailom + arhiva PDF-ova; Word izvoz; UI pregled audit loga; digitalno označavanje oštećenja vozila i digitalna kontrola vozila na nalogu (u v1 samo statičke sekcije na papirnoj štampi — §4.4); upozorenje na dashboardu za ponude koje ističu; SMS podsetnici; magacin/zalihe; praćenje troška i profita.

**Van obima trajno (po spec v3):** fiskalizacija (račun je interni dokument), komplikovana prava pristupa po ekranima, tastaturne prečice.

## 2. Arhitektura i podela odgovornosti

VPS/cloud · PostgreSQL od prvog dana · modularni monolit (jedan codebase, jedna baza) · dva procesa: **api** (HTTP + SPA statika) i **worker** (scheduler + queue) · cookie sesije · bez mikroservisa. Frontend: React ili Vue + TypeScript; backend: Node.js + TypeScript (prilagodljivo iskustvu izvođača). Detalji: `tehnicka-preporuka.md`.

**Frontend:** 13 ekrana, forme, modali i modal-na-modal, dvoredna dokument traka, kalendar, responsive + kartice na telefonu, PWA (instalabilna na telefon, automatsko ažuriranje), filteri/sortiranje u UI-u, A4 print CSS, lokalne UX validacije, prikaz dostupnih akcija prema statusu i roli.

**Backend (jedini autoritet):** sva poslovna pravila, statusne tranzicije, zaključavanje, lanac dokumenata, numeracija, snapshot, autorizacija, duplikati, prihod, naplata, izveštaji, podsetnici, scheduler, audit log, backup, server-side filtriranje/sortiranje/pretraga/paginacija. **Pravilo koje postoji samo na frontendu smatra se nepostojećim.**

## 3. Jezik i imenovanje (odluka 27)

Engleski: kod, API, tabele i kolone baze. Srpski: UI. Jednoznačno mapiranje:

| Baza / API | UI (srpski) |
|---|---|
| `customer` | Klijent |
| `vehicle` | Vozilo |
| `work_order` | Radni nalog |
| `quote` | Ponuda |
| `proforma_invoice` (tip `proforma`) | Predračun |
| `invoice` | Račun |
| `mechanic` | Majstor |
| `appointment` | Termin |
| `appointment_reminder` | Podsetnik |
| `labor_item` / `part_item` / `external_service_item` | Stavka rada / dela / eksternog servisa |
| `service_catalog` | Cenovnik usluga |
| `field_visit` | Izlazak na teren |
| `internal_no_charge` | Interno — ne naplaćuje se |
| `settings` | Podešavanja |
| `audit_log` | Istorija izmena |

Poslovni brojevi dokumenata zadržavaju srpske prefikse: `P-`, `RN-`, `PR-`, `R-`.

## 4. Domenska pravila (sažetak po oblastima)

### 4.1 Vozilo, VIN, istorije
VIN je poslovni identifikator, jedinstven i nepromenljiv; vozilo ima i tehnički `id`. Vlasništvo (`ownership_history`) i tablice (`registration_history`) vode se kao od–do istorija; promena zatvara stari zapis i otvara novi u istoj transakciji; ništa se ne briše. Trenutni vlasnik/tablica = zapis sa `valid_to IS NULL` (najviše jedan po vozilu — parcijalni unique). Pretraga vozila pogađa i stare tablice.

### 4.2 Klijenti
Tip: fizičko (`individual`) / pravno (`company`) lice. PIB obavezan za pravna; JMBG opcion za fizička; provera duplikata samo ako je vrednost uneta. Više telefona i emailova (`customer_contact`); email opcion — bez emaila nema podsetnika.

### 4.3 Majstori
Ime i prezime, specijalnost (`mechanical`/`electrical`/`other`), datum zaposlenja, cena po satu, status, evidencija nedostupnosti (godišnji/bolovanje). Majstor se vezuje **za stavku rada, ne za nalog**. Promena cene majstora ne menja stare stavke — `labor_item.unit_price` čuva jediničnu cenu iz trenutka unosa.

**Cenovnik usluga** (`service_catalog`, novi tab na ekranu Cenovnik — odluka 9.7.2026): naziv, način obračuna (**paušal** ili **po kilometru**), podrazumevana cena, status (aktivna/neaktivna). Primeri: „Dijagnostika" — paušal 2.000; „Izlazak na teren" — po km, 80/km. Cena iz cenovnika se na nalogu **samo predlaže** i uvek može da se promeni; u stavci se zamrzava. Satni rad ide preko cenovnika majstora, ne kroz cenovnik usluga.

### 4.4 Radni nalog
Jedini obavezan dokument. Broj `RN-GGGG-NNNN` (§4.7). Pri otvaranju: vozilo (mora postojati; „+ Novo vozilo" ugnježdeno), datum prijema (+ opciono vreme prijema), kilometraža na prijemu, **zahtevani radovi** (sve što klijent traži i prijavljuje, njegovim rečima — jedino tekstualno polje koje se popunjava pri prijemu), napomena (opciono), veza na prihvaćenu ponudu (opciono). **Utvrđeno stanje** (`findings` — nalaz majstora) unosi se naknadno, tokom rada, dok je nalog u aktivnom statusu; pri otvaranju je prazno. Klijent se automatski predlaže iz trenutnog vlasnika vozila, uz mogućnost izmene. Majstor se ne bira pri otvaranju. Nalog istovremeno može imati interni rad, delove i eksterni servis — nalog nije „naš" ili „eksterni" kao celina. Datum završetka: automatski pri prelasku u `completed`, ručno ispravljiv po pravilima role (§6), promena ne dira izdate dokumente; uz njega opciono vreme predaje vozila.

**Stavka rada — tri načina obračuna** (odluka 9.7.2026): *po satu* (sati × cena/h — cena se predlaže iz cenovnika majstora), *po kilometru* (km × cena/km — izlazak na teren; kilometri se predlažu iz polja naloga), *paušalno* (unosi se samo iznos — dijagnostika, izlazak sa fiksnom cenom). **Majstor je obavezan u sva tri slučaja.** Kod „po satu" i „po km" iznos se **računa** (količina × jedinična cena) i ne kuca se ručno; za proizvoljan iznos koristi se paušal. Jedinična cena se zamrzava u stavci. Stavka opciono nosi vezu na uslugu iz cenovnika (za izveštaje).

**Izlazak na teren** (odluka 9.7.2026) — čekboks na nalogu koji otvara grupu polja, vidljivih i popunjivih samo kad je uključen: **datum i vreme izlaska**, **lokacija**, **pređeni kilometri servisnog vozila** (ukupno, oba pravca — nije odometar klijentovog vozila), **da li je vozilo u voznom stanju**, i **ishod**: *rešeno na terenu / dolazi na točkovima / dolazi na šlepu / klijent odustao*. Svaki izlazak zahteva otvoren radni nalog (BR-41). Izlazak se **uvek naplaćuje**, bez obzira na ishod — „klijent odustao" je ishod izlaska, **ne status naloga**; nalog završava u `completed` (BR-42). Naplata ide kao stavka rada („Izlazak na teren", po km ili paušalno). Kad je problem rešen na terenu i vozilo nikad fizički ne uđe u servis, `received_on` je datum otvaranja naloga; ako vozilo kasnije stigne (na točkovima ili šlepom), datum i vreme prijema se ažuriraju dok je nalog aktivan.

**Prijemni list (A4) — jedina standardna štampa naloga** (odluka 9.7.2026): štampa se pri prijemu vozila i fizički prati vozilo kroz servis. Sadrži podatke iz aplikacije (zaglavlje sa brojem RN, klijent, vozilo, kilometraža, datumi i vremena, zahtevani radovi, napomena — utvrđeno stanje se ne štampa jer u trenutku štampe još ne postoji) i **delove za ručno popunjavanje** koji se ne unose u softver u v1: tabelu „Izvršeni radovi" (RB / opis radova / sati / utrošeni delovi — upisuje majstor tokom rada), „Oštećenja vozila" sa skicom vozila (pet pogleda, skica iz Mariovog obrasca ver. 5) i „Kontrola vozila" (kontrola izvršena DA/NE; ulje motora / kočiono ulje / rashladna tečnost — svako OK/doliveno sa crticom za upis količine; nivo goriva E–¼–½–¾–F). **Potpisi — jedina dva na obrascu**: potpis klijenta pri predaji vozila servisu i potpis klijenta pri povratu vozila (isti papir, drugi potpis pri preuzimanju); uz potpise stoji rečenica saglasnosti: „Potpisom predaje potvrđujem tačnost podataka, označeno zatečeno stanje vozila i saglasnost za navedene radove." U futeru: „Interni dokument — nije fiskalni račun" i „Servis ne odgovara za lične stvari ostavljene u vozilu". U zaglavlju je **QR kod naloga** (v1): sadrži URL naloga u aplikaciji, skeniranjem se nalog otvara na telefonu; generiše ga aplikacija za svaki nalog. Ako korisnik nije prijavljen, vodi se na login sa zapamćenim odredištem i **posle uspešne prijave automatski preusmerava na traženi nalog**; `redirect` parametar sme da bude isključivo interna putanja aplikacije (zaštita od open redirect-a). Klijent ne dobija primerak — list ostaje u servisu (odluka 9.7.2026). Kad je „Izlazak na teren" štikliran, list dobija i blok **Izlazak na teren** (datum i vreme izlaska, lokacija, pređeni km, vozno stanje Da/Ne, ishod — četiri kućice), odmah ispod datuma prijema/predaje. Kao i svuda na listu, **polja koja u trenutku štampe nisu popunjena štampaju se kao prazne linije odn. prazne kućice** i popunjavaju se rukom, pa se naknadno unose u aplikaciju — pa isti šablon radi i kad se nalog otvara pre izlaska i kad se otvara posle njega. **Skraćena verzija lista se ne pravi** — uvek se štampa isti prijemni list. Prazne tabele stavki se ne štampaju; štampa kompletnog naloga sa stavkama iz aplikacije ostaje moguća po želji, ali nije deo standardnog toka. Predlog izgleda: „Radni nalog - predlog/Radni nalog Karton - prijemni list.pdf".

**Unos stavki — dve ravnopravne staze** (odluka 9.7.2026): (a) majstor rukom upisuje radove i delove na prijemni list, a u aplikaciju ih unosi kancelarija; (b) stavke se unose direktno preko telefona/tableta u radionici (mobilni prikaz — §4.4 je jedan od glavnih razloga zašto je mobilni prikaz kritičan). Obe staze završavaju istim unosom — aplikacija je jedini izvor istine za stavke, cene i iznose.

### 4.5 „Interno — ne naplaćuje se"
Dostupno na stavkama delova i eksternog servisa (ne rada — besplatan rad = stavka sa cenom 0). Označena stavka ostaje evidentirana na nalogu, **ne prenosi se na dokument za klijenta** i ne ulazi u iznos. Naziv opcije je obavezno „Interno — ne naplaćuje se" (ne „Ne prikazuj klijentu"). Štampa naloga je interna i prikazuje ih sa oznakom „interno"; opcija štampe naloga bez internih stavki.

### 4.6 Dokumentni lanac
- **Ponuda**: nastaje samostalno ili iz naloga (`work_order_id` opcion); koristi dokument-stavke (procena), ne stvarne stavke rada. Editabilna samo `pending`. Prihvaćena ponuda može biti vezana za **jedan ili više** naloga (1:N); nalog iz ponude preuzima klijenta, vozilo, vezu i eventualno početne zahtevane radove — nikad stavke. Istekla/odbijena → samo „Kopiraj", bez vraćanja statusa. Vezivanje naloga moguće samo za `accepted` ponudu; „Skini ponudu" na jednom nalogu ne dira ostale.
- **Predračun**: isključivo iz naloga (`work_order_id` obavezan), iz statusa `open`/`in_progress`/`waiting_parts`/`completed` (ne iz `cancelled`). Najviše **jedan aktivan** (`valid`) po nalogu; novi tek kad prethodni istekne ili se iskoristi. Novi predračun je zabranjen i **dok nalog ima račun u statusu `unpaid`/`paid`** (BR-40) — jedini izuzetak je transakcioni tok „Ispravi račun". Na `valid` predračunu editabilni su isključivo rok važenja, EUR iznos i napomena (`note`). Snapshot: stavke se ne osvežavaju iz naloga, **nema akcije „Osveži iz naloga"** — novo stanje = novi dokument ili „Kopiraj".
- **Račun**: isključivo konverzijom predračuna; ne postoji direktna forma. Bez parcijalnog fakturisanja: po nalogu postoji najviše **jedan račun koji nije `voided`** (`unpaid` ili `paid`) — sprovedeno parcijalnim unique indeksom u bazi; istorijski `voided` računi ne blokiraju korektivni tok. Konverzija: unosi se datum dospeća, predračun → `used`, novi račun sa novim brojem, snapshot stavki; novi račun dobija vezu unazad na predračun (`source_document_id` + `converted_from`). „Ispravi račun" (dok `unpaid`): stari → `voided` (trajno u istoriji), kreira se nov predračun sa istim nalogom i vezom nazad, koriguje se, ponovo konvertuje. `paid` korisnik ne vraća; admin može `paid` → `unpaid` uz obavezan razlog, audit i trenutnu korekciju prihoda. Snapshot stavke izdatog računa niko ne menja.
- **Kopiraj** (samo ponuda i predračun): novi dokument, novi broj, današnji datum, kopirane stavke, veza `copied_from`, original netaknut. Predračun se ne može kopirati dok po istom nalogu postoji drugi `valid` predračun (BR-39) ili aktivan račun (BR-40) — UI onemogućava dugme, backend vraća poslovnu grešku. **Račun nema akciju „Kopiraj"** — za račun postoji isključivo „Ispravi račun" (`COPY_NOT_ALLOWED`).
- **Veze među dokumentima**: `source_document_id` se **uvek nalazi na novonastalom dokumentu i pokazuje unazad** na dokument iz kog je trenutni nastao ili u odnosu na koji je korekcija — nikad obrnuto. Uvek ide u paru sa `source_relation_type`: novi račun → iskorišćeni predračun (`converted_from`); kopija → original (`copied_from`); korektivni predračun → poništeni (`voided`) račun (`correction_of`). Lanac istorije dokumenta rekonstruiše se praćenjem `source_document_id` unazad.
- **Snapshot pravilo**: pri izdavanju se zamrzavaju stavke, iznosi, klijent, vozilo i relevantni podaci; izmena naloga ne menja izdate dokumente.

### 4.7 Numeracija (odluka 16)
Zasebne godišnje sekvence po tipu: `P-` (ponuda), `RN-` (nalog), `PR-` (predračun), `R-` (račun); reset 1. januara. Generiše isključivo backend, transakciono preko `number_sequence` tabele (`SELECT … FOR UPDATE`), uz UNIQUE constraint na broju; bez `MAX+1`; frontend nikad ne određuje broj.

### 4.8 Rok važenja (odluka 17)
Default 15 dana, podešava se u Podešavanjima, promenljiv po dokumentu. Rok je uključiv: dokument važi do kraja poslednjeg dana, ističe po isteku tog dana u Europe/Belgrade.

### 4.9 Prikaz rada na dokumentu za klijenta (odluka 13)
Imena majstora se **nikad** ne prikazuju na ponudi/predračunu/računu. **Satne** stavke rada se grupišu po specijalnosti („Mehaničarski rad", „Električarski rad", „Drugo"): zbir sati + zbirni iznos; cena po satu se prikazuje samo ako je ista za sve stavke grupe, inače se ne prikazuje (bez lažne jedinstvene cene). **Km i paušalne** stavke rada prikazuju se kao **zasebni redovi po nazivu**, unutar iste rubrike Rad: km red prikazuje količinu × jediničnu cenu („Izlazak na teren — 46 km × 80 — 3.680"), paušalni samo iznos („Dijagnostika — 2.000"). Ne ulaze u zbir sati niti u proveru jedinstvene cene/h. Tri rubrike (Rad / Delovi / Eksterni servis); prazna rubrika se ne prikazuje; interne stavke se preskaču. EUR informativno na ponudi/predračunu ako je unet.

### 4.10 Termini i kalendar (odluka 18)
Termin: datum, vreme, trajanje (min), klijent, vozilo, majstor (opciono), napomena, podsetnici on/off. Preklapanje termina majstora i termin van radnog vremena → **upozorenje uz mogućnost potvrde** (`confirmed: true`); blokiran dan → **tvrda blokada**. `completed` → `scheduled` korisnik sme samo ako termin nije vezan za nalog; admin može korigovati status i vezu uz audit i razlog. Kardinalnost: **više termina može biti vezano za isti nalog** (npr. dijagnostika, nastavak radova, predaja vozila); jedan termin pokazuje na najviše jedan nalog. Fizičko brisanje samo budućeg termina. Kalendar: nedeljni prikaz, boje po statusu, filter po majstoru, status slanja podsetnika vidljiv.

### 4.10a Fotografije vozila pri prijemu (odluka 11.7.2026)
Slikanje **samo pri prijemu** vozila (ne i pri povratu) — dokaz stanja, zaštita od reklamacija. **Max 10** slika po nalogu (tvrdo, backend). Slika se telefonom/tabletom (PWA, kamera se otvara direktno); browser **smanjuje i kompresuje pre slanja** (~1600px, JPEG ~80% → ~250 KB), pa server ne treba native biblioteku za slike.

**Čuvanje:** fajl na disku (`UPLOADS_DIR`), u bazi samo metapodatak (`work_order_photo`). Putanju gradi server:
`uploads/vozila/<VIN>/<datum>_<RN-broj>/<uuid>.jpg`. **Ključ foldera je VIN** (nepromenljiv, BR-01) — tablica se menja i razbila bi folder istog vozila.

**Zaključavanje:** slike se dodaju/brišu **samo dok je nalog otvoren / u radu / čeka delove**. Kad je nalog **završen ili otkazan → zaključane** (one su dokaz). Admin može ponovo otvoriti nalog uz razlog (postojeći mehanizam). Sve u audit (`photo.added`, `photo.deleted`).

**Bez automatskog brisanja** (odluka 11.7.2026) — slike su dokaz; ručno brisanje pojedinačne slike je moguće dok je nalog otvoren.

**Pristup:** slike su lični podaci klijenta — serviraju se isključivo kroz **prijavljenu** rutu (`GET /photos/:id`), nikad kao javni statički folder. Ako fajl fali na disku, UI pokazuje „slika nedostupna" umesto da pukne.

**Backup:** dnevni backup pokriva **bazu**; slike se štite **odvojenom inkrementalnom sinhronizacijom** (rsync na offsite odredište). Razlog: slike se nikad ne menjaju, pa bi ih bilo besmisleno pakovati u svaki dnevni backup. Prijemni list se **ne menja** (slike ne idu na štampu).

### 4.11 Email podsetnici (odluka 19)
**Zakazivanje (naoružavanje):** red podsetnika se kreira čim je podsetnik uključen i termin je `scheduled` — **bez obzira da li klijent u tom trenutku ima email**. Uključivanje podsetnika za klijenta bez emaila daje **meko upozorenje** (`CONFIRMATION_REQUIRED` → `NO_CUSTOMER_EMAIL`), ne tvrdu grešku.

**Slanje — uslovi se proveravaju u trenutku slanja:** šalje se samo ako je tada termin `scheduled` + podsetnik uključen + klijent ima (primarni) email. Posledice:
- email dodat **pre** planiranog vremena slanja → podsetnik se pošalje;
- email dodat **posle** tog vremena → podsetnik se u trenutku slanja **terminalno preskače** (`skipped`) i ne šalje se naknadno (nema zakašnjelog slanja); ista sudbina ako je termin u međuvremenu otkazan/realizovan ili je podsetnik isključen.

Default vreme: 09:00 dan pre (podešavanje). Statusi: `scheduled` / `processing` / `sent` / `failed` (greška slanja, ide u retry) / `skipped` (svesno preskočen — nije greška). Čuva se: uključen, planirano vreme, status, broj pokušaja, poslednji pokušaj, poslednja greška, vreme uspešnog slanja. Retry (samo za `failed`) sa rastućim razmakom (5 → 15 → 60 → 180 → 360 min, max 5 pokušaja). Šablon (izmenljiv u fazi 2, u v1 konstanta u kodu): naslov „Podsetnik za zakazani termin — [Naziv servisa]"; sadržaj: ime klijenta, naziv servisa, datum, vreme, vozilo, tablica, telefon servisa, napomena da je poruka automatska; pošiljalac: naziv servisa iz Podešavanja.

**SMTP (rešeno 16.07.2026):** slanje koristi SMTP iz **Podešavanja** (čita se pri svakom krugu, pa izmena važi bez restarta). Prijava (`auth`) se šalje kad su upisani korisnik i lozinka; TLS se bira po portu — 465 odmah šifrovano, 587 STARTTLS (obavezan), ostalo bez TLS-a (lokalni Mailpit). Ako u Podešavanjima nema hosta, pada na `SMTP_*` iz `.env`.

Lozinka se u bazi čuva **šifrovano** (AES-256-GCM, ključ `SECRETS_KEY` iz `.env` — nije u bazi); API je nikad ne vraća, samo `hasSmtpPassword`. Ako se ključ izgubi, lozinka se ne može pročitati i ukuca se ponovo.

Dugme **„Pošalji probni mejl"** u Podešavanjima šalje istim putem kao pravi podsetnik i vraća grešku mail servera kakva jeste (`SMTP_FAILED`) — da se SMTP ne podešava naslepo.

> **Gmail:** traži App Password (nalog mora imati 2FA), port 587. Gmail prepisuje adresu pošiljaoca na onu kojom se prijavljuje — ako se `senderEmail` razlikuje od korisnika, mušterija ipak vidi korisničku adresu (osim verifikovanog aliasa).

### 4.12 Prihod i naplata (odluka 20)
Prihod = isključivo računi `paid`, po `paid_on`. Ponude i predračuni nikad ne ulaze. Nenaplaćeno = zbir računa `unpaid`. `due_on` je informativan (sortiranje, „kasni X dana", „dospeva…"), nikad ne menja status.

### 4.13 Arhiviranje (odluka 23)
Ništa se fizički ne briše (izuzetak: budući termin). Klijent/vozilo: aktivan/arhiviran — arhivirano se pregleda, ne koristi u novom poslovnom toku (nalog, termin, dokument), može se dearhivirati. Majstor: aktivan/neaktivan.

### 4.14 Role (odluka 21)
**Korisnik**: ceo standardni tok — klijenti, vozila, nalozi i stavke, termini, ponude, predračuni, konverzija u račun, označavanje plaćenog, standardne tranzicije. **Ne može**: osetljive undo tranzicije, Podešavanja, korisnike, backup, sistemsku konfiguraciju. **Admin**: dodatno korektivne akcije (§6) + Podešavanja + korisnici + backup. Admin **ne sme**: fizički brisati istoriju, tiho menjati snapshot dokumente, brisati audit trag.

### 4.15 Audit log (odluka 22)
Obavezan u v1 (upis; UI pregled u fazi 2). Polja: `id, user_id, entity_type, entity_id, action, old_value, new_value, reason, created_at`. Događaji: §11. Za osetljive admin akcije razlog je obavezan.

### 4.16 Vremenska zona (odluka 26)
Timestampovi u bazi: UTC. Poslovna logika i prikaz: Europe/Belgrade — važi za „danas", dashboard, radno vreme, rokove, isteke, podsetnike, termine.

### 4.17 Pretraga, filtriranje, paginacija (odluka 28)
Server-side nad celim skupom. Pretraga case-insensitive, ignoriše razmake gde je smisleno (`golf7` → „Golf 7"). Paginacija default 20, podesivo.

### 4.18 Štampa i izvoz (odluke 29–30)
v1: HTML + A4 print CSS + browser print/Save as PDF; Excel za izveštaje. Standardna štampa naloga je prijemni list (§4.4); prazne tabele stavki se ne štampaju, pa je štampa pri prijemu automatski čist prijemni dokument. Faza 2: server-side PDF (identičan rendering, slanje emailom, arhiva), Word.

**Pun Excel izvoz (v1, odluka 9.7.2026):** **jedno dugme „Izvezi sve u Excel"**, na jednom mestu — ekran Izveštaji, sekcija „Izvoz podataka". Jedan klik → jedan `.xlsx` fajl sa celom bazom, po sheetovima: **Radni nalozi** (jedan nalog = jedan red, svi podaci po kolonama — broj, status, klijent, vozilo, datumi i vremena, kilometraža, tekstualna polja, izlazak na teren sa svim pratećim poljima (datum, vreme, lokacija, pređeni km, vozno stanje, ishod), zbirovi rada/delova/eksternog, interno, veze ka dokumentima; stavke zbirno u tekstualnim kolonama), **Ponude**, **Predračuni**, **Računi** (jedan dokument = jedan red), plus sheetovi stavki sa po jednim redom po stavci (stavke rada — sa načinom obračuna, količinom i jediničnom cenom / delovi / eksterni servis / stavke dokumenata, sve sa brojem naloga odn. dokumenta). Bez filtera — uvek sve. Postojeći Excel izvozi pojedinačnih izveštaja ostaju nepromenjeni. Endpoint: `GET /export/all.xlsx`.

### 4.19 Podešavanja (odluka 25, samo admin)
Podaci servisa (naziv, adresa, PIB, telefon, logo), radno vreme, default rok važenja, vreme podsetnika, email/SMTP konfiguracija, paginacija, korisnici i role, backup parametri.

## 5. Statusi po entitetu (baza ↔ UI)

| Entitet | Baza (enum) | UI |
|---|---|---|
| Radni nalog | `open` / `in_progress` / `waiting_parts` / `completed` / `cancelled` | Otvoren / U radu / Čeka delove / Završeno / Otkazano |
| Ponuda | `pending` / `accepted` / `rejected` / `expired` | Na čekanju / Prihvaćena / Odbijena / Istekla |
| Predračun | `valid` / `used` / `expired` | Važi / Iskorišćen / Istekao |
| Račun | `unpaid` / `paid` / `voided` | Neplaćeno / Plaćeno / Neispravan |
| Termin | `scheduled` / `completed` / `cancelled` / `no_show` | Zakazano / Realizovano / Otkazano / Nije se pojavio |
| Podsetnik | `scheduled` / `processing` / `sent` / `failed` | Zakazan / Obrada / Poslat / Greška |
| Klijent, vozilo | `active` / `archived` | Aktivan / Arhiviran |
| Majstor | `active` / `inactive` | Aktivan / Neaktivan |
| Korisnik | `active` / `disabled`; rola `admin` / `user` | Aktivan / Deaktiviran; Admin / Korisnik |
| Usluga (cenovnik) | `active` / `inactive` | Aktivna / Neaktivna |
| Način obračuna stavke rada | `hour` / `km` / `flat` | Po satu / Po kilometru / Paušalno |
| Ishod izlaska na teren | `solved_on_site` / `arrives_driving` / `arrives_towed` / `customer_declined` | Rešeno na terenu / Dolazi na točkovima / Dolazi na šlepu / Klijent odustao |

Editabilnost: ponuda samo `pending`; nalog `open`/`in_progress`/`waiting_parts`; predračun `valid` (samo rok, EUR, napomena — stavke su snapshot); račun nikad direktno.

## 6. Dozvoljene statusne tranzicije

**S** = sistem (scheduler), **K** = korisnik i admin, **A** = samo admin (uvek uz audit; razlog obavezan).

| Entitet | Iz | U | Ko | Napomena |
|---|---|---|---|---|
| Nalog | `open` ↔ `in_progress` ↔ `waiting_parts` (svi smerovi) | | K | slobodno kretanje kroz aktivne statuse |
| Nalog | `open`/`in_progress`/`waiting_parts` | `completed` | K | auto-upis datuma završetka |
| Nalog | `open`/`in_progress`/`waiting_parts` | `cancelled` | K | |
| Nalog | `completed` | `in_progress` / `open` | **A** | audit: `work_order.reopened` |
| Nalog | `cancelled` | `open` | **A** | audit |
| Ponuda | `pending` | `accepted` | K | opciono odmah otvara nalog |
| Ponuda | `pending` | `rejected` | K | povratak ne postoji — „Kopiraj" |
| Ponuda | `pending` | `expired` | S | rok uključiv, Europe/Belgrade |
| Predračun | `valid` | `used` | K | isključivo kroz „Pretvori u račun" |
| Predračun | `valid` | `expired` | S | |
| Račun | `unpaid` | `paid` | K | unos datuma i načina plaćanja |
| Račun | `unpaid` | `voided` | K | isključivo kroz „Ispravi račun" |
| Račun | `paid` | `unpaid` | **A** | razlog obavezan; koriguje prihod |
| Termin | `scheduled` | `completed` / `cancelled` / `no_show` | K | uz `completed` opciono vezivanje naloga |
| Termin | `completed` | `scheduled` | K | samo ako nije vezan za nalog |
| Termin | bilo koji | korekcija statusa/veze | **A** | audit |
| Podsetnik | `scheduled` → `processing` → `sent`/`failed`; `failed` → `scheduled` | | S | retry dok pokušaji < 5 |

Sve ostale tranzicije su zabranjene → greška `TRANSITION_NOT_ALLOWED`.

## 7. Katalog poslovnih pravila

| # | Pravilo |
|---|---|
| BR-01 | VIN jedinstven i nepromenljiv; provera duplikata sa ponudom povlačenja postojećeg vozila. |
| BR-02 | Najviše jedan aktivan vlasnik i jedna aktivna tablica po vozilu; promena zatvara stari i otvara novi zapis transakciono. |
| BR-03 | Pretraga vozila pogađa i istorijske tablice. |
| BR-04 | PIB obavezan za pravna lica; JMBG opcion za fizička; duplikat se proverava samo ako je vrednost uneta. |
| BR-05 | Vozilo (i klijent) moraju postojati pre naloga/ponude; ugnježdene forme „+ Novo…" u toku unosa. |
| BR-06 | Klijent na nalogu se predlaže iz trenutnog vlasnika vozila; može se izmeniti. |
| BR-07 | Majstor se vezuje isključivo za stavku rada (obavezan i kod paušalnih i km stavki); `labor_item.unit_price` zamrzava jediničnu cenu (cena/h ili cena/km) u trenutku unosa. Cene iz cenovnika majstora i cenovnika usluga su samo predlog. |
| BR-08 | Stavke naloga se menjaju samo dok je nalog u aktivnom statusu; `completed`/`cancelled` zaključava nalog. |
| BR-09 | „Interno — ne naplaćuje se" samo na delovima i eksternom servisu; interna stavka ne ide na dokument niti u iznos; ostaje na nalogu. |
| BR-10 | Ponuda: `work_order_id` opcion; koristi dokument-stavke; editabilna samo `pending`. |
| BR-11 | Nalog se vezuje samo za `accepted` ponudu; jedna ponuda → više naloga (1:N); skidanje veze na jednom nalogu ne dira ostale. |
| BR-12 | Nalog iz ponude preuzima klijenta, vozilo, vezu, opcioni početni opis — nikad stavke. |
| BR-13 | Istekla/odbijena ponuda se ne vraća — samo „Kopiraj". |
| BR-14 | Predračun isključivo iz naloga u statusu `open`/`in_progress`/`waiting_parts`/`completed`; nikad iz `cancelled`. |
| BR-15 | Najviše jedan predračun `valid` po nalogu (parcijalni unique u bazi). |
| BR-16 | Predračun je snapshot; bez „Osveži iz naloga"; novo stanje = novi dokument ili kopija. |
| BR-17 | Istekao predračun se ne konvertuje — samo kopija u novi. |
| BR-18 | Račun isključivo konverzijom predračuna `valid`; bez direktne forme; bez parcijalnog fakturisanja — najviše **jedan ne-`voided`** račun (`unpaid` ili `paid`) po nalogu, sproveden parcijalnim unique indeksom u bazi. |
| BR-19 | Konverzija: datum dospeća + predračun → `used` + nov broj + snapshot — sve u jednoj transakciji; novi račun nosi vezu unazad (`source_document_id` = predračun, `converted_from`). |
| BR-20 | „Ispravi račun" samo dok je `unpaid`: stari → `voided`, nov predračun sa istim nalogom i vezom nazad. |
| BR-21 | `paid` → `unpaid` samo admin, razlog obavezan, audit, trenutna korekcija prihoda. |
| BR-22 | Snapshot izdatog dokumenta je nepromenljiv — i za admina. |
| BR-23 | „Kopiraj" postoji samo za ponudu i predračun: nov broj, današnji datum, veza `copied_from`, original netaknut. Račun se ne kopira — koristi se „Ispravi račun". |
| BR-24 | Numeracija: backend, transakciono, `number_sequence` + `FOR UPDATE`, UNIQUE na broju, godišnji reset; formati `P-`/`RN-`/`PR-`/`R-GGGG-NNNN`. |
| BR-25 | Rok važenja: default iz Podešavanja (15 dana), promenljiv po dokumentu, uključiv, Europe/Belgrade. |
| BR-26 | Na dokumentu za klijenta: bez imena majstora; **satni** rad grupisan po specijalnosti (cena/h samo ako je ista u celoj grupi); **km i paušalne** stavke rada kao zasebni redovi po nazivu unutar rubrike Rad (km red prikazuje količinu × jediničnu cenu), van zbira sati; prazne rubrike se ne prikazuju. |
| BR-27 | Preklapanje termina majstora i termin van radnog vremena: upozorenje + potvrda (`confirmed: true`); blokiran dan: tvrda blokada. |
| BR-28 | Termin `completed` → `scheduled` korisnik sme samo bez vezanog naloga; admin korekcije uz audit. |
| BR-29 | Fizičko brisanje termina samo dok nije počeo; sve ostalo se arhivira/statusira. |
| BR-30 | Podsetnik: šalje se samo za `scheduled` termin + klijent sa emailom + uključen podsetnik; provera u trenutku slanja; retry 5/15/60 min, max 5. |
| BR-31 | Prihod isključivo `paid` računi po `paid_on`; nenaplaćeno = `unpaid`; `due_on` nikad ne menja status. |
| BR-32 | Arhiviran klijent/vozilo: bez novog naloga/termina/dokumenta; dearhiviranje dozvoljeno. |
| BR-33 | Rola `user` bez osetljivih undo akcija i bez Podešavanja/korisnika/backupa; provera na backendu po ruti. |
| BR-34 | Audit log za sve događaje iz §11; za admin korekcije razlog obavezan; audit se ne briše. |
| BR-35 | UTC u bazi; Europe/Belgrade za sva poslovna pravila i prikaz. |
| BR-36 | Server-side pretraga/filtriranje/sortiranje/paginacija nad celim skupom; pretraga bez case/razmak osetljivosti. |
| BR-37 | Datum završetka naloga: automatski pri `completed`, ručna korekcija po roli, bez uticaja na izdate dokumente. |
| BR-38 | Optimističko zaključavanje (`version`) na nalogu, dokumentu, terminu i podešavanjima; sve mutacione akcije nad njima nose `version`, konflikt → 409; akcije bez `version` (kopija, brisanje termina, izdavanje predračuna) izvršavaju se transakciono uz row-lock. |
| BR-39 | Predračun se ne može kopirati u novi `valid` dok po istom nalogu postoji drugi `valid` predračun — UI onemogućava akciju, backend vraća `ACTIVE_PROFORMA_EXISTS`; backend je konačni autoritet. |
| BR-40 | Dok nalog ima račun u statusu `unpaid`/`paid`, novi predračun se ne izdaje (`ACTIVE_INVOICE_EXISTS`). Jedini izuzetak: tok „Ispravi račun", koji u istoj transakciji (1) prevodi `unpaid` račun u `voided`, pa (2) kreira korektivni `valid` predračun sa vezom `correction_of`. |
| BR-41 | Svaki izlazak na teren zahteva otvoren radni nalog; polja izlaska postoje samo kad je čekboks uključen (sprovedeno CHECK-om u bazi). Pređeni kilometri su kilometraža servisnog vozila (ukupno, oba pravca), nezavisna od `odometer_km`. |
| BR-42 | Izlazak na teren se **uvek naplaćuje**, bez obzira na ishod; „klijent odustao" je ishod izlaska, ne status naloga — nalog završava u `completed`. |
| BR-43 | Stavka rada ima tri načina obračuna: `hour` (sati × cena/h), `km` (km × cena/km), `flat` (samo iznos). Kod `hour`/`km` iznos se računa iz količine i jedinične cene i ne unosi se ručno; kod `flat` količina i jedinična cena su prazne. Neispravna kombinacija → `LABOR_BILLING_INVALID`. |
| BR-44 | `km` i `flat` stavke rada ne ulaze u zbir sati — ni na dokumentu (BR-26) ni u izveštaju „Po majstoru" (ulaze samo u vrednost rada). |

## 8. Katalog backend grešaka

Model: `{ "code": "...", "message": "...", "fields": { ... }?, "warnings": [ ... ]? }` — `message` na srpskom, `code` mašinski.

| HTTP | Code | Kada |
|---|---|---|
| 400 | `VALIDATION_FAILED` | format/obaveznost polja (`fields` detalji) |
| 401 | `UNAUTHENTICATED` | nema/istekla sesija |
| 403 | `FORBIDDEN` | rola nema pravo (npr. korisnik → Podešavanja, undo akcije) |
| 403 | `CSRF_FAILED` | non-GET zahtev bez ispravnog `X-CSRF-Token` headera (vidi §9) |
| 404 | `NOT_FOUND` | entitet ne postoji |
| 409 | `VERSION_CONFLICT` | optimističko zaključavanje — ponuditi osvežavanje |
| 409 | `DUPLICATE_VIN` / `DUPLICATE_TAX_ID` / `DUPLICATE_EMAIL` | duplikat; odgovor nosi `existingId` za „povuci postojeće" |
| 409 | `CONFIRMATION_REQUIRED` | meka pravila — `warnings`: `MECHANIC_BUSY`, `MECHANIC_UNAVAILABLE`, `OUTSIDE_WORK_HOURS`, `NO_CUSTOMER_EMAIL`; ponoviti sa `confirmed: true` |
| 422 | `TRANSITION_NOT_ALLOWED` | tranzicija van §6 (detalj: iz/u/rola) |
| 422 | `ENTITY_LOCKED` | izmena zaključanog naloga/dokumenta (BR-08, BR-22) |
| 422 | `LABOR_BILLING_INVALID` | stavka rada: `hour`/`km` bez količine ili jedinične cene, odn. `flat` sa njima (BR-43) |
| 422 | `ENTITY_ARCHIVED` | arhiviran klijent/vozilo u novom toku (BR-32) |
| 422 | `QUOTE_NOT_PENDING` | izmena ponude van `pending` |
| 422 | `QUOTE_NOT_ACCEPTED` | vezivanje naloga za ponudu koja nije `accepted` |
| 422 | `QUOTE_EXPIRED` | pokušaj prihvatanja istekle ponude |
| 422 | `ACTIVE_PROFORMA_EXISTS` | drugi `valid` predračun po nalogu — izdavanje ili kopiranje (BR-15, BR-39) |
| 422 | `PROFORMA_NOT_VALID` | konverzija `used`/`expired` predračuna (BR-17) |
| 422 | `INVOICE_NOT_PAID` | admin ispravka plaćanja nad računom koji nije `paid` |
| 422 | `BACKUP_UNUSABLE` | vraćanje iz backupa koji nije uspešno završen |
| 500 | `BACKUP_FAILED` | `pg_dump` nije uspeo (detalj u `backup_run.error`) |
| 500 | `RESTORE_FAILED` | `psql` nije uspeo; baza ostaje netaknuta (vraćanje je u transakciji) |
| 422 | `SMTP_FAILED` | „Pošalji probni mejl" nije uspeo; poruka nosi odgovor mail servera |
| 422 | `WORK_ORDER_CANCELLED` | predračun iz otkazanog naloga (BR-14) |
| 422 | `ACTIVE_INVOICE_EXISTS` | nalog već ima `unpaid`/`paid` račun — novo fakturisanje ili novi predračun blokirani (BR-18, BR-40) |
| 422 | `INVOICE_NOT_UNPAID` | naplata/ispravka računa koji nije `unpaid` |
| 422 | `INVOICE_DIRECT_CREATE_FORBIDDEN` | pokušaj direktnog kreiranja računa |
| 422 | `COPY_NOT_ALLOWED` | pokušaj kopiranja računa — za račun postoji samo „Ispravi račun" (BR-23) |
| 422 | `SNAPSHOT_IMMUTABLE` | izmena stavki izdatog dokumenta (BR-22) |
| 422 | `APPOINTMENT_LINKED` | vraćanje realizovanog termina vezanog za nalog (BR-28) |
| 422 | `APPOINTMENT_STARTED` | brisanje termina koji je počeo (BR-29) |
| 422 | `CALENDAR_BLOCKED` | termin u blokiran dan (BR-27, tvrda blokada) |
| 422 | `REASON_REQUIRED` | admin osetljiva akcija bez razloga (BR-34) |
| 422 | `PHOTO_LIMIT_REACHED` | više od 10 slika po prijemu |
| 404 | `PHOTO_NOT_FOUND` | slika ne postoji ili fajl nije dostupan na disku |

> `NO_CUSTOMER_EMAIL` više nije tvrda greška: uključivanje podsetnika za klijenta bez emaila daje **meko upozorenje** (`CONFIRMATION_REQUIRED`, gornji red), pa se podsetnik „naoruža". Vidi pravila podsetnika u §10.

## 9. API i mapa ekrana

Puna specifikacija: `openapi.yaml` (engleski nazivi, odluka 27). Konvencije: `/api/v1`, cookie sesija, paginacija `?page&pageSize`, sortiranje `?sort=field:asc`, pretraga `?q`, filteri po poljima. **CSRF**: svaki odgovor postavlja/osvežava `XSRF-TOKEN` cookie; svaki non-GET zahtev nosi `X-CSRF-Token` header (neslaganje → 403 `CSRF_FAILED`). **Verzionisanje**: sve mutacione akcije nad verzionisanim agregatima nose `version` (konflikt → 409); akcije bez `version` izvršavaju se transakciono uz row-lock (BR-38).

| Ekran | Glavni endpointi |
|---|---|
| 1. Login | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| 2. Dashboard | `GET /dashboard` (Danas / Posao / Novac agregati) |
| 3. Klijenti (lista) | `GET/POST /customers` |
| 4. Profil klijenta | `GET/PATCH /customers/{id}`, `…/contacts`, `…/archive`, `…/unarchive`, `GET /vehicles?customerId=`, `GET /work-orders?customerId=` |
| 5. Vozila (lista) | `GET/POST /vehicles` (pretraga i po staroj tablici) |
| 6. Vozilo (detalj) | `GET/PATCH /vehicles/{id}`, `…/ownership`, `…/registrations`, `GET /work-orders?vehicleId=`, `GET /documents?vehicleId=` |
| 7. Radni nalozi (lista) | `GET/POST /work-orders` |
| 8. Radni nalog (detalj) | `GET/PATCH /work-orders/{id}`, `POST …/status`, `…/link-quote`, `…/unlink-quote`, `…/proforma`, CRUD `…/labor-items`, `…/part-items`, `…/external-items`, `PATCH …/{itemId}/internal` |
| 9. Kalendar | `GET/POST /appointments`, `PATCH /appointments/{id}`, `POST …/status`, `DELETE …` (budući), `GET/POST /calendar-blocks`, `GET /mechanics` |
| 10. Dokumenti (lista) | `GET /documents?type=&status=`, `POST /documents` (quote/proforma) |
| 11. Dokument (prikaz) | `GET /documents/{id}`, `POST …/accept`, `…/reject`, `…/convert`, `…/mark-paid`, `…/unmark-paid` (A), `…/correct`, `…/copy` (samo ponuda/predračun — BR-23) |
| 12. Cenovnik (tabovi: Majstori, Usluge) | `GET/POST /mechanics`, `PATCH /mechanics/{id}`, `…/unavailabilities`; `GET/POST /services`, `PATCH /services/{id}` |
| 13. Izveštaji | `GET /reports/revenue`, `…/work-orders`, `…/mechanics/{id}`, `…/vehicle-types` (+ `?format=xlsx`), sekcija „Izvoz podataka": `GET /export/all.xlsx` |
| 14. Podešavanja (A) | `GET/PATCH /settings`, `GET/POST/PATCH /users`, `GET /backup/runs`, `POST /backup/restore` |

## 10. Background / scheduler poslovi

| Posao | Ritam | Opis |
|---|---|---|
| `expire-quotes` | dnevno 00:05 (Belgrade) | `pending` ponude sa isteklim rokom → `expired` |
| `expire-proformas` | dnevno 00:05 | `valid` predračuni sa isteklim rokom → `expired` |
| `send-reminders` | na 1–5 min | dospeli podsetnici `scheduled` → `processing` (`FOR UPDATE SKIP LOCKED`) → slanje → `sent`/`failed`; uslovi BR-30 u trenutku slanja |
| `retry-reminders` | isti ciklus | `failed` sa pokušaji < 5 → `scheduled` po backoff rasporedu (5/15/60 min) |
| `daily-backup` | dnevno (podešavanje) | `pg_dump` → lokalno i/ili off-site; upis u `backup_run` (uspeh/neuspeh, trajanje, veličina); retencija |

Upis podsetnika (`appointment_reminder` zapisi) dešava se pri kreiranju/izmeni termina — nije scheduler posao.

## 11. Audit događaji (v1)

| Događaj | Okidač | Razlog obavezan |
|---|---|---|
| `work_order.reopened` | `completed`/`cancelled` → aktivan status (A) | da |
| `work_order.completed_on_changed` | korekcija datuma završetka | da (admin), ne (korisnik u dozvoljenom opsegu) |
| `invoice.unmarked_paid` | `paid` → `unpaid` (A) | da |
| `invoice.payment_changed` | korekcija datuma/načina plaćanja (A) | da |
| `invoice.voided` | „Ispravi račun" | ne (napomena opciona) |
| `appointment.corrected` | admin korekcija statusa/veze termina | da |
| `customer.archived` / `.unarchived`, `vehicle.archived` / `.unarchived` | arhiviranje | ne |
| `document.copied`, `document.converted` | kopija / konverzija | ne |
| `settings.changed`, `user.created` / `.updated` | administracija | ne |

## 12. Ekrani i dorade mockupa (odluka 34)

Postojeći mockup je dizajn osnova — ne radi se iz početka. Dorade pri implementaciji: (1) „Fakture" → „Dokumenti"; (2) Dashboard grupisan: Danas / Posao / Novac; (3) Radni nalog istaknut kao centralni ekran; (4) jasno odvojeni rad majstora / delovi / eksterni servis / dokumenti / ukupni iznosi; (5) dokument traka sa brojem i statusom (Ponuda · RN · Predračun · Račun); aktivna dugmad vode na entitet, onemogućena jasno pokazuju da dokument ne postoji; (6) mobilne tabele → kartice; (7) „Dospeo" samo kao izvedena UI oznaka; (8) opcija „Interno — ne naplaćuje se"; (9) status slanja podsetnika na terminu; (10) istorija tablica na detalju vozila. Dodatno iz ranijih odluka: login ekran, izveštaj „Po tipu vozila", forme (blokiranje dana, brisanje termina, telefon/email, potvrda restore-a), polje „Trajanje" na terminu, dugme „Nalozi (N)" na ponudi, broj naloga `RN-`, self-host fontova. Dodato 9.7.2026 (po Mariovom papirnom obrascu ver. 5): na ekranu naloga polja „zahtevani radovi" (pri prijemu), „utvrđeno stanje" (unosi se tokom rada), „napomena" i opciona vremena prijema/predaje; A4 prijemni list (§4.4): tabela za ručni upis radova, skica oštećenja (iz Mariovog obrasca), kontrola vozila sa nivoom goriva, dva potpisa klijenta (predaja sa rečenicom saglasnosti i povrat), QR kod naloga u zaglavlju. PWA: ikonica aplikacije i boje za manifest (potrebno od dizajnera uz konačni logo). Sekcija „Izvoz podataka" na ekranu Izveštaji sa jednim dugmetom „Izvezi sve u Excel" (cela baza u jednom fajlu — §4.18). Čekboks „Izlazak na teren" na formi naloga koji otvara grupu polja (isti obrazac kao „podsetnici on/off"); u formi „Dodaj rad" izbor načina obračuna (Po satu / Po kilometru / Paušalno) sa uslovnim poljima i računatim iznosom; ekran Cenovnik dobija tabove Majstori i Usluge; blok „Izlazak na teren" na prijemnom listu.

## 13. Konflikti i primenjena rešenja

| # | Konflikt | Rešenje (novija odluka važi) |
|---|---|---|
| K1 | Broj naloga `N-2026-0001` (spec v3, ER, mockup) vs `RN-2026-0001` (odluke 5/16) | **RN-** svuda; ER/SQL/OpenAPI ažurirani; mockup dorada; docx dobio napomenu 7.12 |
| K2 | „Isti naziv u bazi, kodu i UI-u" (spec v3 §2) vs engleski kod/baza/API + srpski UI (odluka 27) | Mapiranje §3 i §5; ER/SQL/OpenAPI na engleskom; UI srpski |
| K3 | Status podsetnika `nije_zakazano` (spec/ER) vs 4 statusa (odluka 19) | `nije_zakazano` ukinut — predstavlja se sa `reminders_enabled=false` ili nepostojanjem zapisa |
| K4 | Istorija izmena „faza 2 / minimalni log" (spec v3 §1) vs obavezan audit log (odluka 22) | `audit_log` tabela + upis u **v1**; UI pregled u fazi 2 |
| K5 | Ranije razmatrana akcija „Osveži iz naloga" vs odluka 11 (ne uvoditi) | Nema osvežavanja — čist snapshot + „Kopiraj" |
| K6 | `tehnicka-preporuka.md` — srpski API nacrt | Zamenjen engleskim; detalji u `openapi.yaml` |
| K7 | Mockup: navigacija „Fakture", broj `N-`, bez trajanja termina | Stavke dorada u §12 |
| K8 | Spec v3: „poslednji upis pobeđuje" | Već zamenjeno (dopuna 7.8): `version` + 409 za kritične operacije |
| K9 | Unique indeks blokirao samo dva `unpaid` računa — `paid` + novi `unpaid` je prolazio (višestruko fakturisanje) | Indeks proširen: najviše jedan račun `unpaid`/`paid` po nalogu (`uq_active_invoice_per_order`); `voided` ne blokira; BR-18 ažuriran |
| K10 | „Kopiraj (svi tipovi)" omogućavao kopiranje računa mimo lanca „račun samo iz predračuna" | Kopiranje samo za ponudu i predračun (BR-23); račun → `COPY_NOT_ALLOWED`; ostaje „Ispravi račun" |
| K11 | Kopija `valid` predračuna kršila pravilo jednog aktivnog; novi predračun bio moguć uz aktivan račun | BR-39 i BR-40; jedini izuzetak je transakcioni tok „Ispravi račun" (`voided` → novi `valid`, `correction_of`) |
| K12 | `source_document_id` semantički preširok; ER prikazivao termin↔nalog kao 1:1, SQL dozvoljavao 1:N | Dodat `source_relation_type` (`copied_from`/`converted_from`/`correction_of`) sa CHECK parom; usvojena kardinalnost nalog 1:N termin |
| K13 | `DocumentInput` sugerisao nedozvoljene izmene na `valid` predračunu; nedostajali `document.note`, CSRF ugovor u API-ju, `citext` ekstenzija, singleton `settings`, session tabela | Razdvojeni `CreateQuoteInput`/`CreateProformaInput`/`UpdatePendingQuoteInput`/`UpdateValidProformaInput`; dodat `note`; CSRF definisan u `openapi.yaml`; `CREATE EXTENSION citext`; `settings CHECK (id=1)`; infrastrukturna `session` tabela u DDL-u |

Nijedna od primenjenih odluka nema tehničku prepreku ni bezbednosni/arhitektonski rizik.
