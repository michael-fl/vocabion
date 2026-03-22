/**
 * Tests for VocabEntry and SessionWord type guards.
 */

import { isVocabEntry, isSessionWord } from './VocabEntry.ts'
import type { VocabEntry, SessionWord } from './VocabEntry.ts'

// ── Helpers ──────────────────────────────────────────────────────────────────

function validEntry(): VocabEntry {
  return {
    id: 'abc-123',
    source: 'Tisch',
    target: ['table'],
    bucket: 0,
    maxBucket: 0,
    manuallyAdded: false,
    marked: false,
    score: 0,
    lastAskedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

function validWord(): SessionWord {
  return { vocabId: 'abc-123', status: 'pending' }
}

// ── isVocabEntry ──────────────────────────────────────────────────────────────

describe('isVocabEntry', () => {
  it('returns true for a valid entry with lastAskedAt null', () => {
    expect(isVocabEntry(validEntry())).toBe(true)
  })

  it('returns true for a valid entry with lastAskedAt set', () => {
    const entry = { ...validEntry(), lastAskedAt: '2026-03-01T10:00:00Z' }

    expect(isVocabEntry(entry)).toBe(true)
  })

  it('returns true when target has multiple translations', () => {
    const entry = { ...validEntry(), target: ['bicycle', 'bike'] }

    expect(isVocabEntry(entry)).toBe(true)
  })

  it('returns true for a word in a higher bucket', () => {
    expect(isVocabEntry({ ...validEntry(), bucket: 7 })).toBe(true)
  })

  it('returns false for null', () => {
    expect(isVocabEntry(null)).toBe(false)
  })

  it('returns false for a string', () => {
    expect(isVocabEntry('Tisch')).toBe(false)
  })

  it('returns false for a number', () => {
    expect(isVocabEntry(42)).toBe(false)
  })

  it('returns false for an array', () => {
    expect(isVocabEntry([])).toBe(false)
  })

  it('returns false when id is missing', () => {
    const { id: _id, ...rest } = validEntry()

    expect(isVocabEntry(rest)).toBe(false)
  })

  it('returns false when id is not a string', () => {
    expect(isVocabEntry({ ...validEntry(), id: 123 })).toBe(false)
  })

  it('returns false when source is missing', () => {
    const { source: _source, ...rest } = validEntry()

    expect(isVocabEntry(rest)).toBe(false)
  })

  it('returns false when source is not a string', () => {
    expect(isVocabEntry({ ...validEntry(), source: ['Tisch'] })).toBe(false)
  })

  it('returns false when source is an empty string', () => {
    expect(isVocabEntry({ ...validEntry(), source: '' })).toBe(false)
  })

  it('returns false when target is not an array', () => {
    expect(isVocabEntry({ ...validEntry(), target: 'table' })).toBe(false)
  })

  it('returns false when target contains a non-string element', () => {
    expect(isVocabEntry({ ...validEntry(), target: [true] })).toBe(false)
  })

  it('returns false when bucket is not a number', () => {
    expect(isVocabEntry({ ...validEntry(), bucket: '0' })).toBe(false)
  })

  it('returns false when bucket is a float', () => {
    expect(isVocabEntry({ ...validEntry(), bucket: 1.5 })).toBe(false)
  })

  it('returns false when bucket is negative', () => {
    expect(isVocabEntry({ ...validEntry(), bucket: -1 })).toBe(false)
  })

  it('returns true when maxBucket is greater than bucket', () => {
    expect(isVocabEntry({ ...validEntry(), bucket: 2, maxBucket: 5 })).toBe(true)
  })

  it('returns false when maxBucket is missing', () => {
    const { maxBucket: _m, ...rest } = validEntry()

    expect(isVocabEntry(rest)).toBe(false)
  })

  it('returns false when maxBucket is not an integer', () => {
    expect(isVocabEntry({ ...validEntry(), maxBucket: 1.5 })).toBe(false)
  })

  it('returns false when maxBucket is negative', () => {
    expect(isVocabEntry({ ...validEntry(), maxBucket: -1 })).toBe(false)
  })

  it('returns false when manuallyAdded is missing', () => {
    const { manuallyAdded: _m, ...rest } = validEntry()

    expect(isVocabEntry(rest)).toBe(false)
  })

  it('returns false when manuallyAdded is not a boolean', () => {
    expect(isVocabEntry({ ...validEntry(), manuallyAdded: 1 })).toBe(false)
  })

  it('returns false when lastAskedAt is neither null nor string', () => {
    expect(isVocabEntry({ ...validEntry(), lastAskedAt: 12345 })).toBe(false)
  })

  it('returns false when createdAt is missing', () => {
    const { createdAt: _c, ...rest } = validEntry()

    expect(isVocabEntry(rest)).toBe(false)
  })

  it('returns false when updatedAt is not a string', () => {
    expect(isVocabEntry({ ...validEntry(), updatedAt: null })).toBe(false)
  })
})

// ── isSessionWord ─────────────────────────────────────────────────────────────

describe('isSessionWord', () => {
  it('returns true for status "pending"', () => {
    expect(isSessionWord(validWord())).toBe(true)
  })

  it('returns true for status "correct"', () => {
    expect(isSessionWord({ ...validWord(), status: 'correct' })).toBe(true)
  })

  it('returns true for status "incorrect"', () => {
    expect(isSessionWord({ ...validWord(), status: 'incorrect' })).toBe(true)
  })

  it('returns false for null', () => {
    expect(isSessionWord(null)).toBe(false)
  })

  it('returns false when vocabId is missing', () => {
    const { vocabId: _v, ...rest } = validWord()

    expect(isSessionWord(rest)).toBe(false)
  })

  it('returns false when vocabId is not a string', () => {
    expect(isSessionWord({ ...validWord(), vocabId: 99 })).toBe(false)
  })

  it('returns false when status is an unknown string', () => {
    expect(isSessionWord({ ...validWord(), status: 'skipped' })).toBe(false)
  })

  it('returns false when status is missing', () => {
    const { status: _s, ...rest } = validWord()

    expect(isSessionWord(rest)).toBe(false)
  })
})
