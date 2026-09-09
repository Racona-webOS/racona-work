-- Racona Work Plugin - Munkanaptár (munkaszüneti napok és áthelyezett munkanapok)
--
-- A szabadság-számítás eddig csak a hétvégéket zárta ki, így a hétköznapra eső
-- munkaszüneti napok szabadságnapként fogytak, a ledolgozós szombatok pedig
-- nem számítottak bele. Ez a tábla szervezetenként tárolja a naptári
-- kivételeket, amiket a számítás a hétvége-szabály előtt vesz figyelembe.

-- ============================================================================
-- 1. MUNKANAPTÁR (WORK_CALENDAR_DAYS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app__racona_work.work_calendar_days (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    day             DATE NOT NULL,
    -- A hatás: munkanapnak számít-e. Ezt olvassa a munkanap-számítás.
    is_working_day  BOOLEAN NOT NULL,
    -- Az indok: public_holiday | relocated_rest_day | relocated_work_day | company_day
    kind            VARCHAR(32) NOT NULL,
    note            VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, day)
);

CREATE INDEX IF NOT EXISTS idx_work_calendar_org_day
    ON app__racona_work.work_calendar_days(organization_id, day);

-- ============================================================================
-- 2. ÚJ KÉPESSÉG A MEGLÉVŐ SZERVEZETI ADMINOKNAK
-- ============================================================================
-- A rendszerszerepek képességei a szervezet létrehozásakor másolódnak be a
-- wp_role_capabilities táblába, ezért az új képességet a már létező org_admin
-- szerepekhez külön hozzá kell adni — különben a meglévő szervezetekben senki
-- nem érné el a munkanaptárat.

INSERT INTO app__racona_work.wp_role_capabilities (role_id, capability)
SELECT id, 'leave.calendar.manage'
FROM app__racona_work.wp_roles
WHERE key = 'org_admin'
ON CONFLICT DO NOTHING;
