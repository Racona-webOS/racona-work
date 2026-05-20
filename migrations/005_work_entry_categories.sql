-- Racona Work Plugin - Munkabejegyzés kategóriák
-- A work_entries táblához category_id külső kulcs hozzáadása.

-- ============================================================================
-- 1. MUNKABEJEGYZÉS KATEGÓRIÁK (WORK_ENTRY_CATEGORIES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app__racona_work.work_entry_categories (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    sort_order  SMALLINT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_entry_categories_sort
    ON app__racona_work.work_entry_categories (sort_order ASC, id ASC);

-- ============================================================================
-- 2. KATEGÓRIA OSZLOP A MUNKABEJEGYZÉSEKHEZ
-- ============================================================================

ALTER TABLE app__racona_work.work_entries
    ADD COLUMN IF NOT EXISTS category_id INTEGER
        REFERENCES app__racona_work.work_entry_categories(id)
        ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_entries_category_id
    ON app__racona_work.work_entries(category_id);

-- ============================================================================
-- 3. ALAP KATEGÓRIÁK SEEDELÉSE (idempotens)
-- ============================================================================

INSERT INTO app__racona_work.work_entry_categories (name, sort_order) VALUES
    ('Projektvezető (medior)',                                              10),
    ('Konzulens / tanácsadó / szakértő',                                   20),
    ('Üzleti elemző',                                                       30),
    ('Architekt / rendszertervező',                                         40),
    ('Szoftverfejlesztő (medior)',                                          50),
    ('Szoftverfejlesztő (senior)',                                          60),
    ('Szoftverfejlesztő (junior)',                                          70),
    ('Front-end fejlesztő (senior)',                                        80),
    ('Grafikus (designer)',                                                 90),
    ('Tesztelő',                                                           100),
    ('Technical writer / dokumentátor / adminisztratív munkatárs',        110),
    ('Rendszer bevezetéséhez kapcsolódó oktatás (helyszíni)',              120),
    ('Felhasználói oktatás (helyszíni)',                                   130),
    ('Üzemeltetői oktatás (helyszíni)',                                    140)
ON CONFLICT DO NOTHING;
