-- ============================================================================
-- DOLGOZÓI DOKUMENTUMOK (specs/employee-documents.md)
-- ============================================================================
-- A fájlok a core fájltárolójában vannak (context.files, a lemezen); itt csak a
-- hivatkozásuk (file_id) és a dokumentumok adatai.

-- --- Dokumentumtípusok (szervezetenként) -------------------------------------

CREATE TABLE IF NOT EXISTS app__racona_work.document_types (
    id                      SERIAL PRIMARY KEY,
    organization_id         INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    name                    VARCHAR(100) NOT NULL,
    description             TEXT,
    -- required: fájl nélkül hiányosnak jelöljük; none: csak nyilvántartás (pl. erkölcsi bizonyítvány)
    file_mode               VARCHAR(10) NOT NULL DEFAULT 'optional'
                              CHECK (file_mode IN ('required', 'optional', 'none')),
    has_expiry              BOOLEAN NOT NULL DEFAULT FALSE,
    default_validity_months INTEGER CHECK (default_validity_months BETWEEN 1 AND 240),
    -- Emlékeztetők: ennyi nappal a lejárat előtt (a lejárat napján mindig)
    reminder_days           INTEGER[] NOT NULL DEFAULT '{30,7}',
    is_required             BOOLEAN NOT NULL DEFAULT FALSE,
    visible_to_employee     BOOLEAN NOT NULL DEFAULT TRUE,
    employee_can_upload     BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order              INTEGER NOT NULL DEFAULT 0,
    -- Az alaptípusok azonosítója (a seedelés így idempotens)
    system_key              VARCHAR(40),
    archived_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_types_org_name
    ON app__racona_work.document_types (organization_id, lower(name))
    WHERE archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_types_org_system_key
    ON app__racona_work.document_types (organization_id, system_key)
    WHERE system_key IS NOT NULL;

-- --- Dokumentumok --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app__racona_work.employee_documents (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    employee_id     INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    type_id         INTEGER NOT NULL REFERENCES app__racona_work.document_types(id),
    title           VARCHAR(200) NOT NULL,
    -- Kiállítás, illetve fájl nélküli típusnál a bemutatás napja
    issued_on       DATE,
    valid_until     DATE,
    note            TEXT,
    status          VARCHAR(10) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'pending', 'rejected', 'archived')),
    replaced_by_id  INTEGER REFERENCES app__racona_work.employee_documents(id) ON DELETE SET NULL,
    created_by      INTEGER REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_by     INTEGER REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMPTZ,
    review_note     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (valid_until IS NULL OR issued_on IS NULL OR valid_until >= issued_on)
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_employee
    ON app__racona_work.employee_documents (employee_id, status);

CREATE INDEX IF NOT EXISTS idx_employee_documents_expiry
    ON app__racona_work.employee_documents (organization_id, valid_until)
    WHERE status = 'active' AND valid_until IS NOT NULL;

-- --- Fájlok (hivatkozás a core platform.plugin_files táblájára) ---------------

CREATE TABLE IF NOT EXISTS app__racona_work.employee_document_files (
    id            SERIAL PRIMARY KEY,
    document_id   INTEGER NOT NULL REFERENCES app__racona_work.employee_documents(id) ON DELETE CASCADE,
    file_id       UUID NOT NULL UNIQUE,
    original_name VARCHAR(255) NOT NULL,
    mime_type     VARCHAR(100) NOT NULL,
    size_bytes    BIGINT NOT NULL,
    uploaded_by   INTEGER REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_document_files_document
    ON app__racona_work.employee_document_files (document_id);

-- --- Napló (a dokumentum törlése után is megmarad) ----------------------------

CREATE TABLE IF NOT EXISTS app__racona_work.employee_document_events (
    id              BIGSERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL,
    employee_id     INTEGER NOT NULL,
    document_id     INTEGER,
    action          VARCHAR(20) NOT NULL,
    actor_user_id   INTEGER,
    details         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_document_events_employee
    ON app__racona_work.employee_document_events (employee_id, created_at DESC);

-- --- Kiküldött emlékeztetők (egy eltolásra egyszer) ---------------------------

CREATE TABLE IF NOT EXISTS app__racona_work.employee_document_reminders (
    document_id INTEGER NOT NULL REFERENCES app__racona_work.employee_documents(id) ON DELETE CASCADE,
    offset_days INTEGER NOT NULL,
    sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (document_id, offset_days)
);

-- ============================================================================
-- ALAPÉRTELMEZETT TÍPUSOK
-- ============================================================================
-- Egy helyen vannak: a migráció a meglévő szervezeteknek, a createOrganization
-- az újaknak hívja. A már létező alaptípust nem írja felül.

CREATE OR REPLACE FUNCTION app__racona_work.seed_document_types(p_organization_id INTEGER)
RETURNS VOID LANGUAGE sql AS $$
    INSERT INTO app__racona_work.document_types
        (organization_id, system_key, name, file_mode, has_expiry, default_validity_months,
         is_required, visible_to_employee, sort_order)
    VALUES
        (p_organization_id, 'employment_contract', 'Munkaszerződés',               'required', FALSE, NULL, TRUE,  TRUE, 10),
        (p_organization_id, 'job_description',     'Munkaköri leírás',             'required', FALSE, NULL, FALSE, TRUE, 20),
        (p_organization_id, 'medical_fitness',     'Orvosi alkalmassági vélemény', 'required', TRUE,  12,   TRUE,  TRUE, 30),
        (p_organization_id, 'criminal_record',     'Erkölcsi bizonyítvány',        'none',     TRUE,  NULL, FALSE, TRUE, 40),
        (p_organization_id, 'qualification',       'Végzettséget igazoló okirat',  'optional', FALSE, NULL, FALSE, TRUE, 50),
        (p_organization_id, 'other',               'Egyéb',                        'optional', FALSE, NULL, FALSE, TRUE, 90)
    ON CONFLICT DO NOTHING;
$$;

SELECT app__racona_work.seed_document_types(id) FROM app__racona_work.organizations;

-- ============================================================================
-- ÚJ KÉPESSÉGEK A MEGLÉVŐ RENDSZERSZEREPEKNEK
-- ============================================================================
-- employee.documents.view: mindenki dokumentumainak olvasása
-- employee.documents.manage: felvétel, szerkesztés, törlés, típusok
-- employee.documents.own: a saját dokumentumok

INSERT INTO app__racona_work.wp_role_capabilities (role_id, capability)
SELECT r.id, c.capability
  FROM app__racona_work.wp_roles r
  CROSS JOIN (VALUES ('employee.documents.view'), ('employee.documents.manage')) AS c(capability)
 WHERE r.key IN ('org_admin', 'hr_manager')
ON CONFLICT DO NOTHING;

INSERT INTO app__racona_work.wp_role_capabilities (role_id, capability)
SELECT r.id, 'employee.documents.own'
  FROM app__racona_work.wp_roles r
 WHERE r.key IN ('org_admin', 'employee')
ON CONFLICT DO NOTHING;
