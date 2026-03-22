-- Recalculate difficulty with the updated spaceBonus criterion.
--
-- Old criterion: +1 if any target variant contains a space.
-- New criterion: +1 if any target variant contains a space after stripping
--               a leading "to " prefix ("to fill up" qualifies, "to replenish" does not).
UPDATE vocab_entries SET difficulty =
  -- spaceBonus: any target variant (with "to " prefix stripped) still contains a space
  (CASE WHEN EXISTS (
    SELECT 1 FROM json_each(target)
    WHERE (CASE WHEN value LIKE 'to %' THEN SUBSTR(value, 4) ELSE value END) LIKE '% %'
  ) THEN 1 ELSE 0 END)
  -- multipleBonus: more than one target alternative
  + (CASE WHEN json_array_length(target) > 1 THEN 1 ELSE 0 END)
  -- lengthBonus: single target >= 10, or multiple targets with more than one >= 10
  + (CASE
      WHEN (SELECT COUNT(*) FROM json_each(target) WHERE length(value) >= 10)
           >= (CASE WHEN json_array_length(target) = 1 THEN 1 ELSE 2 END)
      THEN 1 ELSE 0
    END)
  + max_score;
