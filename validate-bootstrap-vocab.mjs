/**
 * Validates bootstrap-vocabulary.json against the expected import format
 * for the /api/v1/vocab/import endpoint.
 *
 * Checks:
 *   1. File is valid JSON
 *   2. Top-level structure matches the import format
 *   3. Each entry has the required fields with correct types
 *   4. No duplicate German or English terms across entries
 *
 * Run with: node validate-bootstrap-vocab.mjs
 */

import { readFileSync } from 'fs'

const FILE = 'bootstrap-vocabulary.json'
let exitCode = 0

function fail(msg) {
  console.error(`  FAIL  ${msg}`)
  exitCode = 1
}

function pass(msg) {
  console.log(`  PASS  ${msg}`)
}

// ── 1. Parse JSON ────────────────────────────────────────────────────────────

let data

try {
  const raw = readFileSync(FILE, 'utf-8')
  data = JSON.parse(raw)
  pass('File is valid JSON')
} catch (err) {
  fail(`File is not valid JSON: ${err.message}`)
  process.exit(1)
}

// ── 2. Top-level structure ───────────────────────────────────────────────────

if (data.version === 1) {
  pass('version is 1')
} else {
  fail(`version must be 1, got: ${JSON.stringify(data.version)}`)
}

if (typeof data.exportedAt === 'string' && data.exportedAt.length > 0) {
  pass('exportedAt is present')
} else {
  fail('exportedAt must be a non-empty string')
}

if (Array.isArray(data.entries)) {
  pass(`entries is an array (${data.entries.length} entries)`)
} else {
  fail('entries must be an array')
  process.exit(1)
}

if (data.entries.length >= 1) {
  pass(`entry count is ${data.entries.length}`)
} else {
  fail('entries array must not be empty')
}

// ── 3. Validate each entry ───────────────────────────────────────────────────

let entryErrors = 0

data.entries.forEach((entry, i) => {
  const label = `entries[${i}]`

  if (!Array.isArray(entry.de) || entry.de.length < 1) {
    fail(`${label}: "de" must be a non-empty array of strings`)
    entryErrors++
  }

  if (!Array.isArray(entry.en) || entry.en.length < 1) {
    fail(`${label}: "en" must be a non-empty array of strings`)
    entryErrors++
  }

  const allStrings =
    (Array.isArray(entry.de) && entry.de.every(v => typeof v === 'string')) &&
    (Array.isArray(entry.en) && entry.en.every(v => typeof v === 'string'))

  if (!allStrings) {
    fail(`${label}: all values in "de" and "en" must be strings`)
    entryErrors++
  }

  if (typeof entry.bucket !== 'number' || !Number.isInteger(entry.bucket) || entry.bucket < 0) {
    fail(`${label}: "bucket" must be a non-negative integer`)
    entryErrors++
  }
})

if (entryErrors === 0) {
  pass(`All ${data.entries.length} entries have valid structure`)
}

// ── 4. Duplicate detection ───────────────────────────────────────────────────

const seenDe = new Map()
const seenEn = new Map()
let duplicateErrors = 0

data.entries.forEach((entry, i) => {
  for (const term of (entry.de ?? [])) {
    const key = term.toLowerCase().trim()

    if (seenDe.has(key)) {
      fail(`Duplicate German term "${term}" in entries[${i}] (first seen in entries[${seenDe.get(key)}])`)
      duplicateErrors++
    } else {
      seenDe.set(key, i)
    }
  }

  for (const term of (entry.en ?? [])) {
    const key = term.toLowerCase().trim()

    if (seenEn.has(key)) {
      fail(`Duplicate English term "${term}" in entries[${i}] (first seen in entries[${seenEn.get(key)}])`)
      duplicateErrors++
    } else {
      seenEn.set(key, i)
    }
  }
})

if (duplicateErrors === 0) {
  pass(`No duplicate German terms (${seenDe.size} unique)`)
  pass(`No duplicate English terms (${seenEn.size} unique)`)
}

// ── 5. Summary ───────────────────────────────────────────────────────────────

console.log()

if (exitCode === 0) {
  console.log(`bootstrap-vocabulary.json is valid (${data.entries.length} entries, no duplicates).`)
} else {
  console.error('Validation failed. See errors above.')
}

process.exit(exitCode)
