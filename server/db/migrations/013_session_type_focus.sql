-- Widen the CHECK constraint on sessions.type to include 'focus'.
-- SQLite does not support ALTER COLUMN, so the table must be rebuilt.

PRAGMA foreign_keys = OFF;

CREATE TABLE sessions_new (
  id         TEXT PRIMARY KEY,
  direction  TEXT NOT NULL CHECK(direction IN ('DE_TO_EN', 'EN_TO_DE')),
  words      TEXT NOT NULL,
  status     TEXT NOT NULL CHECK(status IN ('open', 'completed')),
  created_at TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'normal' CHECK(type IN ('normal', 'repetition', 'focus'))
);

INSERT INTO sessions_new SELECT id, direction, words, status, created_at, type FROM sessions;

DROP TABLE sessions;

ALTER TABLE sessions_new RENAME TO sessions;

PRAGMA foreign_keys = ON;
