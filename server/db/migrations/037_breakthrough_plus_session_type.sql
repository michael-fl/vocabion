-- Widen the CHECK constraint on sessions.type to include 'breakthrough_plus'.
-- SQLite does not support ALTER COLUMN, so the table must be rebuilt.
-- All columns from migration 034 are preserved.

PRAGMA foreign_keys = OFF;

CREATE TABLE sessions_new (
  id                TEXT PRIMARY KEY,
  direction         TEXT NOT NULL CHECK(direction IN ('SOURCE_TO_TARGET', 'TARGET_TO_SOURCE')),
  words             TEXT NOT NULL,
  status            TEXT NOT NULL CHECK(status IN ('open', 'completed')),
  created_at        TEXT NOT NULL,
  first_answered_at TEXT,
  type              TEXT NOT NULL DEFAULT 'normal' CHECK(type IN ('normal', 'repetition', 'focus', 'focus_quiz', 'discovery', 'starred', 'stress', 'veteran', 'breakthrough', 'breakthrough_plus', 'second_chance_session', 'recovery')),
  stress_high_stakes INTEGER
);

INSERT INTO sessions_new SELECT id, direction, words, status, created_at, first_answered_at, type, stress_high_stakes FROM sessions;

DROP TABLE sessions;

ALTER TABLE sessions_new RENAME TO sessions;

PRAGMA foreign_keys = ON;
