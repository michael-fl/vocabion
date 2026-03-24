/**
 * Tests for the srsDisplay utility functions.
 */
import { describe, it, expect } from 'vitest'

import { formatDueIn } from './srsDisplay.ts'
import type { VocabEntry } from '../../shared/types/VocabEntry.ts'

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE = '2026-03-12T12:00:00.000Z'
const NOW = new Date(BASE)

function makeEntry(bucket: number, lastAskedAt: string | null): VocabEntry {
  return {
    id: 'e1',
    source: 'Wort',
    target: ['word'],
    bucket,
    maxBucket: bucket,
    manuallyAdded: false,
    marked: false,
    score: 0,
    lastAskedAt,
    createdAt: BASE,
    updatedAt: BASE,
  }
}

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString()
}

function daysAgo(d: number): string {
  return new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString()
}

function weeksAgo(w: number): string {
  return new Date(NOW.getTime() - w * 7 * 24 * 60 * 60 * 1000).toISOString()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('formatDueIn', () => {
  it('returns "due now" when lastAskedAt is null', () => {
    expect(formatDueIn(makeEntry(4, null), NOW)).toBe('due now')
  })

  it('returns "due now" when the interval has already elapsed', () => {
    // bucket 4 → interval 1 day; asked 2 days ago → overdue
    expect(formatDueIn(makeEntry(4, daysAgo(2)), NOW)).toBe('due now')
  })

  it('returns "due now" when exactly at the interval boundary', () => {
    // bucket 4 → 1 day (24 h) interval; asked exactly 24 hours ago
    expect(formatDueIn(makeEntry(4, hoursAgo(24)), NOW)).toBe('due now')
  })

  it('returns minutes when less than 1 hour remains', () => {
    // bucket 4 → 1 day = 1440 min; asked 1381 min ago → 59 min left
    const lastAskedAt = new Date(NOW.getTime() - (1440 - 59) * 60 * 1000).toISOString()

    expect(formatDueIn(makeEntry(4, lastAskedAt), NOW)).toBe('in 59 minutes')
  })

  it('uses singular "minute" for exactly 1 minute remaining', () => {
    // bucket 4 → 1 day = 1440 min; asked 1439 min ago → 1 min left
    const lastAskedAt = new Date(NOW.getTime() - (1440 - 1) * 60 * 1000).toISOString()

    expect(formatDueIn(makeEntry(4, lastAskedAt), NOW)).toBe('in 1 minute')
  })

  it('returns hours when less than 1 day remains', () => {
    // bucket 4 → 24 h; asked 2 hours ago → 22 hours left
    expect(formatDueIn(makeEntry(4, hoursAgo(2)), NOW)).toBe('in 22 hours')
  })

  it('uses singular "hour" for exactly 1 hour remaining', () => {
    // bucket 4 → 24 h; asked 23 hours ago → 1 hour left
    expect(formatDueIn(makeEntry(4, hoursAgo(23)), NOW)).toBe('in 1 hour')
  })

  it('returns days when less than 7 days remain', () => {
    // bucket 5 → 1 week = 7 days; asked 4 days ago → 3 days left
    expect(formatDueIn(makeEntry(5, daysAgo(4)), NOW)).toBe('in 3 days')
  })

  it('uses singular "day" for exactly 1 day remaining', () => {
    // bucket 5 → 7 days; asked 6 days ago → 1 day left
    expect(formatDueIn(makeEntry(5, daysAgo(6)), NOW)).toBe('in 1 day')
  })

  it('returns weeks when 7 or more days remain', () => {
    // bucket 6 → 2 weeks interval; asked 0 hours ago → in 2 weeks
    expect(formatDueIn(makeEntry(6, hoursAgo(0)), NOW)).toBe('in 2 weeks')
  })

  it('uses singular "week" for exactly 1 week remaining', () => {
    // bucket 6 → 2 weeks; asked 1 week ago → 1 week left
    expect(formatDueIn(makeEntry(6, daysAgo(7)), NOW)).toBe('in 1 week')
  })

  it('correctly computes interval for higher buckets', () => {
    // bucket 8 → (8-4) = 4 weeks interval; asked 2 weeks ago → 2 weeks left
    expect(formatDueIn(makeEntry(8, weeksAgo(2)), NOW)).toBe('in 2 weeks')
  })
})
