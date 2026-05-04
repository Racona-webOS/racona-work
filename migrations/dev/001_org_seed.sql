-- Dev környezet: szervezet seed
-- Ez a fájl NEM kerül bele az éles .raconapkg csomagba (migrations/dev/ almappa).

-- Biztosítjuk, hogy a dev user hozzá van adva a default szervezethez
DO $$
DECLARE
    dev_user_id INTEGER;
    default_org_id INTEGER;
    employee_exists BOOLEAN;
BEGIN
    -- Dev user ID lekérése
    SELECT id INTO dev_user_id FROM auth.users WHERE email = 'dev@example.com' LIMIT 1;

    -- Default organization ID lekérése
    SELECT id INTO default_org_id FROM app__racona_work.organizations WHERE slug = 'default-organization' LIMIT 1;

    -- Ha mindkettő létezik, hozzáadjuk a dev user-t a default szervezethez
    IF dev_user_id IS NOT NULL AND default_org_id IS NOT NULL THEN
        -- Ellenőrizzük, hogy létezik-e már employee rekord
        SELECT EXISTS(SELECT 1 FROM app__racona_work.employees WHERE user_id = dev_user_id) INTO employee_exists;

        -- employees rekord (ha még nincs)
        IF NOT employee_exists THEN
            INSERT INTO app__racona_work.employees (user_id, organization_id, position, department, hire_date, status, created_at, updated_at)
            VALUES (dev_user_id, default_org_id, 'Developer', 'IT', CURRENT_DATE, 'active', NOW(), NOW());
        ELSE
            -- Ha már létezik, frissítjük az organization_id-t
            UPDATE app__racona_work.employees SET organization_id = default_org_id WHERE user_id = dev_user_id AND organization_id IS NULL;
        END IF;

        -- organization_members rekord
        INSERT INTO app__racona_work.organization_members (organization_id, user_id, role, joined_at)
        VALUES (default_org_id, dev_user_id, 'admin', NOW())
        ON CONFLICT (organization_id, user_id) DO NOTHING;
    END IF;
END $$;
