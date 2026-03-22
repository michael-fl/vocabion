-- Add first_answered_at column to sessions.
-- Records the ISO 8601 timestamp of when the first answer in a session was
-- submitted. Used to attribute the streak day to when the user started
-- practising rather than when they finished, so cross-midnight sessions
-- (started yesterday, completed today) do not break the streak.
-- NULL until the first answer is submitted.
ALTER TABLE sessions ADD COLUMN first_answered_at TEXT;
