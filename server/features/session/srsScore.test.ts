// @vitest-environment node

/**
 * Tests for the computeScore utility.
 */

import { describe, it, expect } from 'vitest'

import { computeScore } from './srsScore.ts'
import type { VocabEntry } from '../../../shared/types/VocabEntry.ts'

function makeEntry(overrides: Partial<VocabEntry> = {}): VocabEntry {
  return {
    id: 'entry-1',
    source: 'Wort',
    target: ['word'],
    bucket: 0,
    maxBucket: 0,
    manuallyAdded: false,
    marked: false,
    score: 0,
    lastAskedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('computeScore', () => {
  it('returns 0 for a plain entry with no errors, not marked, and no fall from peak', () => {
    expect(computeScore(makeEntry(), 0)).toBe(0)
  })

  it('counts each recent error as 1 point', () => {
    expect(computeScore(makeEntry(), 3)).toBe(3)
  })

  it('adds 2 points when the entry is marked', () => {
    expect(computeScore(makeEntry({ marked: true }), 0)).toBe(2)
  })

  it('combines error count and marked bonus', () => {
    expect(computeScore(makeEntry({ marked: true }), 4)).toBe(6)
  })

  it('adds fall-from-peak bonus when word dropped more than 2 buckets below its peak', () => {
    // maxBucket = 6, bucket = 1 → fall = 6 - 1 - 2 = 3
    expect(computeScore(makeEntry({ bucket: 1, maxBucket: 6 }), 0)).toBe(3)
  })

  it('gives no fall-from-peak bonus when word is within 2 buckets of its peak', () => {
    // maxBucket = 4, bucket = 3 → fall = max(4 - 3 - 2, 0) = 0
    expect(computeScore(makeEntry({ bucket: 3, maxBucket: 4 }), 0)).toBe(0)
  })

  it('gives no fall-from-peak bonus when word is exactly 2 buckets below its peak', () => {
    // maxBucket = 5, bucket = 3 → fall = max(5 - 3 - 2, 0) = 0
    expect(computeScore(makeEntry({ bucket: 3, maxBucket: 5 }), 0)).toBe(0)
  })

  it('gives 1 fall-from-peak point when word is 3 buckets below its peak', () => {
    // maxBucket = 5, bucket = 2 → fall = max(5 - 2 - 2, 0) = 1
    expect(computeScore(makeEntry({ bucket: 2, maxBucket: 5 }), 0)).toBe(1)
  })

  it('combines all three components', () => {
    // errors=2, marked=2, fall=max(7-2-2,0)=3 → total=7
    expect(computeScore(makeEntry({ bucket: 2, maxBucket: 7, marked: true }), 2)).toBe(7)
  })

  it('never returns a negative score', () => {
    // bucket above maxBucket (e.g. after import edge case) → fall clamped to 0
    expect(computeScore(makeEntry({ bucket: 5, maxBucket: 2 }), 0)).toBe(0)
  })
})
