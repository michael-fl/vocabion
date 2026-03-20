-- Strip the JSON array wrapper from the `de` column.
-- Every entry now has exactly one German word stored as a plain string.
-- Before: ["Wort"]   After: Wort
UPDATE vocab_entries SET de = json_extract(de, '$[0]');
