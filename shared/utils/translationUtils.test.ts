// @vitest-environment node
/**
 * Tests for shared translation normalisation and deduplication utilities.
 */
import { describe, it, expect } from 'vitest'

import { normalizeAnswer, deduplicateTranslations } from './translationUtils.ts'

// ── normalizeAnswer ───────────────────────────────────────────────────────────

describe('normalizeAnswer', () => {
  it('lowercases the input', () => {
    expect(normalizeAnswer('TABLE')).toBe('table')
  })

  it('replaces hyphens with spaces', () => {
    expect(normalizeAnswer('well-known')).toBe('well known')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizeAnswer('  table  ')).toBe('table')
  })

  it('strips a leading "to " prefix', () => {
    expect(normalizeAnswer('to stand up')).toBe('stand up')
  })

  it('does not strip "to" when it is the whole string', () => {
    expect(normalizeAnswer('to')).toBe('to')
  })

  it('does not strip "to" when not followed by a space', () => {
    expect(normalizeAnswer('tomorrow')).toBe('tomorrow')
  })
})

// ── deduplicateTranslations ───────────────────────────────────────────────────

describe('deduplicateTranslations', () => {
  it('returns an unchanged array when all translations are distinct', () => {
    expect(deduplicateTranslations(['sleep', 'roost'])).toEqual(['sleep', 'roost'])
  })

  it('removes "to sleep" when "sleep" already appears', () => {
    expect(deduplicateTranslations(['sleep', 'to sleep'])).toEqual(['sleep'])
  })

  it('removes "sleep" when "to sleep" appears first', () => {
    expect(deduplicateTranslations(['to sleep', 'sleep'])).toEqual(['to sleep'])
  })

  it('deduplicates across three entries — example from the spec', () => {
    expect(deduplicateTranslations(['sleep', 'to sleep', 'to roost'])).toEqual(['sleep', 'to roost'])
  })

  it('handles case differences as duplicates', () => {
    expect(deduplicateTranslations(['Sleep', 'to Sleep'])).toEqual(['Sleep'])
  })

  it('handles hyphen/space equivalence', () => {
    expect(deduplicateTranslations(['well-known', 'well known'])).toEqual(['well-known'])
  })

  it('preserves the original string values (not the normalised forms)', () => {
    const result = deduplicateTranslations(['to sleep', 'sleep'])

    expect(result[0]).toBe('to sleep')
  })

  it('returns an empty array for an empty input', () => {
    expect(deduplicateTranslations([])).toEqual([])
  })

  it('returns a single-element array unchanged', () => {
    expect(deduplicateTranslations(['table'])).toEqual(['table'])
  })
})
