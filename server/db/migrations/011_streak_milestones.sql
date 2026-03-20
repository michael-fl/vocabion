-- Streak milestone tracking columns.
-- streak_start_date: the calendar date (YYYY-MM-DD, UTC) on which the current streak began.
--   Initialised from existing data as last_session_date - (streak_count - 1) days.
-- streak_weeks_awarded: how many weekly milestones (0, 1, or 2) have been paid for the current streak.
-- streak_months_awarded: how many monthly milestones have been paid for the current streak.
-- All three columns are reset to their defaults whenever the streak resets to 1.

ALTER TABLE credits ADD COLUMN streak_start_date TEXT;
ALTER TABLE credits ADD COLUMN streak_weeks_awarded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credits ADD COLUMN streak_months_awarded INTEGER NOT NULL DEFAULT 0;

-- Backfill streak_start_date for any existing streak.
UPDATE credits
SET streak_start_date = date(last_session_date, '-' || (streak_count - 1) || ' days')
WHERE last_session_date IS NOT NULL AND streak_count > 0;
