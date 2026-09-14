-- ============================================================================
-- NAV-ÁRAK FORRÁSA (specs/business-trips.md, K14, D7)
-- ============================================================================
-- A NAV-árakat a HR kézzel rögzíti, vagy a NAV oldaláról kéri le (félautomata
-- lekérés). A forrásból tudjuk, hogy egy eltérő árat kérdés nélkül frissíthet-e
-- a lekérés (korábban is a NAV-tól jött), vagy megerősítés kell (kézzel írták be).
-- A meglévő árak kézzel rögzítettek.

ALTER TABLE app__racona_work.trip_fuel_prices
    ADD COLUMN IF NOT EXISTS source VARCHAR(8) NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'nav'));
