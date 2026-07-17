-- Reklamacije + rok za delove.

-- Reklamacija je NOV nalog vezan za stari. Stari je završen (ima svoj račun i snapshot),
-- ne dira se — pa se problem vodi kao nov nalog sa vezom unazad. Postojanje veze = reklamacija;
-- posebna zastavica ne treba (garancija/naplata se vidi po tome ima li stavki).
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS source_work_order_id int REFERENCES work_order(id);

-- Nalog ne može biti reklamacija samog sebe.
ALTER TABLE work_order DROP CONSTRAINT IF EXISTS work_order_not_self_reklamacija;
ALTER TABLE work_order ADD CONSTRAINT work_order_not_self_reklamacija
  CHECK (source_work_order_id IS NULL OR source_work_order_id <> id);

CREATE INDEX IF NOT EXISTS ix_work_order_source_wo ON work_order (source_work_order_id);

-- „Čeka delove": kad se očekuju i kratka napomena (npr. „naručeno kod Bosch-a").
-- Dve odvojene kolone — datum je za sortiranje i upozorenje kad probije rok, napomena je tekst.
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS parts_expected_on date;
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS parts_note text;
