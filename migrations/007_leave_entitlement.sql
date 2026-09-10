-- Racona Work Plugin - Szabadságkeret-számítás
--
-- Eddig a HR-es dolgozónként és évente kézzel írta be a szabadságkeretet.
-- Ez a migráció eltárolja a számításhoz szükséges adatokat (születési dátum,
-- gyerekek, egyéb pótszabadságok), a keretnél pedig külön tartja a számított
-- értéket és a HR korrekcióját. Részletek: specs/leave-entitlement.md

-- ============================================================================
-- 1. DOLGOZÓ: SZÜLETÉSI ÉS KILÉPÉSI DÁTUM
-- ============================================================================

ALTER TABLE app__racona_work.employees
    ADD COLUMN IF NOT EXISTS birth_date DATE,
    ADD COLUMN IF NOT EXISTS employment_end_date DATE,
    -- A hire_date létrehozáskor mindig az aznapi dátum lett, így a meglévő
    -- dolgozóknál nem a valódi belépést mutatja. Amíg a HR nem menti el
    -- ellenőrzötten, a felület figyelmeztet.
    ADD COLUMN IF NOT EXISTS hire_date_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================================
-- 2. GYEREKEK (EMPLOYEE_CHILDREN)
-- ============================================================================
-- Darabszám helyett születési dátumot tárolunk: így évenként magától kijön,
-- hány gyerek számít bele a pótszabadságba (Mt. 118. § (3)).

CREATE TABLE IF NOT EXISTS app__racona_work.employee_children (
    id          SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    label       VARCHAR(255),
    birth_date  DATE NOT NULL,
    is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_children_employee
    ON app__racona_work.employee_children(employee_id);

-- ============================================================================
-- 3. EGYÉB PÓTSZABADSÁGOK (EMPLOYEE_EXTRA_LEAVE)
-- ============================================================================
-- Az egészségkárosodás különleges (egészségügyi) adat: csak a jogosultság
-- tényét és érvényességét tároljuk, diagnózist vagy százalékot nem.

CREATE TABLE IF NOT EXISTS app__racona_work.employee_extra_leave (
    id          SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    -- health_impaired | underground_radiation | custom
    kind        VARCHAR(50) NOT NULL
        CHECK (kind IN ('health_impaired', 'underground_radiation', 'custom')),
    days        INTEGER NOT NULL CHECK (days > 0),
    valid_from  DATE,
    valid_to    DATE,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_extra_leave_employee
    ON app__racona_work.employee_extra_leave(employee_id);

-- ============================================================================
-- 4. SZABADSÁGKERET: SZÁMÍTOTT ÉRTÉK, KORREKCIÓ, ZÁROLÁS
-- ============================================================================
-- A total_days továbbra is a ténylegesen érvényes összeg, így a kérelmek
-- keret-ellenőrzése (remaining_days) változatlanul működik. Számított módban
-- total_days = calculated_days + adjustment_days; calculated_days NULL = kézi keret.

ALTER TABLE app__racona_work.leave_balances
    ADD COLUMN IF NOT EXISTS calculated_days INTEGER,
    ADD COLUMN IF NOT EXISTS adjustment_days INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS adjustment_note TEXT,
    ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS calculation JSONB,
    ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'leave_balances_total_consistent'
    ) THEN
        ALTER TABLE app__racona_work.leave_balances
            ADD CONSTRAINT leave_balances_total_consistent
            CHECK (calculated_days IS NULL OR total_days = calculated_days + adjustment_days);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'leave_balances_adjustment_note'
    ) THEN
        ALTER TABLE app__racona_work.leave_balances
            ADD CONSTRAINT leave_balances_adjustment_note
            CHECK (adjustment_days = 0 OR length(trim(coalesce(adjustment_note, ''))) > 0);
    END IF;
END $$;
