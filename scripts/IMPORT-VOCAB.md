# Vocabulary Import Guide for AI Agents

This document describes how to import AI-generated vocabulary into Vocabion.
Read this file before performing any vocabulary import.

## Prerequisites

The Vocabion server must be running on `http://localhost:3000` before importing.
Start it with: `npm run dev:server`

## Import file format

The import file is JSON and must match this structure:

```json
{
  "version": 1,
  "exportedAt": "<ISO 8601 timestamp>",
  "entries": [
    { "de": ["Wort"], "en": ["word"] },
    { "de": ["Auto", "Automobil"], "en": ["car", "automobile"] }
  ]
}
```

- `de` and `en` are arrays of strings (one or more variants per entry).
- `bucket` is intentionally omitted — new entries start at bucket 0.
- Each entry represents one concept. Group synonyms/variants in one entry.

## Word quality rules

When generating words, follow these rules:

- **Topic focus**: only include words clearly relevant to the requested topic.
- **No duplicates within a file**: each concept appears once; merge synonyms into one entry.
- **Sensible grouping**: `{ "de": ["Fahrrad"], "en": ["bicycle", "bike"] }` is one entry, not two.
- **Accurate translations**: both DE and EN sides must be correct.
- **No proper nouns**: no names, cities, brands.
- **No articles**: do not prefix German nouns with their article (der/die/das). Write `Tisch`, not `der Tisch`. Capitalisation already identifies nouns.

## Import script

```bash
node scripts/import-vocab.mjs <json-file>
```

**Output** (stdout, JSON):
```json
{ "imported": 20, "merged": 3, "new": 17 }
```

- `imported`: total entries processed from the file
- `merged`: entries merged into an existing DB entry (not counted as new)
- `new`: entries inserted as brand-new (`imported − merged`)

**Exit code 0** = success. **Exit code 1** = error (message on stderr).

## Full import workflow

When asked to import N new words on a topic, follow this loop:

```
target = N
total_new = 0
attempts = 0
max_attempts = 3

while total_new < target and attempts < max_attempts:
    missing = target - total_new
    attempts += 1

    1. Generate `missing` German–English word pairs for the topic.
       Do NOT repeat words already generated in earlier iterations.
    2. Write them to a temporary file, e.g. /tmp/import-<topic>-<attempt>.json
    3. Run: node scripts/import-vocab.mjs /tmp/import-<topic>-<attempt>.json
    4. Parse the JSON output. Add output["new"] to total_new.

if total_new < target:
    Inform the user: "Imported <total_new> new words out of <target> requested.
    Some words already existed in the database or the topic may be exhausted."
else:
    Inform the user: "Successfully imported <total_new> new words on topic <topic>."
```

## Example interaction

> "Import 50 new words from the topic sports into Vocabion."

1. Generate 50 sport-related DE/EN word pairs → write to `/tmp/import-sports-1.json`
2. Run `node scripts/import-vocab.mjs /tmp/import-sports-1.json`
3. Output: `{ "imported": 50, "merged": 8, "new": 42 }` → 42 new, 8 missing
4. Generate 8 more sport words (different from the first batch) → `/tmp/import-sports-2.json`
5. Run script → `{ "imported": 8, "merged": 1, "new": 7 }` → 49 new total, 1 still missing
6. Generate 1 more → `/tmp/import-sports-3.json`
7. Run script → `{ "imported": 1, "merged": 0, "new": 1 }` → 50 total ✓
8. Report: "Successfully imported 50 new words on topic sports."
