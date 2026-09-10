-- Racona Work Plugin - A szabadságkeret összege nem lehet negatív
--
-- Számított keretnél az összeg eddig számított + korrekció + áthozott volt.
-- Ha a számított érték lecsökken (pl. kilépés után a jövő évi keret 0 lesz),
-- egy negatív korrekció negatív keretet adott. A keret legfeljebb 0 lehet;
-- a korrekció megmarad, a bontásban látszik. (A maradék továbbra is lehet
-- negatív: az a túlvett szabadság.) Részletek: specs/leave-entitlement.md

ALTER TABLE app__racona_work.leave_balances
    DROP CONSTRAINT IF EXISTS leave_balances_total_consistent;

UPDATE app__racona_work.leave_balances
   SET total_days = GREATEST(0, calculated_days + adjustment_days + carried_over_days)
 WHERE calculated_days IS NOT NULL
   AND total_days <> GREATEST(0, calculated_days + adjustment_days + carried_over_days);

ALTER TABLE app__racona_work.leave_balances
    ADD CONSTRAINT leave_balances_total_consistent
    CHECK (calculated_days IS NULL
           OR total_days = GREATEST(0, calculated_days + adjustment_days + carried_over_days));
