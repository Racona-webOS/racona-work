-- Racona Work Plugin - Séma javítás
-- Az employees táblából eltávolítjuk az organization_id-t
-- Az organization_members táblában user_id helyett employee_id lesz

-- ============================================================================
-- 1. EMPLOYEES TÁBLA MÓDOSÍTÁSA
-- ============================================================================

-- Töröljük az organization_id oszlopot és a UNIQUE constraint-et
ALTER TABLE app__racona_work.employees
    DROP CONSTRAINT IF EXISTS employees_user_id_organization_id_key;

ALTER TABLE app__racona_work.employees
    DROP COLUMN IF EXISTS organization_id;

-- Új UNIQUE constraint csak a user_id-ra (egy user = egy dolgozó)
ALTER TABLE app__racona_work.employees
    ADD CONSTRAINT employees_user_id_key UNIQUE (user_id);

-- ============================================================================
-- 2. ORGANIZATION_MEMBERS TÁBLA MÓDOSÍTÁSA
-- ============================================================================

-- Először töröljük a meglévő adatokat (mivel a struktúra változik)
TRUNCATE TABLE app__racona_work.organization_members CASCADE;

-- Töröljük a user_id oszlopot és a kapcsolódó constraint-eket
ALTER TABLE app__racona_work.organization_members
    DROP CONSTRAINT IF EXISTS organization_members_organization_id_user_id_key;

ALTER TABLE app__racona_work.organization_members
    DROP CONSTRAINT IF EXISTS organization_members_user_id_fkey;

DROP INDEX IF EXISTS idx_organization_members_user_id;

ALTER TABLE app__racona_work.organization_members
    DROP COLUMN IF EXISTS user_id;

-- Hozzáadjuk az employee_id oszlopot
ALTER TABLE app__racona_work.organization_members
    ADD COLUMN IF NOT EXISTS employee_id INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE;

-- Új UNIQUE constraint és index
ALTER TABLE app__racona_work.organization_members
    ADD CONSTRAINT organization_members_organization_id_employee_id_key
    UNIQUE (organization_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_organization_members_employee_id
    ON app__racona_work.organization_members(employee_id);

-- ============================================================================
-- 3. LEAVE_BALANCES TÁBLA MÓDOSÍTÁSA
-- ============================================================================

-- A leave_balances táblában az organization_id felesleges,
-- mert az employee már egyedi és a szabadság az employeehoz tartozik
ALTER TABLE app__racona_work.leave_balances
    DROP COLUMN IF EXISTS organization_id;

-- ============================================================================
-- 4. LEAVE_REQUESTS TÁBLA MÓDOSÍTÁSA
-- ============================================================================

-- A leave_requests táblában az organization_id felesleges,
-- mert az employee már egyedi
ALTER TABLE app__racona_work.leave_requests
    DROP COLUMN IF EXISTS organization_id;

-- ============================================================================
-- 5. PROJECTS TÁBLA - MARAD AHOGY VAN
-- ============================================================================
-- A projects táblában az organization_id jó, mert a projektek szervezethez tartoznak

-- ============================================================================
-- 6. WORK_ENTRIES TÁBLA - MARAD AHOGY VAN
-- ============================================================================
-- A work_entries táblában az employee_id és project_id jó
