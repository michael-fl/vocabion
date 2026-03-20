/**
 * Tests for the shared SRS interval calculation.
 */
import { describe, it, expect } from 'vitest'

import { getIntervalMs } from './srsInterval.ts'

const HOUR_MS = 60 * 60 * 1000
const WEEK_MS = 7 * 24 * HOUR_MS

describe('getIntervalMs', () => {
  it('returns 22 hours for bucket 4', () => {
    expect(getIntervalMs(4)).toBe(22 * HOUR_MS)
  })

  it('returns 1 week for bucket 5', () => {
    expect(getIntervalMs(5)).toBe(WEEK_MS)
  })

  it('returns 2 weeks for bucket 6', () => {
    expect(getIntervalMs(6)).toBe(2 * WEEK_MS)
  })

  it('returns 3 weeks for bucket 7', () => {
    expect(getIntervalMs(7)).toBe(3 * WEEK_MS)
  })

  it('returns (n-4) weeks for any bucket n ≥ 5', () => {
    expect(getIntervalMs(10)).toBe(6 * WEEK_MS)
  })
})
