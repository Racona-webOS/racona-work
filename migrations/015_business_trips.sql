-- Racona Work Plugin - Kiküldetések
--
-- A dolgozó a saját autójával tett hivatali utakat rögzíti. A távolságot
-- útvonaltervező adja, a havi kiküldetési rendelvényt (dolgozó + autó + hónap)
-- a rendszer számolja, a HR jóváhagyja és kifizetettnek jelöli.
--
-- Új adatok a rendelvény fejlécéhez: a dolgozó lakcíme, születési helye,
-- anyja neve, adóazonosító jele és a szervezet adószáma (fix, nem kötelező
-- mezők). A jóváhagyott rendelvény számviteli bizonylat (8 év megőrzés), ezért
-- a dolgozó nem törölhető, amíg van rendelvénye.
--
-- Részletek: specs/business-trips.md

-- --- Szervezet: adószám és a cím koordinátái (munkahely kiindulópont) ---------

ALTER TABLE app__racona_work.organizations
    ADD COLUMN IF NOT EXISTS tax_number  VARCHAR(13),
    ADD COLUMN IF NOT EXISTS address_lat NUMERIC(9,6),
    ADD COLUMN IF NOT EXISTS address_lng NUMERIC(9,6);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_tax_number_check') THEN
        ALTER TABLE app__racona_work.organizations
            ADD CONSTRAINT organizations_tax_number_check
            CHECK (tax_number IS NULL OR tax_number ~ '^\d{8}-\d-\d{2}$');
    END IF;
END $$;

-- --- Dolgozó: a rendelvényhez szükséges személyes adatok ----------------------

ALTER TABLE app__racona_work.employees
    ADD COLUMN IF NOT EXISTS home_address TEXT,
    ADD COLUMN IF NOT EXISTS home_lat     NUMERIC(9,6),
    ADD COLUMN IF NOT EXISTS home_lng     NUMERIC(9,6),
    ADD COLUMN IF NOT EXISTS birth_place  VARCHAR(100),
    ADD COLUMN IF NOT EXISTS mother_name  VARCHAR(150),
    ADD COLUMN IF NOT EXISTS tax_id       VARCHAR(10);

-- Az ellenőrző jegyet a szerver nézi (server/trip-calc.ts validateTaxId)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_tax_id_check') THEN
        ALTER TABLE app__racona_work.employees
            ADD CONSTRAINT employees_tax_id_check
            CHECK (tax_id IS NULL OR tax_id ~ '^8\d{9}$');
    END IF;
END $$;

-- --- Autók -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app__racona_work.trip_vehicles (
    id               SERIAL PRIMARY KEY,
    organization_id  INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    employee_id      INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    -- Nagybetűs, szóköz nélkül ("MXA-752")
    plate_number     VARCHAR(16) NOT NULL,
    model            VARCHAR(100) NOT NULL,
    -- Elektromos autónál NULL
    engine_cc        INTEGER CHECK (engine_cc BETWEEN 50 AND 10000),
    -- petrol | diesel | lpg | cng | hybrid | electric
    -- Hogy melyik választható, azt a kód dönti el (FUEL_RULES); az 1. fázisban
    -- csak petrol és diesel. Így új üzemanyaghoz nem kell migráció.
    fuel_type        VARCHAR(16) NOT NULL
        CHECK (fuel_type IN ('petrol', 'diesel', 'lpg', 'cng', 'hybrid', 'electric')),
    -- Egyedi fogyasztás az üzemanyag mértékegységében / 100 km (csak HR)
    consumption_override        NUMERIC(5,2) CHECK (consumption_override > 0),
    consumption_override_reason TEXT,
    is_default       BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, plate_number)
);

CREATE INDEX IF NOT EXISTS idx_trip_vehicles_org
    ON app__racona_work.trip_vehicles(organization_id);

-- --- Mentett helyek ------------------------------------------------------------
-- employee_id NULL = céges hely (HR kezeli, mindenki látja)

CREATE TABLE IF NOT EXISTS app__racona_work.trip_places (
    id               SERIAL PRIMARY KEY,
    organization_id  INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    employee_id      INTEGER REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    label            VARCHAR(100) NOT NULL,
    address          TEXT NOT NULL,
    lat              NUMERIC(9,6) NOT NULL,
    lng              NUMERIC(9,6) NOT NULL,
    -- Céges helynél: ez a munkahely kiindulópont a szervezet címe helyett
    is_workplace     BOOLEAN NOT NULL DEFAULT FALSE,
    created_by       INTEGER REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (NOT (is_workplace AND employee_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_trip_places_org_employee
    ON app__racona_work.trip_places(organization_id, employee_id);

-- --- Utak ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app__racona_work.trips (
    id               SERIAL PRIMARY KEY,
    organization_id  INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    employee_id      INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    vehicle_id       INTEGER NOT NULL REFERENCES app__racona_work.trip_vehicles(id),
    started_at       TIMESTAMPTZ NOT NULL,
    ended_at         TIMESTAMPTZ NOT NULL,
    purpose          TEXT NOT NULL,
    -- [{ label, address, lat, lng }], sorrendben: kiindulópont, megállók, cél,
    -- 'other' visszaútnál a végén a visszaérkezés helye
    waypoints        JSONB NOT NULL,
    -- origin: vissza a kiindulópontra | other: máshová | none: csak odaút
    return_mode      VARCHAR(8) NOT NULL DEFAULT 'origin'
        CHECK (return_mode IN ('origin', 'other', 'none')),
    -- Útvonaltervező szerint; NULL = kézzel megadott km
    routed_km        NUMERIC(8,1),
    route_legs_km    JSONB,
    -- Encoded polyline (precision 6), a térképhez
    route_geometry   TEXT,
    distance_km      INTEGER NOT NULL CHECK (distance_km BETWEEN 1 AND 5000),
    -- Kötelező, ha az elszámolt km eltér a tervezettől, vagy nincs tervezett
    distance_reason  TEXT,
    ordered_by_user_id INTEGER REFERENCES auth.users(id),
    -- HR-felülbírálás nyoma; NULL, ha a dolgozó választása érvényes
    ordered_by_overridden_by INTEGER REFERENCES auth.users(id),
    ordered_by_overridden_at TIMESTAMPTZ,
    created_by       INTEGER REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ended_at > started_at)
);

CREATE INDEX IF NOT EXISTS idx_trips_employee_started
    ON app__racona_work.trips(employee_id, started_at);
CREATE INDEX IF NOT EXISTS idx_trips_org_started
    ON app__racona_work.trips(organization_id, started_at);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle
    ON app__racona_work.trips(vehicle_id);

-- --- Havi rendelvények --------------------------------------------------------

CREATE TABLE IF NOT EXISTS app__racona_work.trip_settlements (
    id               SERIAL PRIMARY KEY,
    organization_id  INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    -- Számviteli bizonylat: a dolgozó nem törölhető, amíg van rendelvénye
    employee_id      INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE RESTRICT,
    vehicle_id       INTEGER NOT NULL REFERENCES app__racona_work.trip_vehicles(id),
    year             SMALLINT NOT NULL,
    month            SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
    -- draft | submitted | approved | paid
    status           VARCHAR(16) NOT NULL
        CHECK (status IN ('draft', 'submitted', 'approved', 'paid')),
    -- Biz.szám, jóváhagyáskor kapja, utána nem változik
    document_number  VARCHAR(32),
    total_km         INTEGER NOT NULL,
    -- Ft, kerekítve; NULL, ha nincs NAV-ár
    total_amount     INTEGER,
    -- A rendelvény teljes tartalma (SettlementDocument): beküldéskor és
    -- jóváhagyáskor mentve, jóváhagyás után ebből nyomtatunk
    snapshot         JSONB NOT NULL,
    -- Visszaküldés vagy visszanyitás oka
    note             TEXT,
    submitted_at     TIMESTAMPTZ,
    approved_by      INTEGER REFERENCES auth.users(id),
    approved_at      TIMESTAMPTZ,
    paid_by          INTEGER REFERENCES auth.users(id),
    paid_at          DATE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, vehicle_id, year, month),
    UNIQUE (organization_id, document_number)
);

CREATE INDEX IF NOT EXISTS idx_trip_settlements_org_status
    ON app__racona_work.trip_settlements(organization_id, status);

-- Bizonylatszám-számláló szervezetenként és évente. Jóváhagyáskor
-- INSERT … ON CONFLICT DO UPDATE SET last_number = last_number + 1 RETURNING:
-- a sorzár miatt két egyszerre jóváhagyott rendelvény nem kaphat azonos számot.
CREATE TABLE IF NOT EXISTS app__racona_work.trip_document_counters (
    organization_id  INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    year             SMALLINT NOT NULL,
    last_number      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, year)
);

-- --- NAV üzemanyagárak --------------------------------------------------------
-- A mértékegységet az ártípus adja: petrol, diesel, mixed, lpg: Ft/l;
-- cng: Ft/kg; electricity: Ft/kWh

CREATE TABLE IF NOT EXISTS app__racona_work.trip_fuel_prices (
    organization_id  INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    year             SMALLINT NOT NULL,
    month            SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
    price_type       VARCHAR(16) NOT NULL
        CHECK (price_type IN ('petrol', 'diesel', 'mixed', 'lpg', 'cng', 'electricity')),
    price_huf        NUMERIC(8,2) NOT NULL CHECK (price_huf > 0),
    updated_by       INTEGER REFERENCES auth.users(id),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, year, month, price_type)
);

-- --- Címkeresés és útvonal gyorsítótára --------------------------------------
-- Szervezetfüggetlen. Lakcímet is tartalmazhat, ezért 90 nap után törlődik.

CREATE TABLE IF NOT EXISTS app__racona_work.geo_cache (
    cache_key        CHAR(64) PRIMARY KEY,
    kind             VARCHAR(8) NOT NULL CHECK (kind IN ('search', 'route')),
    response         JSONB NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geo_cache_created
    ON app__racona_work.geo_cache(created_at);

-- --- Jogok a meglévő rendszer szerepeknek -------------------------------------
-- trip.record: saját utak és rendelvények; trip.approve: jóváhagyás;
-- trip.manage: minden út, kifizetés, NAV-árak, beállítások

INSERT INTO app__racona_work.wp_role_capabilities (role_id, capability)
SELECT r.id, c.capability
  FROM app__racona_work.wp_roles r
  CROSS JOIN (VALUES ('trip.record'), ('trip.approve'), ('trip.manage')) AS c(capability)
 WHERE r.key IN ('org_admin', 'hr_manager')
ON CONFLICT DO NOTHING;

INSERT INTO app__racona_work.wp_role_capabilities (role_id, capability)
SELECT r.id, 'trip.record'
  FROM app__racona_work.wp_roles r
 WHERE r.key = 'employee'
ON CONFLICT DO NOTHING;
