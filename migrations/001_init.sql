-- Racona Work Plugin - Teljes adatbázis séma
-- Explicit séma használat a biztonság kedvéért

-- Séma létrehozása (ha még nem létezik)
CREATE SCHEMA IF NOT EXISTS app__racona_work;

-- ============================================================================
-- 1. SZERVEZETEK (ORGANIZATIONS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app__racona_work.organizations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    address TEXT,
    phone VARCHAR(50),
    email VARCHAR(255),
    website VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT organizations_email_check CHECK (email IS NULL OR email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    CONSTRAINT organizations_website_check CHECK (website IS NULL OR website ~* '^https?://')
);

-- Default szervezet létrehozása
INSERT INTO app__racona_work.organizations (name, slug, created_at, updated_at)
VALUES ('Default Organization', 'default-organization', NOW(), NOW())
ON CONFLICT (slug) DO NOTHING;


-- ============================================================================
-- 3. DOLGOZÓK (EMPLOYEES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app__racona_work.employees (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES auth.users(id),
    organization_id INTEGER NOT NULL REFERENCES app__racona_work.organizations(id),
    position VARCHAR(255),
    department VARCHAR(255),
    hire_date DATE,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_employees_user_id ON app__racona_work.employees(user_id);
CREATE INDEX IF NOT EXISTS idx_employees_organization_id ON app__racona_work.employees(organization_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON app__racona_work.employees(status);

-- ============================================================================
-- 4. DOLGOZÓ RÉSZLETEK (EMPLOYEE_DETAILS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app__racona_work.employee_details (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    category VARCHAR(100) NOT NULL,
    field_key VARCHAR(255) NOT NULL,
    field_value TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_details_unique
    ON app__racona_work.employee_details (employee_id, category, field_key);

-- ============================================================================
-- 5. SZABADSÁG KÉRELMEK (LEAVE_REQUESTS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app__racona_work.leave_requests (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES app__racona_work.employees(id),
    organization_id INTEGER NOT NULL REFERENCES app__racona_work.organizations(id),
    leave_type VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    days INTEGER NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    reason TEXT,
    approved_by INTEGER REFERENCES app__racona_work.employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON app__racona_work.leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_organization ON app__racona_work.leave_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON app__racona_work.leave_requests(status);

-- ============================================================================
-- 6. SZABADSÁG EGYENLEGEK (LEAVE_BALANCES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app__racona_work.leave_balances (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES app__racona_work.employees(id),
    organization_id INTEGER NOT NULL REFERENCES app__racona_work.organizations(id),
    year INTEGER NOT NULL,
    total_days INTEGER NOT NULL,
    used_days INTEGER DEFAULT 0,
    remaining_days INTEGER GENERATED ALWAYS AS (total_days - used_days) STORED
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_balances_unique
    ON app__racona_work.leave_balances (employee_id, year);
CREATE INDEX IF NOT EXISTS idx_leave_balances_organization ON app__racona_work.leave_balances(organization_id);

-- ============================================================================
-- 7. PROJEKTEK (PROJECTS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app__racona_work.projects (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'active' NOT NULL,
    start_date DATE,
    end_date DATE,
    created_by INTEGER NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_organization_id ON app__racona_work.projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON app__racona_work.projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON app__racona_work.projects(created_by);

-- ============================================================================
-- 8. PROJEKT TAGOK (PROJECT_MEMBERS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app__racona_work.project_members (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES app__racona_work.projects(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member' NOT NULL,
    assigned_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(project_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON app__racona_work.project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_employee_id ON app__racona_work.project_members(employee_id);

-- ============================================================================
-- 9. MUNKA BEJEGYZÉSEK (WORK_ENTRIES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app__racona_work.work_entries (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES app__racona_work.projects(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    hours DECIMAL(5,2) NOT NULL CHECK (hours >= 0.25 AND hours <= 24),
    work_date DATE NOT NULL,
    status VARCHAR(50) DEFAULT 'completed' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_entries_project_id ON app__racona_work.work_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_work_entries_employee_id ON app__racona_work.work_entries(employee_id);
CREATE INDEX IF NOT EXISTS idx_work_entries_work_date ON app__racona_work.work_entries(work_date);
CREATE INDEX IF NOT EXISTS idx_work_entries_status ON app__racona_work.work_entries(status);
