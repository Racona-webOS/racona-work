-- ============================================================================
-- ÉVNYITÁS (specs/year-opening.md, D1, D2)
-- ============================================================================
-- Szabadságot csak megnyitott évre lehet rögzíteni. A beállítás a legutolsó
-- megnyitott év (settings:leave_opened_year:org_<id>). A meglévő szervezeteknél
-- a telepítés éve lesz megnyitva, hogy a mostani működés ne álljon le; a
-- következő évet a HR nyitja meg a munkanaptárban.
--
-- A kv_store-t a core hozza létre telepítéskor; friss telepítésnél, ha még
-- nincs meg, szervezet sincs, így nincs mit beírni.

DO $$
BEGIN
    IF to_regclass('app__racona_work.kv_store') IS NOT NULL THEN
        INSERT INTO app__racona_work.kv_store (key, value, updated_at)
        SELECT 'settings:leave_opened_year:org_' || o.id,
               to_jsonb(EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Europe/Budapest'))::int),
               NOW()
          FROM app__racona_work.organizations o
        ON CONFLICT (key) DO NOTHING;
    END IF;
END $$;
