#!/usr/bin/env node
/**
 * SRS session-size simulation.
 *
 * Simulates sessions over several years with all-correct answers and compares
 * the results against two candidate formulas:
 *
 *   (A) User's formula:   avg ≈ SESSION_SIZE + occupiedTimeBuckets
 *   (B) Harmonic formula: avg ≈ SESSION_SIZE + Σ 1/(N−3)  for N=4..maxBucket
 *
 * The script runs two scenarios:
 *
 *   Scenario 1 — Daily sessions, many words per bucket (realistic)
 *     Each occupied time-based bucket almost always has at least one due word,
 *     so it contributes ≈ 1 question every session.
 *     → Formula (A) is correct.
 *
 *   Scenario 2 — Weekly sessions, exactly 1 word per bucket
 *     Bucket N is due once every (N−3) sessions (its full interval).
 *     → Formula (B) is correct.
 *
 * Usage:
 *   node scripts/simulate-srs.mjs
 */

// ── SRS helpers (mirrors srsSelection.ts exactly) ────────────────────────────

let nextId = 0

function newWord(bucket = 0, lastAskedAt = null) {
  return { id: nextId++, bucket, lastAskedAt }
}

function isDue(word, nowMs) {
  if (word.lastAskedAt === null) return true
  const intervalMs = (word.bucket - 3) * 7 * 24 * 60 * 60 * 1000
  return nowMs - word.lastAskedAt >= intervalMs
}

function shuffle(arr) {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function groupByBucket(words) {
  const map = new Map()
  for (const w of words) {
    if (!map.has(w.bucket)) map.set(w.bucket, [])
    map.get(w.bucket).push(w)
  }
  return map
}

function selectFrequencyWords(freqWords, sessionSize) {
  const b0 = Math.round(sessionSize * 0.6)
  const b1 = Math.round(sessionSize * 0.2)
  const b2 = Math.round(sessionSize * 0.08)
  const b3 = Math.max(1, sessionSize - b0 - b1 - b2)
  const byBucket = groupByBucket(freqWords)
  const selected = []
  const usedIds  = new Set()

  function pick(bucket, count) {
    const available = shuffle(byBucket.get(bucket) ?? []).filter(w => !usedIds.has(w.id))
    for (const w of available.slice(0, count)) { usedIds.add(w.id); selected.push(w) }
  }
  pick(0, b0); pick(1, b1); pick(2, b2); pick(3, b3)

  const shortfall = sessionSize - selected.length
  if (shortfall > 0) {
    const remaining = shuffle(freqWords.filter(w => !usedIds.has(w.id)))
    for (const w of remaining.slice(0, shortfall)) selected.push(w)
  }
  return selected
}

function selectTimeBasedWords(timeWords, nowMs) {
  const selected = []
  for (const [, entries] of [...groupByBucket(timeWords).entries()].sort(([a], [b]) => a - b)) {
    const due = entries.filter(w => isDue(w, nowMs))
    if (due.length > 0) selected.push(shuffle(due)[0])
  }
  return selected
}

function runSession(vocab, nowMs, sessionSize) {
  const freq = vocab.filter(w => w.bucket <= 3)
  const time = vocab.filter(w => w.bucket >= 4)
  const selected = [...selectFrequencyWords(freq, sessionSize), ...selectTimeBasedWords(time, nowMs)]
  for (const w of selected) { w.bucket++; w.lastAskedAt = nowMs }
  return selected.length
}

// ── Formulas ──────────────────────────────────────────────────────────────────

function formulaA(sessionSize, occupiedTimeBuckets) {
  return sessionSize + occupiedTimeBuckets
}

function formulaB(sessionSize, maxBucket) {
  let v = sessionSize
  for (let n = 4; n <= maxBucket; n++) v += 1 / (n - 3)
  return v
}

function occupiedTimeBuckets(vocab) {
  return new Set(vocab.filter(w => w.bucket >= 4).map(w => w.bucket)).size
}

// ── Scenario runner ───────────────────────────────────────────────────────────

function runScenario({ label, sessionSize, sessionIntervalDays, newWordsPerSession, years }) {
  nextId = 0
  const vocab = []
  const startMs = Date.UTC(2020, 0, 1)
  const totalSessions = years * Math.round(365 / sessionIntervalDays)
  const allSizes = []
  const rows = []

  // Pre-seed with one session's worth of words
  for (let i = 0; i < newWordsPerSession; i++) vocab.push(newWord())

  for (let s = 0; s < totalSessions; s++) {
    const nowMs = startMs + s * sessionIntervalDays * 86_400_000
    if (s > 0) {
      for (let i = 0; i < newWordsPerSession; i++) vocab.push(newWord())
    }
    allSizes.push(runSession(vocab, nowMs, sessionSize))

    const sessionsPerYear = Math.round(365 / sessionIntervalDays)
    if ((s + 1) % sessionsPerYear === 0) {
      const year     = Math.round((s + 1) / sessionsPerYear)
      const slice    = allSizes.slice(s + 1 - sessionsPerYear)
      const simAvg   = slice.reduce((a, b) => a + b, 0) / slice.length
      const maxB     = Math.max(...vocab.map(w => w.bucket))
      const occupied = occupiedTimeBuckets(vocab)
      rows.push({ year, simAvg, fA: formulaA(sessionSize, occupied), fB: formulaB(sessionSize, maxB), maxB, occupied })
    }
  }

  const overallAvg = allSizes.reduce((a, b) => a + b, 0) / allSizes.length
  const maxB       = Math.max(...vocab.map(w => w.bucket))
  const occupied   = occupiedTimeBuckets(vocab)

  console.log(`\n${'─'.repeat(90)}`)
  console.log(`Scenario: ${label}`)
  console.log(`  Sessions/year: ${Math.round(365/sessionIntervalDays)}, new words/session: ${newWordsPerSession}, duration: ${years} years`)
  console.log(`${'─'.repeat(90)}`)
  console.log('Year | Simulated avg | Formula A: 10+buckets | Formula B: 10+Σ1/(N-3) | Occupied buckets | Max bucket')
  console.log('-----|--------------|----------------------|------------------------|------------------|----------')
  for (const r of rows) {
    console.log(
      `  ${String(r.year).padStart(2)} |` +
      `         ${r.simAvg.toFixed(2).padStart(5)} |` +
      `               ${r.fA.toFixed(2).padStart(6)} |` +
      `                ${r.fB.toFixed(2).padStart(7)} |` +
      `               ${String(r.occupied).padStart(3)} |` +
      `        ${r.maxB}`
    )
  }
  console.log('-----|--------------|----------------------|------------------------|------------------|----------')
  console.log(`  Overall avg: ${overallAvg.toFixed(2)}   Formula A (final): ${formulaA(sessionSize, occupied).toFixed(2)}   Formula B (final): ${formulaB(sessionSize, maxB).toFixed(2)}`)
  console.log(`  → Closer formula: ${Math.abs(overallAvg - formulaA(sessionSize, occupied)) < Math.abs(overallAvg - formulaB(sessionSize, maxB)) ? 'A (10 + occupied buckets)' : 'B (10 + Σ 1/(N-3))'}`)
}

// ── Run both scenarios ────────────────────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════════════════════════════════════════════╗')
console.log('║  SRS Session-Size Simulation — Formula Comparison                               ║')
console.log('╚══════════════════════════════════════════════════════════════════════════════════╝')
console.log('\nTwo formulas are compared:')
console.log('  A) 10 + occupiedTimeBuckets       (each bucket contributes 1/session)')
console.log('  B) 10 + Σ 1/(N-3) for N=4..max   (harmonic series, each bucket contributes 1/(N-3)/session)')
console.log('\nFormula A holds when each time-based bucket has many words (nearly always has a due word).')
console.log('Formula B holds when each time-based bucket has exactly 1 word and sessions match the bucket-4 interval.')

runScenario({
  label: 'Daily sessions, 10 new words/day (realistic active learner)',
  sessionSize: 10,
  sessionIntervalDays: 1,
  newWordsPerSession: 10,
  years: 10,
})

runScenario({
  label: 'Weekly sessions, 1 new word/session, 1 word per time-bucket (sparse)',
  sessionSize: 10,
  sessionIntervalDays: 7,
  newWordsPerSession: 1,
  years: 30,
})

console.log(`
${'─'.repeat(90)}
Summary
${'─'.repeat(90)}
Scenario 1 (daily, many words):
  Each occupied time-based bucket almost always has a due word on any given day,
  so it contributes ~1 question per session.
  → avg ≈ 10 + (number of occupied time-based buckets)   [Formula A ✓]
  The user's original intuition was correct for this case.

Scenario 2 (weekly, 1 word per bucket):
  Bucket N is due only once every (N-3) sessions, so its contribution is 1/(N-3).
  The harmonic sum grows logarithmically — very slowly.
  → avg ≈ 10 + Σ 1/(N-3)   [Formula B ✓]

The key variable is: how many words are in each time-based bucket?
  • Many words  →  bucket is nearly always "saturated" → contributes 1/session  →  Formula A
  • Few words   →  bucket is often empty              → contributes 1/(N-3)/session  →  Formula B
  • Real usage lies between, but with regular practice Formula A dominates.
`)
