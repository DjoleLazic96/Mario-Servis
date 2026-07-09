-- =====================================================================
-- Karton — predlog PostgreSQL šeme (v4.0, 8.7.2026)
-- Prati: specifikacija-finalna.md + er-dijagram.mermaid
-- Konvencije: engleski nazivi (odluka 27); timestampi UTC (timestamptz);
-- poslovna logika Europe/Belgrade u aplikaciji (odluka 26).
-- =====================================================================

-- ---------- Ekstenzije ----------
CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive email (app_user)

-- ---------- ENUM tipovi ----------
CREATE TYPE customer_type        AS ENUM ('individual', 'company');
CREATE TYPE archive_status       AS ENUM ('active', 'archived');
CREATE TYPE mechanic_status      AS ENUM ('active', 'inactive');
CREATE TYPE mechanic_specialty   AS ENUM ('mechanical', 'electrical', 'other');
CREATE TYPE unavailability_kind  AS ENUM ('vacation', 'sick_leave');
CREATE TYPE contact_kind         AS ENUM ('phone', 'email');
CREATE TYPE work_order_status    AS ENUM ('open', 'in_progress', 'waiting_parts', 'completed', 'cancelled');
CREATE TYPE document_type        AS ENUM ('quote', 'proforma', 'invoice');
CREATE TYPE document_status      AS ENUM (
    'pending', 'accepted', 'rejected', 'expired',  -- quote
    'valid', 'used',                               -- proforma (+ expired)
    'unpaid', 'paid', 'voided'                     -- invoice
);
CREATE TYPE appointment_status   AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');
CREATE TYPE reminder_send_status AS ENUM ('scheduled', 'processing', 'sent', 'failed');
CREATE TYPE document_item_type   AS ENUM ('labor', 'part', 'external');
CREATE TYPE user_role            AS ENUM ('admin', 'user');
CREATE TYPE user_status          AS ENUM ('active', 'disabled');
CREATE TYPE sequence_doc_type    AS ENUM ('quote', 'work_order', 'proforma', 'invoice');
CREATE TYPE backup_kind          AS ENUM ('local', 'cloud', 'both');
CREATE TYPE backup_run_status    AS ENUM ('success', 'failed');
CREATE TYPE document_relation_type AS ENUM ('copied_from', 'converted_from', 'correction_of');
CREATE TYPE labor_billing_unit   AS ENUM ('hour', 'km', 'flat');                 -- BR-43
CREATE TYPE service_status       AS ENUM ('active', 'inactive');
CREATE TYPE field_visit_outcome  AS ENUM ('solved_on_site', 'arrives_driving', 'arrives_towed', 'customer_declined');

-- ---------- Korisnici (prvo, zbog created_by FK) ----------
CREATE TABLE app_user (
    id            serial PRIMARY KEY,
    name          text        NOT NULL,
    email         citext      NOT NULL UNIQUE,          -- case-insensitive (citext)
    password_hash text        NOT NULL,                 -- argon2id
    role          user_role   NOT NULL DEFAULT 'user',
    status        user_status NOT NULL DEFAULT 'active',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- Klijenti ----------
CREATE TABLE customer (
    id         serial PRIMARY KEY,
    type       customer_type  NOT NULL,
    name       text           NOT NULL,
    tax_id     text,                                    -- PIB (company, obavezan) / JMBG (individual, opcion)
    address    text,
    status     archive_status NOT NULL DEFAULT 'active',
    created_at timestamptz    NOT NULL DEFAULT now(),
    updated_at timestamptz    NOT NULL DEFAULT now(),
    created_by int REFERENCES app_user(id),
    CONSTRAINT company_requires_tax_id CHECK (type <> 'company' OR tax_id IS NOT NULL)
);
-- duplikat samo kada je vrednost uneta (BR-04)
CREATE UNIQUE INDEX uq_customer_tax_id ON customer (tax_id) WHERE tax_id IS NOT NULL;

CREATE TABLE customer_contact (
    id          serial PRIMARY KEY,
    customer_id int          NOT NULL REFERENCES customer(id),
    kind        contact_kind NOT NULL,
    value       text         NOT NULL,
    is_primary  boolean      NOT NULL DEFAULT false,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    created_by  int REFERENCES app_user(id)
);
CREATE INDEX ix_contact_customer ON customer_contact (customer_id);

-- ---------- Vozila i istorije ----------
CREATE TABLE vehicle (
    id         serial PRIMARY KEY,
    vin        text           NOT NULL UNIQUE,          -- BR-01
    make       text           NOT NULL,
    model      text           NOT NULL,
    year       int,
    fuel       text,
    note       text,
    status     archive_status NOT NULL DEFAULT 'active',
    created_at timestamptz    NOT NULL DEFAULT now(),
    updated_at timestamptz    NOT NULL DEFAULT now(),
    created_by int REFERENCES app_user(id)
);

CREATE TABLE ownership_history (
    id          serial PRIMARY KEY,
    vehicle_id  int  NOT NULL REFERENCES vehicle(id),
    customer_id int  NOT NULL REFERENCES customer(id),
    valid_from  date NOT NULL,
    valid_to    date,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  int REFERENCES app_user(id),
    CONSTRAINT ownership_period CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
-- najviše jedan aktivan vlasnik po vozilu (BR-02)
CREATE UNIQUE INDEX uq_active_owner ON ownership_history (vehicle_id) WHERE valid_to IS NULL;

CREATE TABLE registration_history (
    id         serial PRIMARY KEY,
    vehicle_id int  NOT NULL REFERENCES vehicle(id),
    plate      text NOT NULL,
    valid_from date NOT NULL,
    valid_to   date,
    note       text,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by int REFERENCES app_user(id),
    CONSTRAINT registration_period CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX uq_active_plate ON registration_history (vehicle_id) WHERE valid_to IS NULL;
CREATE INDEX ix_registration_plate ON registration_history (plate);  -- pretraga i po staroj tablici (BR-03)

-- ---------- Majstori ----------
CREATE TABLE mechanic (
    id          serial PRIMARY KEY,
    full_name   text               NOT NULL,
    hired_on    date,
    hourly_rate numeric(10,2)      NOT NULL,
    specialty   mechanic_specialty NOT NULL,
    status      mechanic_status    NOT NULL DEFAULT 'active',
    created_at  timestamptz        NOT NULL DEFAULT now(),
    updated_at  timestamptz        NOT NULL DEFAULT now(),
    created_by  int REFERENCES app_user(id)
);

CREATE TABLE mechanic_unavailability (
    id          serial PRIMARY KEY,
    mechanic_id int                 NOT NULL REFERENCES mechanic(id),
    from_date   date                NOT NULL,
    to_date     date                NOT NULL,
    kind        unavailability_kind NOT NULL,
    created_at  timestamptz         NOT NULL DEFAULT now(),
    created_by  int REFERENCES app_user(id)
);

-- ---------- Cenovnik usluga (paušal / po km) ----------
CREATE TABLE service_catalog (
    id            serial PRIMARY KEY,
    name          text               NOT NULL,               -- npr. 'Izlazak na teren', 'Dijagnostika'
    billing_unit  labor_billing_unit NOT NULL,               -- 'km' ili 'flat'
    default_price numeric(10,2)      NOT NULL,               -- cena/km ili paušalni iznos; na nalogu samo predlog (BR-07)
    status        service_status     NOT NULL DEFAULT 'active',
    created_at    timestamptz        NOT NULL DEFAULT now(),
    updated_at    timestamptz        NOT NULL DEFAULT now(),
    created_by    int REFERENCES app_user(id),
    -- satni rad ide preko cenovnika majstora, ne kroz cenovnik usluga
    CONSTRAINT service_unit_not_hour CHECK (billing_unit <> 'hour')
);

-- ---------- Numeracija (BR-24) ----------
CREATE TABLE number_sequence (
    doc_type    sequence_doc_type NOT NULL,
    year        int               NOT NULL,
    last_number int               NOT NULL DEFAULT 0,
    PRIMARY KEY (doc_type, year)
);
-- Upotreba: u istoj transakciji kao INSERT —
--   UPDATE number_sequence SET last_number = last_number + 1
--   WHERE doc_type = $1 AND year = $2 RETURNING last_number;
-- (red se implicitno zaključava; ako ne postoji, INSERT ... ON CONFLICT DO UPDATE)

-- ---------- Dokumenti ----------
CREATE TABLE document (
    id                 serial PRIMARY KEY,
    number             text            NOT NULL UNIQUE,  -- P-/PR-/R-GGGG-NNNN
    type               document_type   NOT NULL,
    work_order_id      int,                              -- FK dodat posle work_order (cirkularna veza)
    customer_id        int             NOT NULL REFERENCES customer(id),
    vehicle_id         int             NOT NULL REFERENCES vehicle(id),
    issued_on          date            NOT NULL,
    due_on             date,                             -- samo invoice
    valid_until        date,                             -- quote i proforma; uključiv (BR-25)
    status             document_status NOT NULL,
    paid_on            date,
    payment_method     text,
    source_document_id int REFERENCES document(id),      -- UVEK na novonastalom dokumentu; pokazuje UNAZAD na izvor
    source_relation_type document_relation_type,         -- copied_from (kopiran iz) / converted_from (konvertovan iz) / correction_of (korekcija u odnosu na)
    note               text,                             -- napomena; na valid predračunu editabilna
    amount_eur         numeric(12,2),                    -- informativno, ne na invoice
    version            int             NOT NULL DEFAULT 1,
    created_at         timestamptz     NOT NULL DEFAULT now(),
    updated_at         timestamptz     NOT NULL DEFAULT now(),
    created_by         int REFERENCES app_user(id),
    -- status mora pripadati tipu (spec §5)
    CONSTRAINT status_matches_type CHECK (
        (type = 'quote'    AND status IN ('pending','accepted','rejected','expired')) OR
        (type = 'proforma' AND status IN ('valid','used','expired')) OR
        (type = 'invoice'  AND status IN ('unpaid','paid','voided'))
    ),
    CONSTRAINT proforma_invoice_require_order CHECK (type = 'quote' OR work_order_id IS NOT NULL),
    CONSTRAINT invoice_no_eur CHECK (type <> 'invoice' OR amount_eur IS NULL),
    CONSTRAINT paid_requires_date CHECK (status <> 'paid' OR paid_on IS NOT NULL),
    CONSTRAINT source_relation_pair CHECK ((source_document_id IS NULL) = (source_relation_type IS NULL))
);
CREATE INDEX ix_document_type_status ON document (type, status);
CREATE INDEX ix_document_customer ON document (customer_id);
CREATE INDEX ix_document_vehicle ON document (vehicle_id);

CREATE TABLE document_item (
    id           serial PRIMARY KEY,
    document_id  int                NOT NULL REFERENCES document(id),
    item_type    document_item_type NOT NULL,
    name         text               NOT NULL,
    quantity     numeric(10,2),                 -- NULL kod paušalne stavke rada (BR-26)
    unit_price   numeric(10,2),                 -- NULL kad grupa rada nema jedinstvenu cenu, i kod paušala
    amount       numeric(12,2)      NOT NULL,
    labor_group  mechanic_specialty,            -- samo za satne stavke rada (grupisanje po specijalnosti)
    billing_unit labor_billing_unit,            -- snapshot načina obračuna; samo za item_type = 'labor'
    created_at   timestamptz        NOT NULL DEFAULT now()
);
CREATE INDEX ix_document_item_doc ON document_item (document_id);

-- ---------- Radni nalozi ----------
CREATE TABLE work_order (
    id                  serial PRIMARY KEY,
    number              text              NOT NULL UNIQUE,  -- RN-GGGG-NNNN (K1: ranije N-)
    vehicle_id          int               NOT NULL REFERENCES vehicle(id),
    customer_id         int               NOT NULL REFERENCES customer(id),
    received_on         date              NOT NULL,
    received_time       time,                              -- vreme prijema vozila (opciono)
    completed_on        date,
    completed_time      time,                              -- vreme predaje vozila (opciono)
    completed_on_manual boolean           NOT NULL DEFAULT false,
    odometer_km         int,
    requested_work      text,                              -- zahtevani radovi — sve što klijent traži i prijavljuje pri prijemu
    findings            text,                              -- utvrđeno stanje — nalaz majstora, unosi se tokom rada
    note                text,
    -- Izlazak na teren (BR-41, BR-42) — polja postoje samo kad je field_visit = true
    field_visit          boolean NOT NULL DEFAULT false,
    field_visit_date     date,
    field_visit_time     time,
    field_visit_location text,
    field_visit_km       int,                              -- pređeni km servisnog vozila, ukupno (oba pravca); NIJE odometer_km
    vehicle_drivable     boolean,
    field_visit_outcome  field_visit_outcome,              -- rešeno na terenu / točkovi / šlep / klijent odustao
    status              work_order_status NOT NULL DEFAULT 'open',
    source_quote_id     int REFERENCES document(id),        -- 1 ponuda → više naloga (BR-11)
    version             int               NOT NULL DEFAULT 1,
    created_at          timestamptz       NOT NULL DEFAULT now(),
    updated_at          timestamptz       NOT NULL DEFAULT now(),
    created_by          int REFERENCES app_user(id),
    -- bez štikliranog izlaska sva prateća polja moraju biti prazna (BR-41)
    CONSTRAINT field_visit_fields CHECK (
        field_visit OR (
            field_visit_date IS NULL AND field_visit_time IS NULL AND field_visit_location IS NULL
            AND field_visit_km IS NULL AND vehicle_drivable IS NULL AND field_visit_outcome IS NULL
        )
    )
);
CREATE INDEX ix_work_order_vehicle ON work_order (vehicle_id);
CREATE INDEX ix_work_order_customer ON work_order (customer_id);
CREATE INDEX ix_work_order_status ON work_order (status);

ALTER TABLE document
    ADD CONSTRAINT fk_document_work_order FOREIGN KEY (work_order_id) REFERENCES work_order(id);
-- najviše jedan aktivan predračun po nalogu (BR-15)
CREATE UNIQUE INDEX uq_active_proforma_per_order ON document (work_order_id)
    WHERE type = 'proforma' AND status = 'valid';
-- najviše jedan ne-voided račun (unpaid ILI paid) po nalogu — bez višestrukog
-- fakturisanja istog posla (BR-18); istorijski voided računi ne blokiraju ispravku
CREATE UNIQUE INDEX uq_active_invoice_per_order ON document (work_order_id)
    WHERE type = 'invoice' AND status IN ('unpaid', 'paid');
-- BR-40: novi predračun je zabranjen dok nalog ima unpaid/paid račun — sprovodi
-- backend transakciono; izuzetak je tok "Ispravi račun" koji u ISTOJ transakciji
-- prevodi unpaid račun u voided pa kreira korektivni valid predračun (correction_of).

-- ---------- Stavke naloga ----------
CREATE TABLE labor_item (
    id            serial PRIMARY KEY,
    work_order_id int                NOT NULL REFERENCES work_order(id),
    mechanic_id   int                NOT NULL REFERENCES mechanic(id),   -- majstor obavezan u sva tri načina (BR-07)
    service_id    int REFERENCES service_catalog(id),                    -- opciono: usluga iz cenovnika (izveštaji)
    name          text               NOT NULL,
    billing_unit  labor_billing_unit NOT NULL DEFAULT 'hour',            -- hour / km / flat (BR-43)
    quantity      numeric(10,2),     -- sati ili kilometri; NULL kod flat
    unit_price    numeric(10,2),     -- cena/h ili cena/km; NULL kod flat; zamrznuta u trenutku unosa
    amount        numeric(12,2)      NOT NULL,   -- hour/km: quantity × unit_price (računa backend); flat: ručni unos
    created_at    timestamptz        NOT NULL DEFAULT now(),
    updated_at    timestamptz        NOT NULL DEFAULT now(),
    created_by    int REFERENCES app_user(id),
    -- BR-43; neispravna kombinacija → LABOR_BILLING_INVALID
    CONSTRAINT labor_billing CHECK (
        (billing_unit = 'flat' AND quantity IS NULL AND unit_price IS NULL)
        OR (billing_unit IN ('hour','km') AND quantity IS NOT NULL AND unit_price IS NOT NULL)
    )
);
CREATE INDEX ix_labor_item_order ON labor_item (work_order_id);

CREATE TABLE part_item (
    id                 serial PRIMARY KEY,
    work_order_id      int           NOT NULL REFERENCES work_order(id),
    name               text          NOT NULL,
    quantity           numeric(10,2) NOT NULL,
    unit_price         numeric(10,2) NOT NULL,
    amount             numeric(12,2) NOT NULL,
    internal_no_charge boolean       NOT NULL DEFAULT false,  -- BR-09
    created_at         timestamptz   NOT NULL DEFAULT now(),
    updated_at         timestamptz   NOT NULL DEFAULT now(),
    created_by         int REFERENCES app_user(id)
);
CREATE INDEX ix_part_item_order ON part_item (work_order_id);

CREATE TABLE external_service_item (
    id                 serial PRIMARY KEY,
    work_order_id      int           NOT NULL REFERENCES work_order(id),
    vendor_name        text          NOT NULL,
    description        text,
    price              numeric(12,2) NOT NULL,
    note               text,
    internal_no_charge boolean       NOT NULL DEFAULT false,  -- BR-09
    created_at         timestamptz   NOT NULL DEFAULT now(),
    updated_at         timestamptz   NOT NULL DEFAULT now(),
    created_by         int REFERENCES app_user(id)
);
CREATE INDEX ix_external_item_order ON external_service_item (work_order_id);

-- ---------- Termini i podsetnici ----------
CREATE TABLE appointment (
    id                serial PRIMARY KEY,
    date              date               NOT NULL,
    time              time               NOT NULL,
    duration_min      int                NOT NULL DEFAULT 60,
    customer_id       int                NOT NULL REFERENCES customer(id),
    vehicle_id        int                NOT NULL REFERENCES vehicle(id),
    mechanic_id       int REFERENCES mechanic(id),
    note              text,
    status            appointment_status NOT NULL DEFAULT 'scheduled',
    work_order_id     int REFERENCES work_order(id),
    reminders_enabled boolean            NOT NULL DEFAULT true,
    version           int                NOT NULL DEFAULT 1,
    created_at        timestamptz        NOT NULL DEFAULT now(),
    updated_at        timestamptz        NOT NULL DEFAULT now(),
    created_by        int REFERENCES app_user(id)
);
CREATE INDEX ix_appointment_date ON appointment (date);
CREATE INDEX ix_appointment_mechanic ON appointment (mechanic_id, date);

CREATE TABLE appointment_reminder (
    id                serial PRIMARY KEY,
    appointment_id    int                  NOT NULL REFERENCES appointment(id) ON DELETE CASCADE,
    offset_min        int                  NOT NULL,
    scheduled_send_at timestamptz          NOT NULL,
    send_status       reminder_send_status NOT NULL DEFAULT 'scheduled',
    attempt_count     int                  NOT NULL DEFAULT 0,
    last_attempt_at   timestamptz,
    last_error        text,
    sent_at           timestamptz,
    created_at        timestamptz          NOT NULL DEFAULT now()
);
-- worker: WHERE send_status='scheduled' AND scheduled_send_at <= now() FOR UPDATE SKIP LOCKED
CREATE INDEX ix_reminder_due ON appointment_reminder (scheduled_send_at) WHERE send_status = 'scheduled';

CREATE TABLE calendar_block (
    id         serial PRIMARY KEY,
    from_date  date NOT NULL,
    to_date    date NOT NULL,
    reason     text,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by int REFERENCES app_user(id)
);

-- ---------- Podešavanja ----------
CREATE TABLE settings (
    id                    int PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton: tačno jedan red
    shop_name             text NOT NULL,
    address               text,
    tax_id                text,
    phone                 text,
    logo                  text,                 -- putanja/URL uploada
    smtp_host             text,
    smtp_port             int,
    smtp_username         text,
    smtp_password         text,                 -- šifrovano na aplikativnom nivou
    sender_email          text,
    work_hours_from       time NOT NULL DEFAULT '08:00',
    work_hours_to         time NOT NULL DEFAULT '18:00',
    default_validity_days int  NOT NULL DEFAULT 15,     -- BR-25
    reminder_send_time    time NOT NULL DEFAULT '09:00',
    page_size             int  NOT NULL DEFAULT 20,
    version               int  NOT NULL DEFAULT 1,
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reminder_config (
    id          serial PRIMARY KEY,
    settings_id int NOT NULL REFERENCES settings(id),
    offset_min  int NOT NULL                     -- npr. 1440 = dan pre
);

-- ---------- Audit log (BR-34) ----------
CREATE TABLE audit_log (
    id          bigserial PRIMARY KEY,
    user_id     int         NOT NULL REFERENCES app_user(id),
    entity_type text        NOT NULL,
    entity_id   int         NOT NULL,
    action      text        NOT NULL,            -- spec §11
    old_value   jsonb,
    new_value   jsonb,
    reason      text,                            -- obavezan za osetljive admin akcije (aplikativno)
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_entity ON audit_log (entity_type, entity_id);
CREATE INDEX ix_audit_created ON audit_log (created_at);
-- Napomena: aplikativni sloj ne sme imati UPDATE/DELETE nad audit_log
-- (REVOKE UPDATE, DELETE ON audit_log FROM app_role;)

-- ---------- Backup ----------
CREATE TABLE backup_config (
    id          serial PRIMARY KEY,
    kind        backup_kind NOT NULL DEFAULT 'both',
    destination text,
    frequency   text NOT NULL DEFAULT 'daily',
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE backup_run (
    id          serial PRIMARY KEY,
    started_at  timestamptz       NOT NULL,
    finished_at timestamptz,
    status      backup_run_status NOT NULL,
    destination text,
    size_bytes  bigint,
    error       text
);

-- ---------- Sesije (infrastrukturno — nije deo domenskog ER modela) ----------
-- Šema kompatibilna sa connect-pg-simple; ako izabrani session store sam
-- kreira/migrira svoju tabelu, ovaj DDL se preskače.
CREATE TABLE IF NOT EXISTS "session" (
    sid    varchar     PRIMARY KEY,
    sess   json        NOT NULL,
    expire timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_session_expire ON "session" (expire);
