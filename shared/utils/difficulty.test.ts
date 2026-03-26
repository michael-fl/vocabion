import { describe, it, expect } from 'vitest'
import { computeDifficulty } from './difficulty.ts'
import type { VocabEntry } from '../types/VocabEntry.ts'

function makeEntry(overrides: Partial<VocabEntry> = {}): VocabEntry {
  return {
    id: 'e1',
    source: 'Tisch',
    target: ['table'],
    bucket: 1,
    maxBucket: 1,
    maxScore: 0,
    difficulty: 0,
    manuallyAdded: false,
    marked: false,
    score: 0,
    lastAskedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    secondChanceDueAt: null,
    ...overrides,
  }
}

describe('computeDifficulty', () => {
  it('returns 0 for a simple single short target with no history', () => {
    expect(computeDifficulty(makeEntry({ target: ['table'], maxScore: 0 }))).toBe(0)
  })

  // ── Criterion 1: space in any target variant ───────────────────────────────

  it('adds +1 when one target variant contains a space', () => {
    expect(computeDifficulty(makeEntry({ target: ['fill up'], maxScore: 0 }))).toBe(1)
  })

  it('adds +1 when only one of multiple variants contains a space', () => {
    expect(computeDifficulty(makeEntry({ target: ['pool', 'swimming pool'], maxScore: 0 }))).toBe(2) // +1 space, +1 multiple
  })

  it('does not add space bonus when no variant has a space', () => {
    expect(computeDifficulty(makeEntry({ target: ['pool', 'basin'], maxScore: 0 }))).toBe(1) // only multiple bonus
  })

  it('does not add space bonus for a "to <verb>" target (trivial "to " prefix)', () => {
    expect(computeDifficulty(makeEntry({ target: ['to swim'], maxScore: 0 }))).toBe(0)
  })

  it('adds +1 when a "to <phrase>" target still has a space after stripping the prefix', () => {
    expect(computeDifficulty(makeEntry({ target: ['to go up'], maxScore: 0 }))).toBe(1)
  })

  // ── Criterion 2: multiple alternatives ────────────────────────────────────

  it('adds +1 when there are two target alternatives', () => {
    expect(computeDifficulty(makeEntry({ target: ['bicycle', 'bike'], maxScore: 0 }))).toBe(1)
  })

  it('adds +1 when there are three or more alternatives', () => {
    expect(computeDifficulty(makeEntry({ target: ['a', 'b', 'c'], maxScore: 0 }))).toBe(1)
  })

  it('does not add multiple bonus for a single target', () => {
    expect(computeDifficulty(makeEntry({ target: ['table'], maxScore: 0 }))).toBe(0)
  })

  // ── Criterion 3: all alternatives >= 10 characters ────────────────────────

  it('adds +1 when every target variant has >= 10 characters', () => {
    expect(computeDifficulty(makeEntry({ target: ['abcdefghij'], maxScore: 0 }))).toBe(1)
  })

  it('adds +1 when all of multiple variants have >= 10 characters', () => {
    expect(computeDifficulty(makeEntry({ target: ['abcdefghij', 'klmnopqrst'], maxScore: 0 }))).toBe(2) // +1 length, +1 multiple
  })

  it('adds +1 when more than one of multiple variants has >= 10 characters (but not all)', () => {
    expect(computeDifficulty(makeEntry({ target: ['abcdefghij', 'klmnopqrst', 'x'], maxScore: 0 }))).toBe(2) // +1 length, +1 multiple
  })

  it('does not add length bonus when only one of multiple variants has >= 10 characters', () => {
    expect(computeDifficulty(makeEntry({ target: ['abcdefghij', 'short'], maxScore: 0 }))).toBe(1) // only multiple bonus
  })

  it('does not add length bonus for a 9-character variant', () => {
    expect(computeDifficulty(makeEntry({ target: ['abcdefghi'], maxScore: 0 }))).toBe(0)
  })

  it('adds length bonus for exactly 10-character variant', () => {
    expect(computeDifficulty(makeEntry({ target: ['abcdefghij'], maxScore: 0 }))).toBe(1)
  })

  // ── Criterion 4: maxScore ─────────────────────────────────────────────────

  it('adds maxScore directly to difficulty', () => {
    expect(computeDifficulty(makeEntry({ target: ['table'], maxScore: 5 }))).toBe(5)
  })

  it('adds maxScore on top of structural criteria', () => {
    // space +1, multiple +1, length bonus: "abcdefghij" >= 10 but "short" not, maxScore 3
    expect(computeDifficulty(makeEntry({ target: ['abcde fghij', 'short'], maxScore: 3 }))).toBe(5) // +1 space, +1 multiple, +0 length, +3 score
  })

  // ── Combined maximum ──────────────────────────────────────────────────────

  it('returns sum of all criteria when all apply', () => {
    // space: "swimming pool" has space +1
    // multiple: two targets +1
    // length: both >= 10 chars +1
    // maxScore: 7
    const entry = makeEntry({ target: ['swimming pool', 'natatorium'], maxScore: 7 })

    expect(computeDifficulty(entry)).toBe(10) // 1+1+1+7
  })
})
