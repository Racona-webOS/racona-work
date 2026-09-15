-- ============================================================================
-- KÜLSŐS DOLGOZÓK (specs/external-employees.md)
-- ============================================================================
-- A külsős dolgozó csak a projektekben vesz részt (tagság, munkanapló, riport).
-- A szabadság, a kiküldetések, az irányítópult és a többi funkció nem vonatkozik
-- rá: a szervezeti listákból kimarad, és a szerepeiből csak a projekt- és
-- munkanapló-képességek érvényesek.

ALTER TABLE app__racona_work.employees
    ADD COLUMN IF NOT EXISTS is_external BOOLEAN NOT NULL DEFAULT FALSE;
