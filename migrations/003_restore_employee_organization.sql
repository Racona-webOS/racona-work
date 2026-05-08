-- Racona Work Plugin - Employee-Organization kapcsolat helyreállítása

-- ============================================================================
-- 1. EMPLOYEES TÁBLA MÓDOSÍTÁSA
-- ============================================================================

-- Töröljük a user_id UNIQUE constraint-et (mert egy user több szervezetben is lehet dolgozó)
ALTER TABLE app__racona_work.employees
    DROP CONSTRAINT IF EXISTS employees_user_id_key;

-- Hozzáadjuk az organization_id oszlopot
ALTER TABLE app__racona_work.employees
    ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE;

-- Frissítjük a meglévő dolgozókat az első (default) szervezethez
UPDATE app__racona_work.employees
SET organization_id = (SELECT id FROM app__racona_work.organizations ORDER BY id LIMIT 1)
WHERE organization_id IS NULL;

-- Most már NOT NULL lehet
ALTER TABLE app__racona_work.employees
    ALTER COLUMN organization_id SET NOT NULL;

-- Új UNIQUE constraint: egy user egy szervezetben csak egyszer lehet dolgozó
ALTER TABLE app__racona_work.employees
    ADD CONSTRAINT employees_user_id_organization_id_key UNIQUE (user_id, organization_id);

-- Index az organization_id-ra
CREATE INDEX IF NOT EXISTS idx_employees_organization_id ON app__racona_work.employees(organization_id);

-- ============================================================================
-- 2. LEAVE_BALANCES TÁBLA MÓDOSÍTÁSA
-- ============================================================================

-- Visszatesszük az organization_id-t a leave_balances táblába
ALTER TABLE app__racona_work.leave_balances
    ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE;

-- Frissítjük a meglévő egyenlegeket az employee szervezete alapján
UPDATE app__racona_work.leave_balances lb
SET organization_id = e.organization_id
FROM app__racona_work.employees e
WHERE lb.employee_id = e.id AND lb.organization_id IS NULL;

-- Most már NOT NULL lehet
ALTER TABLE app__racona_work.leave_balances
    ALTER COLUMN organization_id SET NOT NULL;

-- Index
CREATE INDEX IF NOT EXISTS idx_leave_balances_organization ON app__racona_work.leave_balances(organization_id);

-- ============================================================================
-- 3. LEAVE_REQUESTS TÁBLA MÓDOSÍTÁSA
-- ============================================================================

-- Visszatesszük az organization_id-t a leave_requests táblába
ALTER TABLE app__racona_work.leave_requests
    ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE;

-- Frissítjük a meglévő kérelmeket az employee szervezete alapján
UPDATE app__racona_work.leave_requests lr
SET organization_id = e.organization_id
FROM app__racona_work.employees e
WHERE lr.employee_id = e.id AND lr.organization_id IS NULL;

-- Most már NOT NULL lehet
ALTER TABLE app__racona_work.leave_requests
    ALTER COLUMN organization_id SET NOT NULL;

-- Index
CREATE INDEX IF NOT EXISTS idx_leave_requests_organization ON app__racona_work.leave_requests(organization_id);
