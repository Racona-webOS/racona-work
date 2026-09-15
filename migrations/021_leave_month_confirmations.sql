-- ============================================================================
-- HAVI SZABADSÁG-ELLENŐRZÉS (specs/leave-month-confirmation.md)
-- ============================================================================
-- A HR a hónap végén kiküldi a dolgozóknak a hónapra rögzített szabadságaik
-- összesítőjét; a dolgozó elfogadja vagy eltérést jelez. A tábla a kiküldött
-- ellenőrzés-kérelmeket tárolja, a kiküldéskori pillanatképpel (amit a dolgozó
-- elfogad) és a válasszal. Újraküldéskor a régi sor `superseded` lesz, így az
-- előzmények megmaradnak; dolgozónként és hónaponként egy élő sor lehet.

CREATE TABLE IF NOT EXISTS app__racona_work.leave_month_confirmations (
    id               SERIAL PRIMARY KEY,
    organization_id  INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    employee_id      INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    year             INTEGER NOT NULL,
    month            INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    -- pending | accepted | disputed | closed | superseded
    status           VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'disputed', 'closed', 'superseded')),
    -- A kiküldéskori állapot: { from, to, workingDays, days: [{ day, leaveType }], pending: [...] }
    snapshot         JSONB NOT NULL,
    -- A jóváhagyott napok ujjlenyomata („nap:típus” rendezve), a változás felismeréséhez
    fingerprint      TEXT NOT NULL,
    -- A kiküldő megjegyzése; újraküldésnél a válasz a dolgozó eltérésére
    hr_note          TEXT,
    sent_by          INTEGER REFERENCES auth.users(id),
    sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_by     INTEGER REFERENCES auth.users(id),
    responded_at     TIMESTAMPTZ,
    -- Eltérésnél a tételek: [{ kind: not_on_leave | wrong_type | missing, day, leaveType? }]
    dispute_items    JSONB,
    employee_note    TEXT,
    -- A HR lezárása vagy újraküldése
    resolved_by      INTEGER REFERENCES auth.users(id),
    resolved_at      TIMESTAMPTZ,
    resolution_note  TEXT,
    previous_id      INTEGER REFERENCES app__racona_work.leave_month_confirmations(id) ON DELETE SET NULL
);

-- Dolgozónként és hónaponként egy élő változat
CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_month_confirmations_current
    ON app__racona_work.leave_month_confirmations(employee_id, year, month)
    WHERE status <> 'superseded';

CREATE INDEX IF NOT EXISTS idx_leave_month_confirmations_org_period
    ON app__racona_work.leave_month_confirmations(organization_id, year, month);

CREATE INDEX IF NOT EXISTS idx_leave_month_confirmations_employee_status
    ON app__racona_work.leave_month_confirmations(employee_id, status);
