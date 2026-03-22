-- Recalculate difficulty with the updated lengthBonus criterion.
--
-- Old criterion: +1 if every target alternative has >= 10 characters.
-- New criterion: +1 if there is one target and it is >= 10 characters,
--                OR there are multiple targets and more than one is >= 10 characters.
UPDATE vocab_entries SET difficulty =
  -- spaceBonus: any target variant contains a space
  (CASE WHEN EXISTS (SELECT 1 FROM json_each(target) WHERE value LIKE '% %') THEN 1 ELSE 0 END)
  -- multipleBonus: more than one target alternative
  + (CASE WHEN json_array_length(target) > 1 THEN 1 ELSE 0 END)
  -- lengthBonus: single target >= 10, or multiple targets with more than one >= 10
  + (CASE
      WHEN (SELECT COUNT(*) FROM json_each(target) WHERE length(value) >= 10)
           >= (CASE WHEN json_array_length(target) = 1 THEN 1 ELSE 2 END)
      THEN 1 ELSE 0
    END)
  + max_score;
