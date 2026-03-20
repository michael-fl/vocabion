-- Initial schema: vocabulary entries and training sessions.

CREATE TABLE IF NOT EXISTS vocab_entries (
  id           TEXT PRIMARY KEY,
  de           TEXT NOT NULL,         -- JSON array of German forms
  en           TEXT NOT NULL,         -- JSON array of English forms
  bucket       INTEGER NOT NULL DEFAULT 0,
  last_asked_at TEXT,                 -- ISO 8601 timestamp or NULL
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id        TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK(direction IN ('DE_TO_EN', 'EN_TO_DE')),
  words     TEXT NOT NULL,            -- JSON array of SessionWord objects
  status    TEXT NOT NULL CHECK(status IN ('open', 'completed')),
  created_at TEXT NOT NULL
);
