-- Racona Work Plugin - Örökbefogadás napja a gyereknél
--
-- Örökbefogadásnál az apasági szabadságot az örökbefogadást engedélyező
-- határozat véglegessé válását követő negyedik hónap végéig kell kiadni
-- (Mt. 118. § (4)), nem a születéstől. A szülői szabadság sem kezdődhet az
-- örökbefogadás előtt. Részletek: specs/leave-entitlement.md

ALTER TABLE app__racona_work.employee_children
    ADD COLUMN IF NOT EXISTS adoption_date DATE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'employee_children_adoption_after_birth'
    ) THEN
        ALTER TABLE app__racona_work.employee_children
            ADD CONSTRAINT employee_children_adoption_after_birth
            CHECK (adoption_date IS NULL OR adoption_date >= birth_date);
    END IF;
END $$;
