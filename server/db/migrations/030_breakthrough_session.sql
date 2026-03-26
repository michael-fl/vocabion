-- Track when the next automatic breakthrough session becomes available.
-- NULL means no breakthrough session has been scheduled yet.
-- When qualifying words first reach >= 5, this is set to today + random(0-48h).
-- After each breakthrough session completes, this is set to today + 6 days + random(0-48h).

ALTER TABLE credits ADD COLUMN breakthrough_session_due_at TEXT;
