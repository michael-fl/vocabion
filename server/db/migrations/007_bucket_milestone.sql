-- Global high-water mark: the highest bucket number ever reached by any word.
-- Used to award the new-bucket milestone bonus (100 credits) exactly once per
-- bucket level ≥ 6. This value never decreases.
ALTER TABLE credits ADD COLUMN max_bucket_ever INTEGER NOT NULL DEFAULT 0;

-- Backfill from existing vocab data so the column is accurate on upgrade.
UPDATE credits SET max_bucket_ever = (
  SELECT COALESCE(MAX(max_bucket), 0) FROM vocab_entries
);
