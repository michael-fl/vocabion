-- Add a persistent counter for earned stars.
-- Stars are a gamification watermark that only ever increases.
-- The mapping from bucket level to stars is applied at the application layer.

ALTER TABLE credits ADD COLUMN earned_stars INTEGER NOT NULL DEFAULT 0;

-- Backfill: derive initial star count from the personal-best bucket column
-- on vocab_entries (max_bucket), so existing users keep their progress.
-- Formula: stars = MAX(0, max_bucket_ever - 3), where bucket 4 = 1 star.
UPDATE credits
SET earned_stars = (
  SELECT MAX(0, COALESCE(MAX(max_bucket), 0) - 3)
  FROM vocab_entries
)
WHERE id = 1;
