-- Racona Work Plugin - Dolgozói adatbejelentések
--
-- A dolgozó bejelentheti a szabadságkeretét érintő adatai változását
-- (születési dátum, gyerekek, egyéb pótszabadság); a HR jóváhagyja vagy
-- elutasítja. Jóváhagyáskor a változás bekerül a dolgozó adatai közé, és a
-- nyitott keretek újraszámolódnak. Részletek: specs/leave-entitlement.md

CREATE TABLE IF NOT EXISTS app__racona_work.leave_data_requests (
    id              SERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    -- birth_date | child_add | child_update | child_remove | extra_add
    kind            VARCHAR(32) NOT NULL
        CHECK (kind IN ('birth_date', 'child_add', 'child_update', 'child_remove', 'extra_add')),
    -- Módosításnál és törlésnél: melyik gyerek
    child_id        INTEGER REFERENCES app__racona_work.employee_children(id) ON DELETE SET NULL,
    -- A javasolt adatok, és módosításnál / törlésnél a beadáskori állapot ("previous")
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    employee_note   TEXT,
    -- pending | approved | rejected | cancelled
    status          VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    decision_note   TEXT,
    requested_by    INTEGER REFERENCES auth.users(id),
    decided_by      INTEGER REFERENCES auth.users(id),
    decided_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_data_requests_org_status
    ON app__racona_work.leave_data_requests(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_data_requests_employee
    ON app__racona_work.leave_data_requests(employee_id, created_at DESC);
