-- Daily practice streak tracking.
-- streak_count: consecutive days the user has practiced.
-- last_session_date: YYYY-MM-DD (UTC) of the last session that counted toward the streak.
-- streak_save_pending: set to 1 when the user has paid to save a broken streak but not yet answered the first question.
ALTER TABLE credits ADD COLUMN streak_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credits ADD COLUMN last_session_date TEXT;
ALTER TABLE credits ADD COLUMN streak_save_pending INTEGER NOT NULL DEFAULT 0;
