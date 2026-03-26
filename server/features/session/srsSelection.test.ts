// @vitest-environment node

/**
 * Tests for the SRS word selection algorithm.
 */

import { describe, it, expect } from 'vitest'

import { isDue, selectSessionWords, selectRepetitionWords, selectFocusWords, selectDiscoveryWords, selectStarredWords, selectStressWords, selectVeteranWords, selectBreakthroughWords, selectSecondChanceSessionWords } from './srsSelection.ts'
import type { VocabEntry } from '../../../shared/types/VocabEntry.ts'

// ── Helpers ───────────────────────────────────────────────────────────────────

let idCounter = 0

function makeEntry(overrides: Partial<VocabEntry> = {}): VocabEntry {
  idCounter++
  return {
    id: `entry-${idCounter}`,
    source: 'Wort',
    target: ['word'],
    bucket: 0,
    lastAskedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    secondChanceDueAt: null,
    maxBucket: 0,
    maxScore: 0,
    difficulty: 0,
    manuallyAdded: false,
    marked: false,
    score: 0,
    ...overrides,
  }
}

function makeEntries(count: number, overrides: Partial<VocabEntry> = {}): VocabEntry[] {
  return Array.from({ length: count }, () => makeEntry(overrides))
}

const NOW = new Date('2026-06-01T12:00:00Z')

// ── isDue ─────────────────────────────────────────────────────────────────────

describe('isDue', () => {
  it('returns true when lastAskedAt is null', () => {
    const entry = makeEntry({ bucket: 4, lastAskedAt: null })

    expect(isDue(entry, NOW)).toBe(true)
  })

  it('returns true for bucket 4 when 24 or more hours have passed', () => {
    const twentyFourHoursAgo = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const entry = makeEntry({ bucket: 4, lastAskedAt: twentyFourHoursAgo })

    expect(isDue(entry, NOW)).toBe(true)
  })

  it('returns false for bucket 4 when fewer than 24 hours have passed', () => {
    const twentyThreeHoursAgo = new Date(NOW.getTime() - 23 * 60 * 60 * 1000).toISOString()
    const entry = makeEntry({ bucket: 4, lastAskedAt: twentyThreeHoursAgo })

    expect(isDue(entry, NOW)).toBe(false)
  })

  it('returns true for bucket 5 when 7 or more days have passed', () => {
    const sevenDaysAgo = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const entry = makeEntry({ bucket: 5, lastAskedAt: sevenDaysAgo })

    expect(isDue(entry, NOW)).toBe(true)
  })

  it('returns false for bucket 5 when fewer than 7 days have passed', () => {
    const sixDaysAgo = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString()
    const entry = makeEntry({ bucket: 5, lastAskedAt: sixDaysAgo })

    expect(isDue(entry, NOW)).toBe(false)
  })

  it('returns true for bucket 6 when exactly 14 days have passed', () => {
    const fourteenDaysAgo = new Date(NOW.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const entry = makeEntry({ bucket: 6, lastAskedAt: fourteenDaysAgo })

    expect(isDue(entry, NOW)).toBe(true)
  })
})

// ── selectSessionWords — frequency words ─────────────────────────────────────

describe('selectSessionWords — frequency words', () => {
  it('selects sessionSize words from frequency buckets when enough are available', () => {
    const entries = [
      ...makeEntries(20, { bucket: 0 }),
      ...makeEntries(10, { bucket: 1 }),
      ...makeEntries(10, { bucket: 2 }),
      ...makeEntries(10, { bucket: 3 }),
    ]

    const selected = selectSessionWords(entries, 10, NOW)

    expect(selected).toHaveLength(10)
    expect(selected.every((e) => e.bucket <= 3)).toBe(true)
  })

  it('returns no duplicates', () => {
    const entries = makeEntries(30, { bucket: 0 })

    const selected = selectSessionWords(entries, 10, NOW)

    const ids = selected.map((e) => e.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('falls back to available words when buckets are sparse', () => {
    // Only 5 words total, session size 10
    const entries = makeEntries(5, { bucket: 0 })

    const selected = selectSessionWords(entries, 10, NOW)

    expect(selected).toHaveLength(5) // only 5 available
    expect(selected.every((e) => e.bucket <= 3)).toBe(true)
  })

  it('returns an empty array when there are no frequency words', () => {
    const selected = selectSessionWords([], 10, NOW)

    expect(selected).toEqual([])
  })

  it('draws 1 or 2 words from bucket 0', () => {
    const entries = [
      ...makeEntries(10, { bucket: 0 }),
      ...makeEntries(10, { bucket: 1 }),
      ...makeEntries(10, { bucket: 2 }),
      ...makeEntries(10, { bucket: 3 }),
    ]

    const selected = selectSessionWords(entries, 12, NOW)
    const b0count = selected.filter((e) => e.bucket === 0).length

    expect(b0count).toBeGreaterThanOrEqual(1)
    expect(b0count).toBeLessThanOrEqual(2)
  })

  it('draws exactly 1 from bucket 0 when only 1 word is available there', () => {
    const entries = [
      ...makeEntries(1, { bucket: 0 }),
      ...makeEntries(10, { bucket: 1 }),
      ...makeEntries(10, { bucket: 2 }),
      ...makeEntries(10, { bucket: 3 }),
    ]

    const selected = selectSessionWords(entries, 12, NOW)

    expect(selected.filter((e) => e.bucket === 0)).toHaveLength(1)
    expect(selected).toHaveLength(12)
  })

  it('draws 0 from bucket 0 when it is empty, filling entirely from buckets 1–3', () => {
    const entries = [
      ...makeEntries(10, { bucket: 1 }),
      ...makeEntries(10, { bucket: 2 }),
      ...makeEntries(10, { bucket: 3 }),
    ]

    const selected = selectSessionWords(entries, 12, NOW)

    expect(selected.filter((e) => e.bucket === 0)).toHaveLength(0)
    expect(selected).toHaveLength(12)
  })

  it('gives a larger bucket proportionally more words than a smaller one', () => {
    // bucket 0: exactly 1 word → b0count is always 1, remaining=11
    // bucket 1: 8 words, bucket 2: 2 words, bucket 3: 0 words → b1 should dominate
    const entries = [
      ...makeEntries(1, { bucket: 0 }),
      ...makeEntries(8, { bucket: 1 }),
      ...makeEntries(2, { bucket: 2 }),
    ]

    const selected = selectSessionWords(entries, 10, NOW)
    const b1count = selected.filter((e) => e.bucket === 1).length
    const b2count = selected.filter((e) => e.bucket === 2).length

    expect(b1count).toBeGreaterThan(b2count)
  })

  it('fills all slots from bucket 0 when buckets 1–3 are all empty', () => {
    const entries = makeEntries(20, { bucket: 0 })

    const selected = selectSessionWords(entries, 12, NOW)

    expect(selected).toHaveLength(12)
    expect(selected.every((e) => e.bucket === 0)).toBe(true)
  })

  it('produces sessionSize words even with a small session size', () => {
    const entries = [
      ...makeEntries(10, { bucket: 0 }),
      ...makeEntries(10, { bucket: 1 }),
      ...makeEntries(10, { bucket: 2 }),
      ...makeEntries(10, { bucket: 3 }),
    ]

    const selected = selectSessionWords(entries, 2, NOW)

    expect(selected).toHaveLength(2)
  })
})

// ── selectSessionWords — time-based words ────────────────────────────────────

describe('selectSessionWords — time-based words', () => {
  it('includes due time-based words in addition to frequency words', () => {
    const freqEntries = makeEntries(10, { bucket: 0 })
    const dueEntry = makeEntry({ bucket: 4, lastAskedAt: null })

    const selected = selectSessionWords([...freqEntries, dueEntry], 10, NOW)

    expect(selected.some((e) => e.id === dueEntry.id)).toBe(true)
    expect(selected).toHaveLength(11) // 10 freq + 1 time-based
  })

  it('excludes time-based words that are not yet due', () => {
    const freqEntries = makeEntries(10, { bucket: 0 })
    // bucket 4 → 1 day interval; asked 12 hours ago → not yet due
    const recentDate = new Date(NOW.getTime() - 12 * 60 * 60 * 1000).toISOString()
    const notDueEntry = makeEntry({ bucket: 4, lastAskedAt: recentDate })

    const selected = selectSessionWords([...freqEntries, notDueEntry], 10, NOW)

    expect(selected.some((e) => e.id === notDueEntry.id)).toBe(false)
  })

  it('picks at most 1 word per time-based bucket', () => {
    const freqEntries = makeEntries(10, { bucket: 0 })
    const bucket4Entries = makeEntries(5, { bucket: 4, lastAskedAt: null })

    const selected = selectSessionWords([...freqEntries, ...bucket4Entries], 10, NOW)
    const bucket4Selected = selected.filter((e) => e.bucket === 4)

    expect(bucket4Selected).toHaveLength(1)
  })

  it('picks one word per due time-based bucket across multiple buckets', () => {
    const freqEntries = makeEntries(10, { bucket: 0 })
    const b4 = makeEntry({ bucket: 4, lastAskedAt: null })
    const b5 = makeEntry({ bucket: 5, lastAskedAt: null })
    const b6 = makeEntry({ bucket: 6, lastAskedAt: null })

    const selected = selectSessionWords([...freqEntries, b4, b5, b6], 10, NOW)

    expect(selected.some((e) => e.id === b4.id)).toBe(true)
    expect(selected.some((e) => e.id === b5.id)).toBe(true)
    expect(selected.some((e) => e.id === b6.id)).toBe(true)
  })
})

// ── selectSessionWords — maxSessionSize cap ───────────────────────────────────

describe('selectSessionWords — maxSessionSize cap', () => {
  it('includes all due time-based buckets when total is within the cap', () => {
    const freqEntries = makeEntries(10, { bucket: 0 })
    const b4 = makeEntry({ bucket: 4, lastAskedAt: null })
    const b5 = makeEntry({ bucket: 5, lastAskedAt: null })

    // cap = 15, freq = 10, due buckets = 2 → 12 total, within cap
    const selected = selectSessionWords([...freqEntries, b4, b5], 10, NOW, 15)

    expect(selected.some((e) => e.id === b4.id)).toBe(true)
    expect(selected.some((e) => e.id === b5.id)).toBe(true)
    expect(selected).toHaveLength(12)
  })

  it('limits time-based words so total does not exceed maxSessionSize', () => {
    const freqEntries = makeEntries(10, { bucket: 0 })

    // 10 due time-based buckets, cap = 13 → only 3 time-based slots available
    const timeBased = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ bucket: 4 + i, lastAskedAt: null }),
    )

    const selected = selectSessionWords([...freqEntries, ...timeBased], 10, NOW, 13)

    expect(selected).toHaveLength(13)
    expect(selected.filter((e) => e.bucket <= 3)).toHaveLength(10)
    expect(selected.filter((e) => e.bucket >= 4)).toHaveLength(3)
  })

  it('selects the capped time-based buckets randomly (different subsets over runs)', () => {
    const freqEntries = makeEntries(10, { bucket: 0 })

    const timeBased = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ bucket: 4 + i, lastAskedAt: null }),
    )
    const timeIds = new Set(timeBased.map((e) => e.id))

    // Collect which time-based ids appear across many runs
    const seen = new Set<string>()

    for (let i = 0; i < 50; i++) {
      const selected = selectSessionWords([...freqEntries, ...timeBased], 10, NOW, 13)
      selected.filter((e) => timeIds.has(e.id)).forEach((e) => seen.add(e.id))
    }

    // With 10 candidates and only 3 slots, over 50 runs we expect more than 3 distinct ids
    expect(seen.size).toBeGreaterThan(3)
  })

  it('includes no time-based words when cap equals sessionSize', () => {
    const freqEntries = makeEntries(10, { bucket: 0 })
    const b4 = makeEntry({ bucket: 4, lastAskedAt: null })

    const selected = selectSessionWords([...freqEntries, b4], 10, NOW, 10)

    expect(selected.filter((e) => e.bucket >= 4)).toHaveLength(0)
    expect(selected).toHaveLength(10)
  })

  it('behaves identically to no cap when maxSessionSize is not provided', () => {
    const freqEntries = makeEntries(10, { bucket: 0 })
    const timeBased = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ bucket: 4 + i, lastAskedAt: null }),
    )

    const selected = selectSessionWords([...freqEntries, ...timeBased], 10, NOW)

    expect(selected).toHaveLength(15)
  })
})

// ── selectSessionWords — shortfall fill-up ────────────────────────────────────

describe('selectSessionWords — shortfall fill-up', () => {
  const recentlyAsked = NOW.toISOString() // not yet due for any bucket

  // ── Phase 1: additional due words ─────────────────────────────────────────

  it('phase 1: fills gap with additional due words from the same bucket', () => {
    // Bucket 4 has 5 due words; step 2 takes 1; phase 1 fills 3 more → total 4
    const dueB4 = makeEntries(5, { bucket: 4, lastAskedAt: null })

    const selected = selectSessionWords(dueB4, 4, NOW)

    expect(selected).toHaveLength(4)
    expect(selected.every((e) => e.bucket === 4)).toBe(true)
    expect(selected.every((e) => e.lastAskedAt === null)).toBe(true)
  })

  it('phase 1: prefers lower buckets when filling with due words', () => {
    // 1 due in b4 (consumed by step 2), 5 due in b5, 5 due in b6; sessionSize = 4
    // step 2: 1 from b4, 1 from b5, 1 from b6 → 3 total; phase 1 needs 1 more → from b5
    const dueB4 = makeEntries(1, { bucket: 4, lastAskedAt: null })
    const dueB5 = makeEntries(5, { bucket: 5, lastAskedAt: null })
    const dueB6 = makeEntries(5, { bucket: 6, lastAskedAt: null })

    const selected = selectSessionWords([...dueB4, ...dueB5, ...dueB6], 4, NOW)

    expect(selected).toHaveLength(4)
    expect(selected.filter((e) => e.bucket === 5).length).toBeGreaterThanOrEqual(2)
  })

  it('phase 1: moves to the next bucket when a lower due bucket is exhausted', () => {
    // 2 due in b4, 5 due in b5; sessionSize = 5
    // step 2: 1 from b4, 1 from b5 → 2; phase 1: 1 more from b4, then 2 from b5 → total 5
    const dueB4 = makeEntries(2, { bucket: 4, lastAskedAt: null })
    const dueB5 = makeEntries(5, { bucket: 5, lastAskedAt: null })

    const selected = selectSessionWords([...dueB4, ...dueB5], 5, NOW)

    expect(selected).toHaveLength(5)
    expect(selected.filter((e) => e.bucket === 4)).toHaveLength(2)
    expect(selected.filter((e) => e.bucket === 5)).toHaveLength(3)
  })

  // ── Phase 2: non-due words ─────────────────────────────────────────────────

  it('phase 2: fills remaining gap with non-due words when due pool is exhausted', () => {
    // 1 due in b4 (consumed by step 2), 10 non-due in b5; sessionSize = 4
    const dueEntry = makeEntry({ bucket: 4, lastAskedAt: null })
    const nonDueB5 = makeEntries(10, { bucket: 5, lastAskedAt: recentlyAsked })

    const selected = selectSessionWords([dueEntry, ...nonDueB5], 4, NOW)

    expect(selected).toHaveLength(4)
    expect(selected.filter((e) => e.lastAskedAt === null)).toHaveLength(1)
    expect(selected.filter((e) => e.bucket === 5)).toHaveLength(3)
  })

  it('phase 2: prefers lower buckets when filling with non-due words', () => {
    const notDueB5 = makeEntries(5, { bucket: 5, lastAskedAt: recentlyAsked })
    const notDueB6 = makeEntries(5, { bucket: 6, lastAskedAt: recentlyAsked })

    const selected = selectSessionWords([...notDueB5, ...notDueB6], 3, NOW)

    expect(selected).toHaveLength(3)
    expect(selected.every((e) => e.bucket === 5)).toBe(true)
  })

  it('phase 2: moves to the next bucket when a lower non-due bucket is exhausted', () => {
    const notDueB5 = makeEntries(2, { bucket: 5, lastAskedAt: recentlyAsked })
    const notDueB6 = makeEntries(5, { bucket: 6, lastAskedAt: recentlyAsked })

    const selected = selectSessionWords([...notDueB5, ...notDueB6], 4, NOW)

    expect(selected).toHaveLength(4)
    expect(selected.filter((e) => e.bucket === 5)).toHaveLength(2)
    expect(selected.filter((e) => e.bucket === 6)).toHaveLength(2)
  })

  it('phase 1 is preferred over phase 2: due words fill before non-due', () => {
    // 3 due and 10 non-due, all in bucket 4; sessionSize = 5
    // step 2: 1 due; phase 1: 2 more due; phase 2: 2 non-due
    const dueB4 = makeEntries(3, { bucket: 4, lastAskedAt: null })
    const nonDueB4 = makeEntries(10, { bucket: 4, lastAskedAt: recentlyAsked })

    const selected = selectSessionWords([...dueB4, ...nonDueB4], 5, NOW)

    expect(selected).toHaveLength(5)
    expect(selected.filter((e) => e.lastAskedAt === null)).toHaveLength(3)
    expect(selected.filter((e) => e.lastAskedAt === recentlyAsked)).toHaveLength(2)
  })

  // ── General ───────────────────────────────────────────────────────────────

  it('does not duplicate words across fill phases', () => {
    const entries = makeEntries(20, { bucket: 4, lastAskedAt: recentlyAsked })
    const selected = selectSessionWords(entries, 10, NOW)
    const ids = selected.map((e) => e.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('does not exceed sessionSize', () => {
    const entries = makeEntries(100, { bucket: 4, lastAskedAt: recentlyAsked })
    const selected = selectSessionWords(entries, 12, NOW)

    expect(selected).toHaveLength(12)
  })

  it('returns fewer than sessionSize when not enough words exist at all', () => {
    const entries = makeEntries(3, { bucket: 4, lastAskedAt: recentlyAsked })
    const selected = selectSessionWords(entries, 12, NOW)

    expect(selected).toHaveLength(3)
  })
})

// ── selectRepetitionWords ─────────────────────────────────────────────────────

describe('selectRepetitionWords', () => {
  it('returns only due time-based words', () => {
    const dueB4 = makeEntry({ bucket: 4, lastAskedAt: null })
    const notDueB4 = makeEntry({ bucket: 4, lastAskedAt: NOW.toISOString() }) // just asked
    const freqEntry = makeEntry({ bucket: 0, lastAskedAt: null })

    const selected = selectRepetitionWords([dueB4, notDueB4, freqEntry], 12, NOW)

    expect(selected).toContain(dueB4)
    expect(selected).not.toContain(notDueB4)
    expect(selected).not.toContain(freqEntry)
  })

  it('starts with bucket 4 and proceeds to higher buckets', () => {
    const b4entries = makeEntries(3, { bucket: 4, lastAskedAt: null })
    const b5entries = makeEntries(3, { bucket: 5, lastAskedAt: null })

    const selected = selectRepetitionWords([...b5entries, ...b4entries], 4, NOW)

    // All bucket-4 entries must be selected before bucket-5 entries
    const b4selected = selected.filter((e) => e.bucket === 4)
    const b5selected = selected.filter((e) => e.bucket === 5)

    expect(b4selected).toHaveLength(3)
    expect(b5selected).toHaveLength(1)
  })

  it('returns fewer than sessionSize when not enough due time-based words exist', () => {
    const dueB4 = makeEntries(3, { bucket: 4, lastAskedAt: null })

    const selected = selectRepetitionWords(dueB4, 12, NOW)

    expect(selected).toHaveLength(3)
  })

  it('returns empty array when no time-based words are due', () => {
    const notDue = makeEntry({ bucket: 4, lastAskedAt: NOW.toISOString() })

    const selected = selectRepetitionWords([notDue], 12, NOW)

    expect(selected).toHaveLength(0)
  })

  it('fills up to sessionSize across multiple buckets', () => {
    const b4 = makeEntries(4, { bucket: 4, lastAskedAt: null })
    const b5 = makeEntries(4, { bucket: 5, lastAskedAt: null })
    const b6 = makeEntries(4, { bucket: 6, lastAskedAt: null })

    const selected = selectRepetitionWords([...b4, ...b5, ...b6], 10, NOW)

    expect(selected).toHaveLength(10)
  })

  it('does not include frequency-bucket words even when time-based words fall short', () => {
    const dueB4 = makeEntries(2, { bucket: 4, lastAskedAt: null })
    const freqEntries = makeEntries(10, { bucket: 0, lastAskedAt: null })

    const selected = selectRepetitionWords([...dueB4, ...freqEntries], 12, NOW)

    expect(selected.every((e) => e.bucket >= 4)).toBe(true)
    expect(selected).toHaveLength(2)
  })

  it('returns an empty array when there are no entries at all', () => {
    expect(selectRepetitionWords([], 12, NOW)).toHaveLength(0)
  })
})

// ── Score-based preference ─────────────────────────────────────────────────────

describe('score-based preference', () => {
  it('always includes a higher-scored frequency word before lower-scored ones in the same bucket', () => {
    const preferred = makeEntry({ bucket: 1, score: 3 })
    const others = makeEntries(5, { bucket: 1, score: 0 })

    // Ask for 3 words from bucket 1 only (no other buckets).
    // The high-score word must always be selected since it sorts first.
    for (let i = 0; i < 20; i++) {
      const selected = selectSessionWords([preferred, ...others], 3, NOW)

      expect(selected.map((e) => e.id)).toContain(preferred.id)
    }
  })

  it('always includes a higher-scored word when only one slot is available in a frequency bucket', () => {
    // Bucket 0 has 1 high-score + 4 score-0; session size = 1 → only 1 word drawn
    const preferred = makeEntry({ bucket: 0, score: 2 })
    const others = makeEntries(4, { bucket: 0, score: 0 })

    for (let i = 0; i < 20; i++) {
      const selected = selectSessionWords([preferred, ...others], 1, NOW)

      expect(selected.map((e) => e.id)).toContain(preferred.id)
    }
  })

  it('always picks the highest-scored due time-based word from a bucket (1-per-bucket selection)', () => {
    // Bucket 4: 1 high-score due + 4 score-0 due — selectTimeBasedWords picks exactly 1
    const preferred = makeEntry({ bucket: 4, score: 5, lastAskedAt: null })
    const others = makeEntries(4, { bucket: 4, score: 0, lastAskedAt: null })
    const freqWords = makeEntries(12, { bucket: 0 })

    for (let i = 0; i < 20; i++) {
      const selected = selectSessionWords([...freqWords, preferred, ...others], 12, NOW)
      const timePicks = selected.filter((e) => e.bucket >= 4)

      expect(timePicks.map((e) => e.id)).toContain(preferred.id)
    }
  })

  it('always includes higher-scored words first in repetition sessions', () => {
    const preferred = makeEntry({ bucket: 4, score: 4, lastAskedAt: null })
    const others = makeEntries(5, { bucket: 4, score: 0, lastAskedAt: null })

    for (let i = 0; i < 20; i++) {
      const selected = selectRepetitionWords([preferred, ...others], 3, NOW)

      expect(selected.map((e) => e.id)).toContain(preferred.id)
    }
  })

  it('always includes higher-scored words during shortfall fill-up from time-based entries', () => {
    // Only freq bucket 0 + time-based entries; session size larger than freq can cover
    // → shortfall fill phase kicks in; the high-score time-based word must be preferred
    const freqWords = makeEntries(2, { bucket: 0 })
    const preferred = makeEntry({ bucket: 4, score: 3, lastAskedAt: null })
    const others = makeEntries(5, { bucket: 4, score: 0, lastAskedAt: null })

    for (let i = 0; i < 20; i++) {
      const selected = selectSessionWords([...freqWords, preferred, ...others], 5, NOW)

      expect(selected.map((e) => e.id)).toContain(preferred.id)
    }
  })
})

// ── Manually-added preference ─────────────────────────────────────────────────

describe('manually-added preference', () => {
  it('always includes a manually-added bucket-0 word even when the random draw is 1', () => {
    // 1 manually-added + 4 regular bucket-0 words; session size = 3.
    // No matter the random 1-or-2 draw, the manually-added word must be selected.
    const manual = makeEntry({ bucket: 0, manuallyAdded: true })
    const regular = makeEntries(4, { bucket: 0 })

    for (let i = 0; i < 30; i++) {
      const selected = selectSessionWords([manual, ...regular], 3, NOW)

      expect(selected.map((e) => e.id)).toContain(manual.id)
    }
  })

  it('includes all manually-added bucket-0 words even when they exceed the normal draw count', () => {
    // 3 manually-added bucket-0 words; normal draw would be 1 or 2.
    // All 3 must appear in every session.
    const manuals = makeEntries(3, { bucket: 0, manuallyAdded: true })
    const regular = makeEntries(3, { bucket: 0 })

    for (let i = 0; i < 20; i++) {
      const selected = selectSessionWords([...manuals, ...regular], 6, NOW)
      const selectedIds = new Set(selected.map((e) => e.id))

      for (const m of manuals) {
        expect(selectedIds).toContain(m.id)
      }
    }
  })

  it('selects manually-added words before regular bucket-0 words when only one slot is free', () => {
    const manual = makeEntry({ bucket: 0, manuallyAdded: true })
    const regular = makeEntries(4, { bucket: 0 })

    // Session size = 1 → only one word fits; it must be the manually-added one.
    for (let i = 0; i < 20; i++) {
      const selected = selectSessionWords([manual, ...regular], 1, NOW)

      expect(selected).toHaveLength(1)
      expect(selected[0]?.id).toBe(manual.id)
    }
  })

  it('manually-added words beat score-0 regular words in bucket 0', () => {
    const manual = makeEntry({ bucket: 0, manuallyAdded: true, score: 0 })
    const highScore = makeEntry({ bucket: 0, manuallyAdded: false, score: 5 })
    const others = makeEntries(4, { bucket: 0 })

    // Even with a high-score regular word present, the manually-added word is always drawn first.
    for (let i = 0; i < 20; i++) {
      const selected = selectSessionWords([manual, highScore, ...others], 2, NOW)

      expect(selected.map((e) => e.id)).toContain(manual.id)
    }
  })
})

// ── selectFocusWords ──────────────────────────────────────────────────────────

describe('selectFocusWords', () => {
  it('returns null when fewer than 5 words have score >= 2 and bucket 1–5', () => {
    const entries = [
      makeEntry({ bucket: 1, score: 2 }),
      makeEntry({ bucket: 2, score: 3 }),
      makeEntry({ bucket: 1, score: 2 }),
      makeEntry({ bucket: 3, score: 2 }),
    ]

    expect(selectFocusWords(entries, 10)).toBeNull()
  })

  it('returns null when exactly 5 words qualify (not null)', () => {
    const entries = makeEntries(5, { bucket: 1, score: 2 })

    expect(selectFocusWords(entries, 10)).not.toBeNull()
  })

  it('excludes bucket 0 words from primary candidates', () => {
    // 4 qualifying words in buckets 1–5 + many bucket 0 high-score words
    const qualifying = makeEntries(4, { bucket: 1, score: 5 })
    const bucket0 = makeEntries(10, { bucket: 0, score: 10 })

    expect(selectFocusWords([...qualifying, ...bucket0], 10)).toBeNull()
  })

  it('excludes bucket 6+ words from primary candidates', () => {
    // 4 qualifying words in buckets 1–5 + many high-score bucket 6+ words
    const qualifying = makeEntries(4, { bucket: 3, score: 5 })
    const highBucket = makeEntries(10, { bucket: 6, score: 10 })

    expect(selectFocusWords([...qualifying, ...highBucket], 10)).toBeNull()
  })

  it('bucket 6+ words can appear in the top-up round', () => {
    const primary = makeEntries(6, { bucket: 3, score: 2 })
    const highBucket = makeEntries(10, { bucket: 6, score: 5 })
    const result = selectFocusWords([...primary, ...highBucket], 10)

    expect(result).toHaveLength(10)

    const highBucketIds = new Set(highBucket.map((e) => e.id))

    expect(result?.some((e) => highBucketIds.has(e.id))).toBe(true)
  })

  it('excludes words with score < 2 from primary candidates', () => {
    const lowScore = makeEntries(10, { bucket: 1, score: 1 })
    const qualifying = makeEntries(4, { bucket: 1, score: 2 })

    expect(selectFocusWords([...lowScore, ...qualifying], 10)).toBeNull()
  })

  it('returns exactly sessionSize words when enough primary candidates exist', () => {
    const entries = makeEntries(15, { bucket: 1, score: 3 })
    const result = selectFocusWords(entries, 10)

    expect(result).toHaveLength(10)
  })

  it('returns all primary candidates when fewer than sessionSize exist', () => {
    const primary = makeEntries(7, { bucket: 1, score: 2 })
    const result = selectFocusWords(primary, 10)

    expect(result).toHaveLength(7)
  })

  it('tops up with bucket 1+ words (score < 2 allowed) when primary < sessionSize', () => {
    const primary = makeEntries(6, { bucket: 1, score: 2 })
    const topUp = makeEntries(10, { bucket: 2, score: 0 })
    const result = selectFocusWords([...primary, ...topUp], 10)

    expect(result).toHaveLength(10)
  })

  it('does not include bucket 0 in top-up', () => {
    const primary = makeEntries(6, { bucket: 1, score: 2 })
    const bucket0 = makeEntries(10, { bucket: 0, score: 0 })
    const result = selectFocusWords([...primary, ...bucket0], 10)

    // Only 6 primary; no valid top-up (only bucket 0 available)
    expect(result).toHaveLength(6)
  })

  it('does not duplicate words between primary and top-up', () => {
    const primary = makeEntries(7, { bucket: 1, score: 2 })
    const topUp = makeEntries(10, { bucket: 2, score: 1 })
    const result = selectFocusWords([...primary, ...topUp], 10)

    const ids = result?.map((e) => e.id) ?? []

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('selects highest-score words first', () => {
    const lowScore = makeEntries(5, { bucket: 1, score: 2 })
    const highScore = makeEntries(5, { bucket: 1, score: 5 })
    const result = selectFocusWords([...lowScore, ...highScore], 5)

    const highIds = new Set(highScore.map((e) => e.id))

    expect(result?.every((e) => highIds.has(e.id))).toBe(true)
  })
})

// ── selectDiscoveryWords ───────────────────────────────────────────────────────

describe('selectDiscoveryWords', () => {
  it('returns null when fewer than sessionSize bucket-0 words exist', () => {
    const entries = makeEntries(23, { bucket: 0 })

    expect(selectDiscoveryWords(entries, 24)).toBeNull()
  })

  it('returns exactly sessionSize words when enough bucket-0 words exist', () => {
    const entries = makeEntries(30, { bucket: 0 })

    expect(selectDiscoveryWords(entries, 24)).toHaveLength(24)
  })

  it('only selects bucket-0 words', () => {
    const bucket0 = makeEntries(24, { bucket: 0 })
    const other = makeEntries(10, { bucket: 1 })
    const result = selectDiscoveryWords([...bucket0, ...other], 24)

    expect(result).not.toBeNull()
    expect(result?.every((e) => e.bucket === 0)).toBe(true)
  })

  it('prefers manually added words', () => {
    const manual = makeEntries(24, { bucket: 0, manuallyAdded: true })
    const regular = makeEntries(24, { bucket: 0, manuallyAdded: false })
    const result = selectDiscoveryWords([...regular, ...manual], 24)

    const manualIds = new Set(manual.map((e) => e.id))

    expect(result?.every((e) => manualIds.has(e.id))).toBe(true)
  })

  it('falls back to regular words when not enough manually added', () => {
    const manual = makeEntries(10, { bucket: 0, manuallyAdded: true })
    const regular = makeEntries(20, { bucket: 0, manuallyAdded: false })
    const result = selectDiscoveryWords([...regular, ...manual], 24)

    expect(result).toHaveLength(24)
    expect(result?.filter((e) => e.manuallyAdded)).toHaveLength(10)
  })

  it('selects highest-score words first within each group', () => {
    const lowScore = makeEntries(12, { bucket: 0, score: 1, manuallyAdded: false })
    const highScore = makeEntries(12, { bucket: 0, score: 5, manuallyAdded: false })
    const result = selectDiscoveryWords([...lowScore, ...highScore], 12)

    const highIds = new Set(highScore.map((e) => e.id))

    expect(result?.every((e) => highIds.has(e.id))).toBe(true)
  })
})

// ── selectStarredWords ────────────────────────────────────────────────────────

describe('selectStarredWords', () => {
  it('returns null when no words are marked', () => {
    const all = makeEntries(10, { marked: false })

    expect(selectStarredWords(all, 100)).toBeNull()
  })

  it('returns all marked words when count is below the limit', () => {
    const marked = makeEntries(5, { marked: true })
    const unmarked = makeEntries(10, { marked: false })
    const result = selectStarredWords([...marked, ...unmarked], 100)

    expect(result).toHaveLength(5)
    expect(result?.every((e) => e.marked)).toBe(true)
  })

  it('caps the result at the given limit', () => {
    const marked = makeEntries(120, { marked: true })
    const result = selectStarredWords(marked, 100)

    expect(result).toHaveLength(100)
  })

  it('prioritises highest-score words when capping', () => {
    const lowScore = makeEntries(60, { marked: true, score: 1 })
    const highScore = makeEntries(60, { marked: true, score: 5 })
    const result = selectStarredWords([...lowScore, ...highScore], 60)

    const highIds = new Set(highScore.map((e) => e.id))

    expect(result?.every((e) => highIds.has(e.id))).toBe(true)
  })

  it('includes marked words from any bucket', () => {
    const b0 = makeEntry({ marked: true, bucket: 0 })
    const b3 = makeEntry({ marked: true, bucket: 3 })
    const b5 = makeEntry({ marked: true, bucket: 5 })
    const result = selectStarredWords([b0, b3, b5], 100)

    expect(result).toHaveLength(3)
  })
})

// ── selectStressWords ─────────────────────────────────────────────────────────

describe('selectStressWords', () => {
  it('returns null when total entries are fewer than minWords', () => {
    const entries = makeEntries(4, { difficulty: 0 })

    expect(selectStressWords(entries, 24, 5)).toBeNull()
  })

  it('returns all entries when fewer than sessionSize exist', () => {
    const entries = makeEntries(10, { difficulty: 0 })
    const result = selectStressWords(entries, 24, 5)

    expect(result).toHaveLength(10)
  })

  it('returns at most sessionSize entries', () => {
    const entries = makeEntries(50, { difficulty: 0 })
    const result = selectStressWords(entries, 24, 5)

    expect(result).toHaveLength(24)
  })

  it('fills tier A (difficulty >= 4) first, up to 8 words', () => {
    const tierA = makeEntries(8, { difficulty: 4 })
    const tierB = makeEntries(8, { difficulty: 2 })
    const tierC = makeEntries(8, { difficulty: 0 })
    const result = selectStressWords([...tierA, ...tierB, ...tierC], 24, 5)

    const tierAIds = new Set(tierA.map((e) => e.id))
    const tierBIds = new Set(tierB.map((e) => e.id))
    const tierCIds = new Set(tierC.map((e) => e.id))

    expect(result).toHaveLength(24)
    expect(result?.filter((e) => tierAIds.has(e.id))).toHaveLength(8)
    expect(result?.filter((e) => tierBIds.has(e.id))).toHaveLength(8)
    expect(result?.filter((e) => tierCIds.has(e.id))).toHaveLength(8)
  })

  it('fills tier B from difficulty >= 2 words not already in tier A', () => {
    // 4 words at difficulty 5 (qualifies for tier A and B), 10 at difficulty 2, 10 at difficulty 0
    const highDiff = makeEntries(4, { difficulty: 5 })
    const midDiff = makeEntries(10, { difficulty: 2 })
    const lowDiff = makeEntries(10, { difficulty: 0 })
    const result = selectStressWords([...highDiff, ...midDiff, ...lowDiff], 24, 5)

    const resultIds = new Set(result?.map((e) => e.id) ?? [])

    // All 4 high-diff words must appear (tier A picks them all)
    expect(highDiff.every((e) => resultIds.has(e.id))).toBe(true)
    // No duplicates
    expect(result?.length).toBe(new Set(result?.map((e) => e.id)).size)
  })

  it('does not duplicate words across tiers', () => {
    // difficulty 4 words qualify for both tier A and tier B — must not appear twice
    const entries = makeEntries(20, { difficulty: 4 })
    const result = selectStressWords(entries, 24, 5)

    const ids = result?.map((e) => e.id) ?? []

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('tier C fills remaining slots when tiers A and B are short', () => {
    // Only 3 words in tier A, 3 in tier B range, rest are tier C
    const tierA = makeEntries(3, { difficulty: 5 })
    const tierB = makeEntries(3, { difficulty: 2 })
    const tierC = makeEntries(20, { difficulty: 0 })
    const result = selectStressWords([...tierA, ...tierB, ...tierC], 24, 5)

    // 3 + 3 + 18 = 24 (tier C fills the remaining 18 slots)
    expect(result).toHaveLength(24)

    const tierAIds = new Set(tierA.map((e) => e.id))
    const tierBIds = new Set(tierB.map((e) => e.id))

    expect(result?.filter((e) => tierAIds.has(e.id))).toHaveLength(3)
    expect(result?.filter((e) => tierBIds.has(e.id))).toHaveLength(3)
  })

  it('stops early when sessionSize is reached before all tiers are filled', () => {
    const tierA = makeEntries(8, { difficulty: 4 })
    const tierB = makeEntries(8, { difficulty: 2 })
    const tierC = makeEntries(8, { difficulty: 0 })
    const result = selectStressWords([...tierA, ...tierB, ...tierC], 10, 5)

    expect(result).toHaveLength(10)
  })
})

// ── selectVeteranWords ────────────────────────────────────────────────────────

describe('selectVeteranWords', () => {
  it('returns null when fewer than minWords qualifying entries exist', () => {
    const entries = [
      ...makeEntries(4, { bucket: 6, difficulty: 2 }),
      ...makeEntries(20, { bucket: 3, difficulty: 5 }), // not bucket 6+
    ]

    expect(selectVeteranWords(entries, 12, 5)).toBeNull()
  })

  it('excludes words with difficulty < 2 even if bucket >= 6', () => {
    const easy = makeEntries(8, { bucket: 6, difficulty: 1 })
    const qualifying = makeEntries(5, { bucket: 6, difficulty: 2 })
    const result = selectVeteranWords([...easy, ...qualifying], 12, 5)

    const qualifyingIds = new Set(qualifying.map((e) => e.id))

    expect(result?.every((e) => qualifyingIds.has(e.id))).toBe(true)
  })

  it('only includes words from buckets 6+', () => {
    const veteran = makeEntries(8, { bucket: 6, difficulty: 2 })
    const nonVeteran = makeEntries(10, { bucket: 5, difficulty: 5 })
    const result = selectVeteranWords([...veteran, ...nonVeteran], 12, 5)

    const veteranIds = new Set(veteran.map((e) => e.id))

    expect(result?.every((e) => veteranIds.has(e.id))).toBe(true)
  })

  it('returns at most sessionSize words', () => {
    const entries = makeEntries(20, { bucket: 7, difficulty: 2 })

    expect(selectVeteranWords(entries, 12, 5)).toHaveLength(12)
  })

  it('returns all qualifying words when fewer than sessionSize exist', () => {
    const entries = makeEntries(8, { bucket: 6, difficulty: 2 })

    expect(selectVeteranWords(entries, 12, 5)).toHaveLength(8)
  })

  it('sorts by difficulty descending', () => {
    const low = makeEntries(5, { bucket: 6, difficulty: 2 })
    const high = makeEntries(5, { bucket: 6, difficulty: 5 })
    const result = selectVeteranWords([...low, ...high], 5, 5)

    const highIds = new Set(high.map((e) => e.id))

    expect(result?.every((e) => highIds.has(e.id))).toBe(true)
  })

  it('includes words from bucket 7, 8, etc. (any bucket >= 6)', () => {
    const b6 = makeEntry({ bucket: 6, difficulty: 2 })
    const b7 = makeEntry({ bucket: 7, difficulty: 2 })
    const b10 = makeEntry({ bucket: 10, difficulty: 3 })
    const filler = makeEntries(2, { bucket: 8, difficulty: 2 })
    const result = selectVeteranWords([b6, b7, b10, ...filler], 12, 5)

    const ids = new Set(result?.map((e) => e.id) ?? [])

    expect(ids.has(b6.id)).toBe(true)
    expect(ids.has(b7.id)).toBe(true)
    expect(ids.has(b10.id)).toBe(true)
  })
})

// ── selectBreakthroughWords ───────────────────────────────────────────────────

describe('selectBreakthroughWords', () => {
  it('returns null when total pool is below minWords', () => {
    const entries = makeEntries(4, { bucket: 3 })
    const result = selectBreakthroughWords(entries, 12, 5, NOW)

    expect(result).toBeNull()
  })

  it('returns entries when pool meets minWords', () => {
    const entries = makeEntries(5, { bucket: 3 })
    const result = selectBreakthroughWords(entries, 12, 5, NOW)

    expect(result).not.toBeNull()
    expect(result?.length).toBe(5)
  })

  it('includes bucket-3 words (cat1)', () => {
    const b3 = makeEntries(6, { bucket: 3 })
    const result = selectBreakthroughWords(b3, 12, 5, NOW)

    expect(result).not.toBeNull()

    const ids = new Set(result?.map((e) => e.id) ?? [])

    for (const e of b3) {
      expect(ids.has(e.id)).toBe(true)
    }
  })

  it('includes due bucket-5 words (cat2)', () => {
    const b3 = makeEntries(3, { bucket: 3 })
    const b5Due = makeEntries(3, { bucket: 5, lastAskedAt: null })
    const result = selectBreakthroughWords([...b3, ...b5Due], 12, 5, NOW)

    expect(result).not.toBeNull()

    const ids = new Set(result?.map((e) => e.id) ?? [])

    for (const e of b5Due) {
      expect(ids.has(e.id)).toBe(true)
    }
  })

  it('excludes non-due bucket-5 words', () => {
    const b3 = makeEntries(5, { bucket: 3 })
    // bucket-5 word asked just now — not due for a week
    const b5NotDue = makeEntry({ bucket: 5, lastAskedAt: NOW.toISOString() })
    const result = selectBreakthroughWords([...b3, b5NotDue], 12, 5, NOW)

    expect(result).not.toBeNull()

    const ids = new Set(result?.map((e) => e.id) ?? [])

    expect(ids.has(b5NotDue.id)).toBe(false)
  })

  it('includes words in the highest bucket as cat3 when not already in cat1/cat2', () => {
    const b3 = makeEntries(3, { bucket: 3 })
    const b7 = makeEntries(3, { bucket: 7, lastAskedAt: null })
    const result = selectBreakthroughWords([...b3, ...b7], 12, 5, NOW)

    expect(result).not.toBeNull()

    const ids = new Set(result?.map((e) => e.id) ?? [])

    for (const e of b7) {
      expect(ids.has(e.id)).toBe(true)
    }
  })

  it('excludes non-due time-based cat3 words', () => {
    const b3 = makeEntries(5, { bucket: 3 })
    // bucket-7 word asked recently — not due
    const b7NotDue = makeEntry({ bucket: 7, lastAskedAt: NOW.toISOString() })
    const result = selectBreakthroughWords([...b3, b7NotDue], 12, 5, NOW)

    expect(result).not.toBeNull()

    const ids = new Set(result?.map((e) => e.id) ?? [])

    expect(ids.has(b7NotDue.id)).toBe(false)
  })

  it('deduplicates: cat1 word is not also in cat3 when highest bucket is 3', () => {
    const b3 = makeEntries(6, { bucket: 3 })
    const result = selectBreakthroughWords(b3, 12, 5, NOW)

    expect(result).not.toBeNull()

    const ids = result?.map((e) => e.id) ?? []
    const uniqueIds = new Set(ids)

    expect(ids.length).toBe(uniqueIds.size)
  })

  it('caps result at sessionSize', () => {
    const b3 = makeEntries(20, { bucket: 3 })
    const result = selectBreakthroughWords(b3, 12, 5, NOW)

    expect(result).not.toBeNull()
    expect(result?.length).toBeLessThanOrEqual(12)
  })

  it('returns null when pool exactly equals minWords - 1', () => {
    const b3 = makeEntries(4, { bucket: 3 })
    const result = selectBreakthroughWords(b3, 12, 5, NOW)

    expect(result).toBeNull()
  })

  it('returns no duplicates with mixed categories', () => {
    const b3 = makeEntries(4, { bucket: 3 })
    const b5Due = makeEntries(3, { bucket: 5, lastAskedAt: null })
    const b7Due = makeEntries(3, { bucket: 7, lastAskedAt: null })
    const result = selectBreakthroughWords([...b3, ...b5Due, ...b7Due], 12, 5, NOW)

    expect(result).not.toBeNull()

    const ids = result?.map((e) => e.id) ?? []
    const uniqueIds = new Set(ids)

    expect(ids.length).toBe(uniqueIds.size)
  })
})

// ── selectSecondChanceSessionWords ────────────────────────────────────────────

describe('selectSecondChanceSessionWords', () => {
  it('returns empty array when no entries have secondChanceDueAt set', () => {
    const entries = makeEntries(5, { bucket: 4 })
    const result = selectSecondChanceSessionWords(entries, 24, NOW)

    expect(result).toHaveLength(0)
  })

  it('excludes words whose secondChanceDueAt is in the future', () => {
    const future = makeEntry({ bucket: 4, secondChanceDueAt: '2030-01-01T00:00:00Z' })
    const result = selectSecondChanceSessionWords([future], 24, NOW)

    expect(result).toHaveLength(0)
  })

  it('includes words whose secondChanceDueAt is now or in the past', () => {
    const due = makeEntry({ bucket: 4, secondChanceDueAt: '2026-01-01T00:00:00Z' })
    const result = selectSecondChanceSessionWords([due], 24, NOW)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(due.id)
  })

  it('excludes words with secondChanceDueAt = null', () => {
    const normal = makeEntry({ bucket: 4, secondChanceDueAt: null })
    const result = selectSecondChanceSessionWords([normal], 24, NOW)

    expect(result).toHaveLength(0)
  })

  it('caps result at sessionSize', () => {
    const due = makeEntries(30, { bucket: 4, secondChanceDueAt: '2026-01-01T00:00:00Z' })
    const result = selectSecondChanceSessionWords(due, 24, NOW)

    expect(result.length).toBeLessThanOrEqual(24)
  })

  it('returns no duplicates', () => {
    const due = makeEntries(10, { bucket: 5, secondChanceDueAt: '2026-01-01T00:00:00Z' })
    const result = selectSecondChanceSessionWords(due, 24, NOW)
    const ids = result.map((e) => e.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('prioritises words with higher score', () => {
    const lowScore = makeEntry({ bucket: 4, score: 1, secondChanceDueAt: '2026-01-01T00:00:00Z' })
    const highScore = makeEntry({ bucket: 4, score: 5, secondChanceDueAt: '2026-01-01T00:00:00Z' })
    const result = selectSecondChanceSessionWords([lowScore, highScore], 1, NOW)

    expect(result[0].id).toBe(highScore.id)
  })
})
