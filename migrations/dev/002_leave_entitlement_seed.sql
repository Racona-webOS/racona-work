-- Dev környezet: szabadságkeret-számítás tesztadatai
-- Ez a fájl NEM kerül bele az éles .raconapkg csomagba (migrations/dev/ almappa).
--
-- A dev seedek MINDEN indításkor és a rendes migrációk ELŐTT futnak, ezért:
--   - csak akkor csinál bármit, ha a 007-es migráció már lefutott (első
--     indításkor még nem, a következőtől igen),
--   - csak üres mezőt / üres listát tölt ki, a kézzel beírt adatot nem írja felül.

DO $$
DECLARE
    dev_employee_id INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'app__racona_work' AND table_name = 'employees' AND column_name = 'birth_date'
    ) THEN
        RETURN;
    END IF;

    SELECT e.id INTO dev_employee_id
      FROM app__racona_work.employees e
      JOIN auth.users u ON u.id = e.user_id
     WHERE u.email = 'dev@example.com'
     LIMIT 1;

    IF dev_employee_id IS NULL THEN
        RETURN;
    END IF;

    -- 1987-es születés, két gyerek: az egyik már elmúlt 16 éves, a másik fogyatékos
    UPDATE app__racona_work.employees
       SET birth_date = '1987-04-10'
     WHERE id = dev_employee_id AND birth_date IS NULL;

    IF NOT EXISTS (SELECT 1 FROM app__racona_work.employee_children WHERE employee_id = dev_employee_id) THEN
        INSERT INTO app__racona_work.employee_children (employee_id, label, birth_date, is_disabled)
        VALUES (dev_employee_id, 'Nagyobbik', '2008-09-01', FALSE),
               (dev_employee_id, 'Kisebbik', '2016-03-15', TRUE);
    END IF;
END $$;
