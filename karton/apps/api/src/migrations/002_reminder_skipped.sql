-- Novi terminalni ishod podsetnika: "skipped" (preskočen).
-- Koristi ga worker kada u trenutku slanja klijent nema email (ili je termin u
-- međuvremenu otkazan/realizovan). Razlika od "failed": nije greška slanja, nego
-- svesno preskakanje — i sprečava zakašnjelo slanje ako se email doda posle vremena
-- (pravila podsetnika, tačke 4–6).
ALTER TYPE reminder_send_status ADD VALUE IF NOT EXISTS 'skipped';
