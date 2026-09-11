-- Racona Work Plugin - Szabadságnapok (LEAVE_DAYS)
--
-- A szabadság eddig csak a kérelemben (leave_requests) élt: egy intervallum és
-- egy napszám. Ebből nem lehet utólag egy napot kivenni, és nem látszik napokra
-- bontva, ki mikor van szabadságon. Mostantól a jóváhagyott szabadság minden
-- munkanapja külön sor; a kérelem beadott, utólag nem módosuló meta sor marad.
-- A keretek felhasználását, az áthozott napokat, a betegszabadságot és a
-- dashboardot ez a tábla táplálja. Részletek: specs/leave-days.md

-- ============================================================================
-- 1. SZABADSÁGNAPOK (LEAVE_DAYS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app__racona_work.leave_days (
    id               SERIAL PRIMARY KEY,
    employee_id      INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    organization_id  INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    leave_request_id INTEGER NOT NULL REFERENCES app__racona_work.leave_requests(id) ON DELETE CASCADE,
    day              DATE NOT NULL,
    -- A kérelemből másolva: annual | sick | paternity | parental | unpaid | other
    leave_type       VARCHAR(50) NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Egy dolgozónak egy napon egy szabadsága lehet
    UNIQUE (employee_id, day)
);

CREATE INDEX IF NOT EXISTS idx_leave_days_org_day
    ON app__racona_work.leave_days(organization_id, day);
CREATE INDEX IF NOT EXISTS idx_leave_days_request
    ON app__racona_work.leave_days(leave_request_id);
CREATE INDEX IF NOT EXISTS idx_leave_days_employee_type_day
    ON app__racona_work.leave_days(employee_id, leave_type, day);

-- ============================================================================
-- 2. VISSZATÖLTÉS A MEGLÉVŐ JÓVÁHAGYOTT KÉRELMEKBŐL
-- ============================================================================
-- Munkanap: a munkanaptár bejegyzése dönt, ha van; egyébként a hétfő–péntek
-- szabály. Átfedő kérelmeknél a korábban beadott nyer, a másik napjai kimaradnak
-- (ON CONFLICT DO NOTHING), ezt a 3. pont jelzi.

INSERT INTO app__racona_work.leave_days
    (employee_id, organization_id, leave_request_id, day, leave_type, created_at)
SELECT lr.employee_id, lr.organization_id, lr.id, d.day::date, lr.leave_type,
       COALESCE(lr.updated_at, lr.created_at, NOW())
  FROM app__racona_work.leave_requests lr
 CROSS JOIN LATERAL generate_series(lr.start_date::timestamp, lr.end_date::timestamp, interval '1 day') AS d(day)
  LEFT JOIN app__racona_work.work_calendar_days wc
         ON wc.organization_id = lr.organization_id AND wc.day = d.day::date
 WHERE lr.status = 'approved'
   AND COALESCE(wc.is_working_day, EXTRACT(ISODOW FROM d.day) < 6)
 ORDER BY lr.created_at, lr.id, d.day
    ON CONFLICT (employee_id, day) DO NOTHING;

-- ============================================================================
-- 3. ÁTFEDÉS MIATT KIMARADT NAPOK JELZÉSE
-- ============================================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT lr.id, lr.employee_id, lr.start_date, lr.end_date,
               expected.cnt AS expected_days,
               (SELECT COUNT(*) FROM app__racona_work.leave_days ld WHERE ld.leave_request_id = lr.id) AS stored_days
          FROM app__racona_work.leave_requests lr
         CROSS JOIN LATERAL (
               SELECT COUNT(*) AS cnt
                 FROM generate_series(lr.start_date::timestamp, lr.end_date::timestamp, interval '1 day') AS d(day)
                 LEFT JOIN app__racona_work.work_calendar_days wc
                        ON wc.organization_id = lr.organization_id AND wc.day = d.day::date
                WHERE COALESCE(wc.is_working_day, EXTRACT(ISODOW FROM d.day) < 6)
         ) AS expected
         WHERE lr.status = 'approved'
    LOOP
        IF r.stored_days <> r.expected_days THEN
            RAISE NOTICE 'leave_days: a(z) % kérelem (dolgozó %, % – %) % munkanapjából % került be (átfedés).',
                r.id, r.employee_id, r.start_date, r.end_date, r.expected_days, r.stored_days;
        END IF;
    END LOOP;
END $$;

-- ============================================================================
-- 4. AZ ÉVES KERETEK FELHASZNÁLÁSA A NAPOKBÓL
-- ============================================================================
-- A used_days mostantól mindig a napok száma; a szerver minden változás után
-- ugyanígy számolja újra (syncAnnualUsedDays).

UPDATE app__racona_work.leave_balances b
   SET used_days = (
           SELECT COUNT(*)
             FROM app__racona_work.leave_days ld
            WHERE ld.employee_id = b.employee_id
              AND ld.leave_type = 'annual'
              AND EXTRACT(YEAR FROM ld.day)::int = b.year
       );
