-- Racona Work Plugin - Szervezet-szintű szerepek és képességek
-- Egy user szervezetenként más-más szerepet kaphat, amelyekhez képességek tartoznak.
-- A core admin jogosultság továbbra is felülírja ezeket.
--
-- A rendszer szerepek seedelését a szerver (createOrganization → seedDefaultRoles)
-- végzi új szervezet létrehozásakor; új dolgozóhoz pedig az employee szerepet
-- az assignDefaultEmployeeRole helper rendeli hozzá (lásd functions.ts).
-- Ez a migráció csak a sémát hozza létre.

-- ============================================================================
-- 1. SZEREPEK (WP_ROLES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app__racona_work.wp_roles (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    key             VARCHAR(64) NOT NULL,
    name            VARCHAR(120) NOT NULL,
    description     TEXT,
    is_system       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, key)
);

CREATE INDEX IF NOT EXISTS idx_wp_roles_org ON app__racona_work.wp_roles(organization_id);

-- ============================================================================
-- 2. SZEREP KÉPESSÉGEK (WP_ROLE_CAPABILITIES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app__racona_work.wp_role_capabilities (
    role_id    INTEGER NOT NULL REFERENCES app__racona_work.wp_roles(id) ON DELETE CASCADE,
    capability VARCHAR(64) NOT NULL,
    PRIMARY KEY (role_id, capability)
);

CREATE INDEX IF NOT EXISTS idx_wp_role_caps_role ON app__racona_work.wp_role_capabilities(role_id);

-- ============================================================================
-- 3. SZERVEZETI TAG SZEREPEI (WP_MEMBER_ROLES)
-- ============================================================================
-- Egy user egy szervezeten belül több szerepet is kaphat.

CREATE TABLE IF NOT EXISTS app__racona_work.wp_member_roles (
    organization_id INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role_id         INTEGER NOT NULL REFERENCES app__racona_work.wp_roles(id) ON DELETE CASCADE,
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_wp_member_roles_user ON app__racona_work.wp_member_roles(user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_wp_member_roles_role ON app__racona_work.wp_member_roles(role_id);

-- ============================================================================
-- 4. PROJEKT-SZINTŰ SZEREP FELÜLBÍRÁLÁSOK (WP_PROJECT_MEMBER_ROLES)
-- ============================================================================
-- Projektenként egy user kaphat eltérő (plusz) szerepet.

CREATE TABLE IF NOT EXISTS app__racona_work.wp_project_member_roles (
    project_id INTEGER NOT NULL REFERENCES app__racona_work.projects(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role_id    INTEGER NOT NULL REFERENCES app__racona_work.wp_roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_wp_pmr_user ON app__racona_work.wp_project_member_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_wp_pmr_project ON app__racona_work.wp_project_member_roles(project_id);

-- ============================================================================
-- 5. TELEPÍTÉSI SEED: rendszer szerepek a default szervezetnek
-- ============================================================================
-- A 001_init.sql automatikusan létrehoz egy 'default-organization' szervezetet,
-- de ez a szervezet NEM megy át a createOrganization szerver-hívás seedDefaultRoles
-- lépésén. Ezért itt telepítéskor idempotensen hozzárendeljük a 4 rendszer
-- szerepet + a hozzájuk tartozó képességeket.

DO $block$
DECLARE
    default_org_id INTEGER;
    role_id INTEGER;
BEGIN
    SELECT id INTO default_org_id
      FROM app__racona_work.organizations
     WHERE slug = 'default-organization'
     LIMIT 1;

    IF default_org_id IS NULL THEN
        RETURN;
    END IF;

    -- org_admin
    INSERT INTO app__racona_work.wp_roles (organization_id, key, name, description, is_system)
    VALUES (default_org_id, 'org_admin', 'Szervezet adminisztrátor',
            'Teljes hozzáférés a szervezeten belül', TRUE)
    ON CONFLICT (organization_id, key) DO NOTHING
    RETURNING id INTO role_id;

    IF role_id IS NOT NULL THEN
        INSERT INTO app__racona_work.wp_role_capabilities (role_id, capability) VALUES
            (role_id, 'org.manage'),
            (role_id, 'members.view'),
            (role_id, 'members.manage'),
            (role_id, 'roles.manage'),
            (role_id, 'project.create'),
            (role_id, 'project.manage'),
            (role_id, 'project.view.all'),
            (role_id, 'work.log'),
            (role_id, 'work.view.all'),
            (role_id, 'leave.request'),
            (role_id, 'leave.approve'),
            (role_id, 'leave.balance.manage'),
            (role_id, 'employee.view'),
            (role_id, 'employee.manage')
        ON CONFLICT DO NOTHING;
    END IF;
    role_id := NULL;

    -- project_manager
    INSERT INTO app__racona_work.wp_roles (organization_id, key, name, description, is_system)
    VALUES (default_org_id, 'project_manager', 'Projektkezelő',
            'Projektek létrehozása és kezelése', TRUE)
    ON CONFLICT (organization_id, key) DO NOTHING
    RETURNING id INTO role_id;

    IF role_id IS NOT NULL THEN
        INSERT INTO app__racona_work.wp_role_capabilities (role_id, capability) VALUES
            (role_id, 'project.create'),
            (role_id, 'project.manage'),
            (role_id, 'project.view.all'),
            (role_id, 'work.log'),
            (role_id, 'work.view.all'),
            (role_id, 'employee.view'),
            (role_id, 'members.view')
        ON CONFLICT DO NOTHING;
    END IF;
    role_id := NULL;

    -- hr_manager
    INSERT INTO app__racona_work.wp_roles (organization_id, key, name, description, is_system)
    VALUES (default_org_id, 'hr_manager', 'HR felelős',
            'Dolgozói adatok és szabadságok kezelése', TRUE)
    ON CONFLICT (organization_id, key) DO NOTHING
    RETURNING id INTO role_id;

    IF role_id IS NOT NULL THEN
        INSERT INTO app__racona_work.wp_role_capabilities (role_id, capability) VALUES
            (role_id, 'leave.approve'),
            (role_id, 'leave.balance.manage'),
            (role_id, 'employee.manage'),
            (role_id, 'employee.view'),
            (role_id, 'members.view'),
            (role_id, 'work.view.all')
        ON CONFLICT DO NOTHING;
    END IF;
    role_id := NULL;

    -- employee
    INSERT INTO app__racona_work.wp_roles (organization_id, key, name, description, is_system)
    VALUES (default_org_id, 'employee', 'Dolgozó',
            'Alap hozzáférés a saját adatokhoz', TRUE)
    ON CONFLICT (organization_id, key) DO NOTHING
    RETURNING id INTO role_id;

    IF role_id IS NOT NULL THEN
        INSERT INTO app__racona_work.wp_role_capabilities (role_id, capability) VALUES
            (role_id, 'leave.request'),
            (role_id, 'project.view.own'),
            (role_id, 'employee.view'),
            (role_id, 'work.log')
        ON CONFLICT DO NOTHING;
    END IF;
END
$block$;
