-- Fotografije vozila pri prijemu (dokaz stanja — zaštita od reklamacija).
-- Sam fajl živi na disku (UPLOADS_DIR), u bazi je samo metapodatak:
--   uploads/vozila/<VIN>/<datum>_<RN-broj>/<uuid>.jpg
-- VIN je ključ foldera jer je nepromenljiv (BR-01); tablica bi se menjala i razbila folder.
-- Limit (max 10 po nalogu) i zaključavanje posle završetka naloga rešeni su u aplikaciji.
CREATE TABLE work_order_photo (
    id            serial PRIMARY KEY,
    work_order_id int         NOT NULL REFERENCES work_order(id) ON DELETE CASCADE,
    file_path     text        NOT NULL,   -- relativna putanja UNUTAR UPLOADS_DIR
    mime          text        NOT NULL,
    size_bytes    int         NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    int REFERENCES app_user(id)
);

CREATE INDEX ix_photo_work_order ON work_order_photo (work_order_id);
