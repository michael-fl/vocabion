-- Track when the next automatic stress session becomes available.
-- NULL means no stress session has been scheduled yet.
-- When the credit balance first reaches >= 500, this is set to today + random(0-48h).
-- After each stress session completes, this is set to today + 7 days + random(0-48h).

ALTER TABLE credits ADD COLUMN stress_session_due_at TEXT;
