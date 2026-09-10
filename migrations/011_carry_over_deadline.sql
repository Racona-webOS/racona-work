-- Racona Work Plugin - Az áthozott szabadságnapok határideje
--
-- Az előző évből áthozott napokat határidőig kell kiadni (Mt. 123. §):
-- jellemzően március 31-ig (október 1. utáni belépés, a munkáltató gazdasági
-- érdeke), az életkori pótszabadságot megállapodás alapján az év végéig, a
-- munkavállaló érdekkörében felmerült akadálynál annak megszűnésétől 60 napig.
-- A határidő lejárta után a szabadság nem vész el — a rendszer csak jelzi,
-- hogy ki kell adni. Részletek: specs/leave-entitlement.md

ALTER TABLE app__racona_work.leave_balances
    ADD COLUMN IF NOT EXISTS carry_over_deadline DATE;

-- A 2. fázisban határidő nélkül rögzített áthozatalok: március 31. (az alapeset)
UPDATE app__racona_work.leave_balances
   SET carry_over_deadline = make_date(year, 3, 31)
 WHERE carried_over_days > 0 AND carry_over_deadline IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'leave_balances_carry_over_deadline'
    ) THEN
        ALTER TABLE app__racona_work.leave_balances
            ADD CONSTRAINT leave_balances_carry_over_deadline
            CHECK (carried_over_days = 0 OR carry_over_deadline IS NOT NULL);
    END IF;
END $$;
