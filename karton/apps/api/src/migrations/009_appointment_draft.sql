-- Nepotpun termin: sme da se zakaže samo sa UPISANIM imenom klijenta i vozila (tekst),
-- bez pravljenja pravih zapisa. Kasnije se „sredi" — poveže sa pravim klijentom/vozilom,
-- a upisani tekst se tada briše.
ALTER TABLE appointment ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE appointment ALTER COLUMN vehicle_id DROP NOT NULL;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS customer_text text;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS vehicle_text text;

-- Svaka strana mora da ima ILI vezu (id) ILI tekst — ne sme da bude prazna.
ALTER TABLE appointment DROP CONSTRAINT IF EXISTS appointment_customer_present;
ALTER TABLE appointment ADD CONSTRAINT appointment_customer_present
  CHECK (customer_id IS NOT NULL OR customer_text IS NOT NULL);
ALTER TABLE appointment DROP CONSTRAINT IF EXISTS appointment_vehicle_present;
ALTER TABLE appointment ADD CONSTRAINT appointment_vehicle_present
  CHECK (vehicle_id IS NOT NULL OR vehicle_text IS NOT NULL);
