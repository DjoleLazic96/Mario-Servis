-- Poreska napomena u podnožju dokumenta.
--
-- Zašto u bazi a ne u kodu: ako servis pređe prag i UĐE u sistem PDV-a, tekst
-- „nije obveznik PDV-a" postaje netačan na svakom novom računu. Ovako ga vlasnik
-- (ili njegov knjigovođa) ispravi sam u Podešavanjima, bez izmene koda i deploya.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_note text;

UPDATE settings
SET footer_note = 'MARIO NOVAKOVIĆ PREDUZETNIK AUTOMEHANIČARSKA RADNJA MARIO S23 BEOGRAD (ZEMUN) nije obveznik PDV-a po članu 33 Zakona o PDV.'
WHERE footer_note IS NULL;
