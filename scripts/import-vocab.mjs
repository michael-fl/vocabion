#!/usr/bin/env node

/**
 * import-vocab.mjs
 *
 * Imports a vocabulary JSON file into a running Vocabion server via REST.
 *
 * Usage:
 *   node scripts/import-vocab.mjs <json-file>
 *
 * Output (stdout, JSON):
 *   { "imported": N, "merged": M, "new": K }
 *
 *   - imported: total entries in the file
 *   - merged:   entries that matched an existing DB entry (DE word overlap)
 *   - new:      entries that were inserted as brand-new entries (imported - merged)
 *
 * Exit codes:
 *   0 — success
 *   1 — usage error, file error, server unreachable, or server-side error
 */

import { readFileSync } from 'node:fs'

const SERVER_URL = 'http://localhost:3000'

const [, , filePath] = process.argv

if (!filePath) {
  console.error('Usage: node scripts/import-vocab.mjs <json-file>')
  process.exit(1)
}

let data
try {
  data = JSON.parse(readFileSync(filePath, 'utf8'))
} catch (err) {
  console.error(`Failed to read or parse "${filePath}": ${err.message}`)
  process.exit(1)
}

let response
try {
  response = await fetch(`${SERVER_URL}/api/v1/vocab/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
} catch {
  console.error(`Could not connect to the server at ${SERVER_URL}.`)
  console.error('Make sure the server is running: npm run dev:server')
  process.exit(1)
}

if (!response.ok) {
  const body = await response.text()
  console.error(`Import failed (HTTP ${response.status}): ${body}`)
  process.exit(1)
}

const result = await response.json()
const newEntries = result.imported - result.merged

console.log(JSON.stringify({ imported: result.imported, merged: result.merged, new: newEntries }))
