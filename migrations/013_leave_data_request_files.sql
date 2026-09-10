-- Racona Work Plugin - Igazolások az adatbejelentésekhez
--
-- A dolgozó igazolást csatolhat a bejelentéséhez (pl. születési anyakönyvi
-- kivonat, orvosi igazolás). A core nem ad fájltárolót a pluginoknak, ezért a
-- fájl a plugin sémájában, bytea-ként tárolódik. Csak a feltöltő és a HR
-- (leave.balance.manage) éri el.
--
-- Megőrzés: elutasításkor és visszavonáskor a fájlok törlődnek; jóváhagyás
-- után megmaradnak (a pótszabadság jogalapjának bizonyítéka), amíg a HR nem
-- törli őket. Részletek: specs/leave-entitlement.md

CREATE TABLE IF NOT EXISTS app__racona_work.leave_data_request_files (
    id          SERIAL PRIMARY KEY,
    request_id  INTEGER NOT NULL REFERENCES app__racona_work.leave_data_requests(id) ON DELETE CASCADE,
    file_name   VARCHAR(255) NOT NULL,
    mime_type   VARCHAR(100) NOT NULL
        CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
    -- Legfeljebb 4 MB (a remote hívás base64-ben megy, a core kéréskorlátja miatt)
    size_bytes  INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 4194304),
    content     BYTEA NOT NULL,
    uploaded_by INTEGER REFERENCES auth.users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_data_request_files_request
    ON app__racona_work.leave_data_request_files(request_id);
