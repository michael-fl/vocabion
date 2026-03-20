-- Add session type column to distinguish normal (learning) sessions from repetition sessions.
-- Existing rows default to 'normal'.

ALTER TABLE sessions ADD COLUMN type TEXT NOT NULL DEFAULT 'normal'
  CHECK(type IN ('normal', 'repetition'));
