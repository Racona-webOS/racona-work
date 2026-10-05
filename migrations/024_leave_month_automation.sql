-- Havi szabadság-ellenőrzés automatizálása (specs/leave-month-automation.md, 5. fejezet)
--
-- send_source: kézi (a HR gombja) vagy automatikus (a napi ütemezett feladat) kiküldés
-- reminder_count, last_reminded_at: a dolgozónak küldött emlékeztetők (D8)

ALTER TABLE app__racona_work.leave_month_confirmations
    ADD COLUMN IF NOT EXISTS send_source         VARCHAR(16) NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS reminder_count      INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_reminded_at    TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_month_confirmations_send_source_check') THEN
        ALTER TABLE app__racona_work.leave_month_confirmations
            ADD CONSTRAINT leave_month_confirmations_send_source_check
            CHECK (send_source IN ('manual', 'automatic'));
    END IF;
END $$;

-- Az emlékeztetők keresése: csak a válaszra váró tételek
CREATE INDEX IF NOT EXISTS idx_leave_month_confirmations_pending
    ON app__racona_work.leave_month_confirmations (organization_id, sent_at)
    WHERE status = 'pending';
