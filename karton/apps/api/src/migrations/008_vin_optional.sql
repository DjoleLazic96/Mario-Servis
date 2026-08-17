-- VIN više nije obavezan u bazi — da bi zakazivanje moglo sa minimumom (ime klijenta
-- + marka/model), a VIN/tablica se dopune kasnije. Sve što se čita preko veze na vozilo
-- (nalozi, dokumenti, prijemni list, spiskovi) automatski povuče VIN kad se upiše.
--
-- VIN OSTAJE JEDINSTVEN kada je popunjen: UNIQUE indeks dozvoljava više NULL vrednosti,
-- pa je dozvoljeno više vozila bez VIN-a, ali ne dva sa istim VIN-om.
-- U samoj formi „Novo vozilo" VIN je i dalje obavezan (pravilo na klijentu); opušta se
-- samo u zakazivanju.
ALTER TABLE vehicle ALTER COLUMN vin DROP NOT NULL;
