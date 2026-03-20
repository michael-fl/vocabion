/**
 * Verifies that every entry from bootstrap-vocabulary.json was stored in the
 * SQLite database. Run with: node scripts/verify-import.mjs
 */

import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DB_PATH = process.env.DB_PATH ?? './vocabion.db'
const JSON_PATH = join(import.meta.dirname, '..', 'bootstrap-vocabulary.json')

const source = JSON.parse(readFileSync(JSON_PATH, 'utf-8'))
const db = new Database(DB_PATH, { readonly: true })

const rows = db.prepare('SELECT de, en, bucket FROM vocab_entries').all()

// Parse the stored JSON arrays for comparison
const stored = rows.map((row) => ({
  de: JSON.parse(row.de),
  en: JSON.parse(row.en),
  bucket: row.bucket,
}))

let passed = 0
let failed = 0

for (const expected of source.entries) {
  const match = stored.find(
    (s) =>
      JSON.stringify(s.de) === JSON.stringify(expected.de) &&
      JSON.stringify(s.en) === JSON.stringify(expected.en) &&
      s.bucket === expected.bucket,
  )

  if (match) {
    passed++
  } else {
    console.error(`MISSING: de=${JSON.stringify(expected.de)} en=${JSON.stringify(expected.en)}`)
    failed++
  }
}

console.log(`\nResults: ${passed} found, ${failed} missing out of ${source.entries.length} total`)

if (failed > 0) {
  process.exit(1)
} else {
  console.log('All entries verified successfully.')
}

db.close()
