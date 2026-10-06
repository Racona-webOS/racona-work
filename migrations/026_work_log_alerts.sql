-- Hiányzó munkanapló-bejegyzések figyelése (specs/work-log-check.md)
--
-- A napi ütemezett feladat (work-log-missing-check) ide jegyzi, melyik
-- dolgozó melyik napjáról ment már eszkaláció (a projektvezetőnek), hogy egy
-- napról csak egyszer menjen, akkor is, ha a futás a kimaradt napokat pótolja.
-- A dolgozói esti emlékeztető nincs nyilvántartva: amíg a nap hiányzik, minden este megy.
-- A beállítás a kv_store-ban van (settings:work_log_check:org_<id>).

CREATE TABLE IF NOT EXISTS app__racona_work.work_log_alerts (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    employee_id     INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    day             DATE NOT NULL,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, day)
);

CREATE INDEX IF NOT EXISTS idx_work_log_alerts_org_day
    ON app__racona_work.work_log_alerts (organization_id, day);

-- A vizsgálat dolgozónként és naponként keres bejegyzést
CREATE INDEX IF NOT EXISTS idx_work_entries_employee_date
    ON app__racona_work.work_entries (employee_id, work_date);
