-- Backfill max_bucket for entries that existed before the credit system was
-- introduced. Migration 003 added the column with DEFAULT 0 but never
-- populated it. The current bucket is the best available approximation of
-- the historical highest bucket.
UPDATE vocab_entries SET max_bucket = bucket WHERE max_bucket < bucket;

-- Credit balance counter — single row, id = 1 enforced by CHECK constraint.
-- Initialise the balance from the (now backfilled) max_bucket data so that
-- words already learned before this migration are properly credited.
CREATE TABLE credits (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  balance INTEGER NOT NULL DEFAULT 0
);

INSERT INTO credits (id, balance)
SELECT 1, COALESCE(SUM(MAX(0, max_bucket - 3)), 0)
FROM vocab_entries;
