-- Racona Work Plugin - Távollétek, gyerekhez kötött szabadságok, keret-változásnapló
--
-- 1. A nem munkában töltött időszakok (Mt. 115. §) arányosan csökkentik az
--    éves szabadságkeretet. A jóváhagyott fizetés nélküli szabadságkérelmeket a
--    szerver magától beszámítja, a többit a HR rögzíti itt.
-- 2. Az apasági és a szülői szabadság gyerekhez kötött: a kérelem hivatkozik a
--    gyerekre, az apasági szabadságot a HR jelöli a gyereknél.
-- 3. A szabadságkeretek minden változása naplózódik.
-- Részletek: specs/leave-entitlement.md

-- ============================================================================
-- 1. NEM MUNKÁBAN TÖLTÖTT IDŐSZAKOK (EMPLOYEE_ABSENCE_PERIODS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app__racona_work.employee_absence_periods (
    id          SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    -- unpaid_leave | childcare_unpaid_leave | unexcused_absence | other
    kind        VARCHAR(50) NOT NULL
        CHECK (kind IN ('unpaid_leave', 'childcare_unpaid_leave', 'unexcused_absence', 'other')),
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_employee_absence_periods_employee
    ON app__racona_work.employee_absence_periods(employee_id);

-- ============================================================================
-- 2. APASÁGI ÉS SZÜLŐI SZABADSÁG
-- ============================================================================

-- A dolgozók nemét nem tároljuk, és örökbefogadónak is jár: a HR jelöli.
ALTER TABLE app__racona_work.employee_children
    ADD COLUMN IF NOT EXISTS paternity_eligible BOOLEAN NOT NULL DEFAULT FALSE;

-- Melyik gyerek után kérik (apasági és szülői szabadságnál kötelező, a szerver ellenőrzi)
ALTER TABLE app__racona_work.leave_requests
    ADD COLUMN IF NOT EXISTS child_id INTEGER
        REFERENCES app__racona_work.employee_children(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leave_requests_child
    ON app__racona_work.leave_requests(child_id);

-- ============================================================================
-- 3. SZABADSÁGKERET VÁLTOZÁSNAPLÓ (LEAVE_BALANCE_HISTORY)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app__racona_work.leave_balance_history (
    id            SERIAL PRIMARY KEY,
    balance_id    INTEGER NOT NULL REFERENCES app__racona_work.leave_balances(id) ON DELETE CASCADE,
    employee_id   INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    year          INTEGER NOT NULL,
    -- created | bulk_created | recalculated | adjusted | calculation_applied | manual_set
    action        VARCHAR(32) NOT NULL,
    total_before  INTEGER,
    total_after   INTEGER NOT NULL,
    -- A keret mezői előtte és utána (számított, korrekció, indoklás, áthozott, zárolt)
    details       JSONB,
    actor_user_id INTEGER REFERENCES auth.users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_balance_history_balance
    ON app__racona_work.leave_balance_history(balance_id, created_at DESC);
