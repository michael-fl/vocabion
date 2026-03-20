#!/usr/bin/env node
/**
 * Produces a comparison table of avg questions/session for:
 *   S1 — 1 session per day,  10 new words/day
 *   S2 — 2 sessions per day, 20 new words/day (10 per session)
 *
 * SESSION_SIZE = 10, all answers correct, large vocabulary.
 */

// ── SRS core (mirrors srsSelection.ts) ───────────────────────────────────────

let nextId = 0
const newWord = () => ({ id: nextId++, bucket: 0, lastAskedAt: null })

const isDue = (w, nowMs) => {
  if (w.lastAskedAt === null) return true
  return nowMs - w.lastAskedAt >= (w.bucket - 3) * 7 * 86_400_000
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function groupByBucket(words) {
  const m = new Map()
  for (const w of words) {
    if (!m.has(w.bucket)) m.set(w.bucket, [])
    m.get(w.bucket).push(w)
  }
  return m
}

function selectFreq(freqWords, size) {
  const b0 = Math.round(size * 0.6), b1 = Math.round(size * 0.2)
  const b2 = Math.round(size * 0.08), b3 = Math.max(1, size - b0 - b1 - b2)
  const byB = groupByBucket(freqWords)
  const sel = [], used = new Set()
  const pick = (b, n) => {
    for (const w of shuffle(byB.get(b) ?? []).filter(w => !used.has(w.id)).slice(0, n)) {
      used.add(w.id); sel.push(w)
    }
  }
  pick(0, b0); pick(1, b1); pick(2, b2); pick(3, b3)
  const gap = size - sel.length
  if (gap > 0)
    for (const w of shuffle(freqWords.filter(w => !used.has(w.id))).slice(0, gap)) sel.push(w)
  return sel
}

function selectTime(timeWords, nowMs) {
  const sel = []
  for (const [, entries] of [...groupByBucket(timeWords).entries()].sort(([a],[b]) => a-b)) {
    const due = entries.filter(w => isDue(w, nowMs))
    if (due.length) sel.push(shuffle(due)[0])
  }
  return sel
}

function session(vocab, nowMs, size) {
  const sel = [
    ...selectFreq(vocab.filter(w => w.bucket <= 3), size),
    ...selectTime(vocab.filter(w => w.bucket >= 4), nowMs),
  ]
  for (const w of sel) { w.bucket++; w.lastAskedAt = nowMs }
  return sel.length
}

// ── Simulation ────────────────────────────────────────────────────────────────

function simulate({ sessionsPerDay, newWordsPerDay, years, sessionSize = 10 }) {
  nextId = 0
  const vocab = []
  const wordsPerSession = newWordsPerDay / sessionsPerDay
  const msPerSession    = 86_400_000 / sessionsPerDay
  const startMs         = Date.UTC(2020, 0, 1)
  const totalSessions   = years * 365 * sessionsPerDay

  // pre-seed
  for (let i = 0; i < wordsPerSession; i++) vocab.push(newWord())

  const allSizes = []
  const yearRows = [] // one entry per calendar year

  for (let s = 0; s < totalSessions; s++) {
    const nowMs = startMs + s * msPerSession
    if (s > 0)
      for (let i = 0; i < wordsPerSession; i++) vocab.push(newWord())

    allSizes.push(session(vocab, nowMs, sessionSize))

    const sessionsPerYear = 365 * sessionsPerDay
    if ((s + 1) % sessionsPerYear === 0) {
      const yearSlice = allSizes.slice(s + 1 - sessionsPerYear)
      const avg       = yearSlice.reduce((a, b) => a + b, 0) / yearSlice.length
      const buckets   = new Set(vocab.filter(w => w.bucket >= 4).map(w => w.bucket)).size
      yearRows.push({ avg, buckets })
    }
  }

  return yearRows
}

// ── Run both scenarios ────────────────────────────────────────────────────────

const YEARS = 10

console.log('\nRunning S1 (1 session/day, 10 new words/day)…')
const s1 = simulate({ sessionsPerDay: 1, newWordsPerDay: 10, years: YEARS })

console.log('Running S2 (2 sessions/day, 20 new words/day)…')
const s2 = simulate({ sessionsPerDay: 2, newWordsPerDay: 20, years: YEARS })

// ── Table ─────────────────────────────────────────────────────────────────────

console.log(`
Avg questions per session — all answers correct, S1: 10 new words/day, S2: 20 new words/day

      ┌─────────────────────────────────────┬─────────────────────────────────────┐
      │  S1: 1 session / day                │  S2: 2 sessions / day               │
Year  │  Avg questions   Occupied buckets   │  Avg questions   Occupied buckets   │
──────┼─────────────────────────────────────┼─────────────────────────────────────┤`)

for (let y = 0; y < YEARS; y++) {
  const r1 = s1[y], r2 = s2[y]
  console.log(
    `  ${String(y + 1).padStart(2)}  │` +
    `        ${r1.avg.toFixed(1).padStart(5)}` +
    `              ${String(r1.buckets).padStart(3)}           │` +
    `        ${r2.avg.toFixed(1).padStart(5)}` +
    `              ${String(r2.buckets).padStart(3)}           │`
  )
}

console.log(`──────┴─────────────────────────────────────┴─────────────────────────────────────┘

Notes:
  • SESSION_SIZE = 10 (base freq words).  New words split evenly across sessions.
  • "Avg questions" = freq words (≈ 10) + time-based words (one per due bucket each session).
  • "Occupied buckets" = distinct time-based buckets (≥ 4) that have at least 1 word.
  • S2 adds twice as many new words per day (20 vs 10) → faster bucket progression
    → more occupied time-based buckets → more questions per session over time.
`)
