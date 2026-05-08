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
