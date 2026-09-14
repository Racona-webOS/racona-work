-- ============================================================================
-- A DOLGOZÓ RÉSZLEGE MEGSZŰNIK (specs/leave-balance-overview.md, D3, K1)
-- ============================================================================
-- A szabad szöveges részleg nem kellett: a dolgozók több projektben, változó
-- csapatokban dolgoznak, a csoportosítás a projekttagságra épül. A mező a
-- felületről, az API-ból és az üdvözlő emailből is kikerült.
--
-- FIGYELEM: a meglévő részleg-értékek véglegesen elvesznek.

ALTER TABLE app__racona_work.employees
    DROP COLUMN IF EXISTS department;
