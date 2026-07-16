-- Ograničenje pokušaja prijave (spec §6).
--
-- Zaključava se UREĐAJ KOJI POGAĐA (IP adresa), ne nalog. Namerno:
-- da zaključavamo nalog, svako ko zna korisničko ime mogao bi da drži Marija
-- trajno napolju — zaštita bi postala oružje protiv njega.
--
-- Brojač se sam poništava posle prozora mirovanja; zaključavanje ističe samo od sebe,
-- a admin može da pusti ranije.
CREATE TABLE login_throttle (
    ip           text PRIMARY KEY,
    failed_count int NOT NULL DEFAULT 0,
    locked_until timestamptz,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Za povremeno čišćenje starih zapisa i prikaz zaključanih adresa adminu.
CREATE INDEX login_throttle_locked_idx ON login_throttle (locked_until) WHERE locked_until IS NOT NULL;
