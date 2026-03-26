-- Widen the CHECK constraint on sessions.type to include all current session types
-- plus the new 'recovery' type.
-- SQLite does not support ALTER COLUMN, so the table must be rebuilt.
-- This also backfills 'stress', 'veteran', 'breakthrough', and 'second_chance_session',
-- which were added to the code after migration 019 without a constraint update.

PRAGMA foreign_keys = OFF;

CREATE TABLE sessions_new (
  id                TEXT PRIMARY KEY,
  direction         TEXT NOT NULL CHECK(direction IN ('SOURCE_TO_TARGET', 'TARGET_TO_SOURCE')),
  words             TEXT NOT NULL,
  status            TEXT NOT NULL CHECK(status IN ('open', 'completed')),
  created_at        TEXT NOT NULL,
  first_answered_at TEXT,
  type              TEXT NOT NULL DEFAULT 'normal' CHECK(type IN ('normal', 'repetition', 'focus', 'discovery', 'starred', 'stress', 'veteran', 'breakthrough', 'second_chance_session', 'recovery'))
);

INSERT INTO sessions_new SELECT id, direction, words, status, created_at, first_answered_at, type FROM sessions;

DROP TABLE sessions;

ALTER TABLE sessions_new RENAME TO sessions;

PRAGMA foreign_keys = ON;
