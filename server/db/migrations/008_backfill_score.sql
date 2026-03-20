-- Backfill the score column for entries that existed before migration 006
-- (which added the column with DEFAULT 0 but did not compute existing values).
--
-- The recentErrorCount component cannot be computed from SQL here, but the
-- other two components can:
--   score = (marked ? 1 : 0) + max(maxBucket − bucket − 2, 0)
--
-- The recentErrorCount component will be added automatically the next time
-- each word is answered or marked/unmarked.
UPDATE vocab_entries
SET score = (CASE WHEN marked = 1 THEN 1 ELSE 0 END)
          + MAX(0, max_bucket - bucket - 2)
WHERE score = 0;
