ALTER TABLE vocab_entries ADD COLUMN max_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vocab_entries ADD COLUMN difficulty INTEGER NOT NULL DEFAULT 0;

-- Backfill max_score from current score (best available approximation).
UPDATE vocab_entries SET max_score = score;

-- Backfill difficulty using the stored target JSON.
-- criterion 1: any target variant contains a space (+1)
-- criterion 2: more than one target alternative (+1)
-- criterion 3: every target alternative has >= 10 characters (+1)
-- criterion 4: max_score
UPDATE vocab_entries SET difficulty =
  (CASE WHEN EXISTS (SELECT 1 FROM json_each(target) WHERE value LIKE '% %') THEN 1 ELSE 0 END)
  + (CASE WHEN json_array_length(target) > 1 THEN 1 ELSE 0 END)
  + (CASE WHEN NOT EXISTS (SELECT 1 FROM json_each(target) WHERE length(value) < 10) THEN 1 ELSE 0 END)
  + max_score;
