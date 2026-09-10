-- Racona Work Plugin - Áthozott szabadságnapok
--
-- Az előző évből áthozott napokat külön tároljuk, hogy a keret bontásában
-- látszódjon, és az újraszámolás ne mossa össze a számított értékkel.
-- Számított módban: total_days = calculated_days + adjustment_days + carried_over_days.
-- Kézi keretnél nincs áthozatal (a kézi összeg már mindent tartalmaz).
-- Részletek: specs/leave-entitlement.md

ALTER TABLE app__racona_work.leave_balances
    ADD COLUMN IF NOT EXISTS carried_over_days INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    -- A 007-es szabály még az áthozatal nélküli összeget várja
    ALTER TABLE app__racona_work.leave_balances
        DROP CONSTRAINT IF EXISTS leave_balances_total_consistent;
    ALTER TABLE app__racona_work.leave_balances
        ADD CONSTRAINT leave_balances_total_consistent
        CHECK (calculated_days IS NULL
               OR total_days = calculated_days + adjustment_days + carried_over_days);

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'leave_balances_carry_over_valid'
    ) THEN
        ALTER TABLE app__racona_work.leave_balances
            ADD CONSTRAINT leave_balances_carry_over_valid
            CHECK (carried_over_days >= 0
                   AND (calculated_days IS NOT NULL OR carried_over_days = 0));
    END IF;
END $$;
