-- ============================================================================
-- PROJEKT LEZÁRÁSA (specs/project-closing.md)
-- ============================================================================
-- A lezárt projekthez nem rögzíthető feladat, a meglévők nem módosíthatók és
-- nem törölhetők. A lezárás független a tájékoztató `status` mezőtől; a
-- `closed_at` kitöltése jelenti a zárolást.

ALTER TABLE app__racona_work.projects
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS closed_by INTEGER REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- ÚJ KÉPESSÉG A MEGLÉVŐ RENDSZERSZEREPEKNEK
-- ============================================================================
-- A rendszerszerepek képességei a szervezet létrehozásakor másolódnak be, ezért
-- a már létező org_admin és project_manager szerepekhez külön hozzá kell adni.

INSERT INTO app__racona_work.wp_role_capabilities (role_id, capability)
SELECT id, 'project.close'
FROM app__racona_work.wp_roles
WHERE key IN ('org_admin', 'project_manager')
ON CONFLICT DO NOTHING;
