-- Rename language-specific columns to language-neutral names.
-- vocab_entries: de → source, en → target
-- sessions: direction values DE_TO_EN → SOURCE_TO_TARGET, EN_TO_DE → TARGET_TO_SOURCE

-- Rename columns in vocab_entries
ALTER TABLE vocab_entries RENAME COLUMN de TO source;
ALTER TABLE vocab_entries RENAME COLUMN en TO target;

-- Rebuild sessions table to change the direction CHECK constraint.
-- SQLite does not support ALTER TABLE ... MODIFY COLUMN, so we recreate the table.
CREATE TABLE sessions_new (
  id         TEXT PRIMARY KEY,
  direction  TEXT NOT NULL CHECK(direction IN ('SOURCE_TO_TARGET', 'TARGET_TO_SOURCE')),
  type       TEXT NOT NULL,
  words      TEXT NOT NULL,
  status     TEXT NOT NULL CHECK(status IN ('open', 'completed')),
  created_at TEXT NOT NULL
);

INSERT INTO sessions_new (id, direction, type, words, status, created_at)
SELECT
  id,
  CASE direction
    WHEN 'DE_TO_EN' THEN 'SOURCE_TO_TARGET'
    WHEN 'EN_TO_DE' THEN 'TARGET_TO_SOURCE'
    ELSE direction
  END,
  type,
  words,
  status,
  created_at
FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
