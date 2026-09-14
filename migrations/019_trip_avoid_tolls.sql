-- ============================================================================
-- FIZETŐS UTAK ELKERÜLÉSE (specs/business-trips.md, K5)
-- ============================================================================
-- Útonként beállítható, hogy az útvonaltervező kerülje a fizetős utakat
-- (Magyarországon a matricás autópályákat). Új útnál a dolgozó legutóbbi
-- választása az alapértelmezés; a meglévő utak a mostani útvonallal maradnak.

ALTER TABLE app__racona_work.trips
    ADD COLUMN IF NOT EXISTS avoid_tolls BOOLEAN NOT NULL DEFAULT false;
