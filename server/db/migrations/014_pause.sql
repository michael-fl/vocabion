-- Streak pause budget tracking.
-- pause_active:      1 while the user is in pause mode, 0 otherwise.
-- pause_start_date:  YYYY-MM-DD of the first paused day (retroactive — day after last session).
-- pause_days_used:   total pause days consumed by completed pauses in the current calendar year.
-- pause_budget_year: the calendar year pause_days_used belongs to; resets when the year changes.
ALTER TABLE credits ADD COLUMN pause_active      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credits ADD COLUMN pause_start_date  TEXT;
ALTER TABLE credits ADD COLUMN pause_days_used   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credits ADD COLUMN pause_budget_year INTEGER NOT NULL DEFAULT 0;
