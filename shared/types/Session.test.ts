/**
 * Tests for Session type guard.
 */

import { isSession } from './Session.ts'
import type { Session } from './Session.ts'

// ── Helpers ──────────────────────────────────────────────────────────────────

function validSession(): Session {
  return {
    id: 'sess-001',
    direction: 'SOURCE_TO_TARGET',
    type: 'normal',
    words: [
      { vocabId: 'abc-123', status: 'pending' },
      { vocabId: 'def-456', status: 'correct' },
    ],
    status: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    firstAnsweredAt: null,
  }
}

// ── isSession ─────────────────────────────────────────────────────────────────

describe('isSession', () => {
  it('returns true for a valid open session', () => {
    expect(isSession(validSession())).toBe(true)
  })

  it('returns true for a completed session', () => {
    expect(isSession({ ...validSession(), status: 'completed' })).toBe(true)
  })

  it('returns true for direction TARGET_TO_SOURCE', () => {
    expect(isSession({ ...validSession(), direction: 'TARGET_TO_SOURCE' })).toBe(true)
  })

  it('returns true when firstAnsweredAt is a string', () => {
    expect(isSession({ ...validSession(), firstAnsweredAt: '2026-01-01T10:00:00Z' })).toBe(true)
  })

  it('returns false when firstAnsweredAt is a number', () => {
    expect(isSession({ ...validSession(), firstAnsweredAt: 123 })).toBe(false)
  })

  it('returns true for a session with an empty words array', () => {
    expect(isSession({ ...validSession(), words: [] })).toBe(true)
  })

  it('returns false for null', () => {
    expect(isSession(null)).toBe(false)
  })

  it('returns false for a string', () => {
    expect(isSession('session')).toBe(false)
  })

  it('returns false when id is missing', () => {
    const { id: _id, ...rest } = validSession()

    expect(isSession(rest)).toBe(false)
  })

  it('returns false when id is not a string', () => {
    expect(isSession({ ...validSession(), id: 99 })).toBe(false)
  })

  it('returns false when direction is an unknown value', () => {
    expect(isSession({ ...validSession(), direction: 'FR_TO_EN' })).toBe(false)
  })

  it('returns false when direction is missing', () => {
    const { direction: _d, ...rest } = validSession()

    expect(isSession(rest)).toBe(false)
  })

  it('returns false when words is not an array', () => {
    expect(isSession({ ...validSession(), words: 'none' })).toBe(false)
  })

  it('returns false when words contains an invalid SessionWord', () => {
    const badWords = [{ vocabId: 'abc', status: 'unknown' }]

    expect(isSession({ ...validSession(), words: badWords })).toBe(false)
  })

  it('returns false when a word in words is missing vocabId', () => {
    const badWords = [{ status: 'pending' }]

    expect(isSession({ ...validSession(), words: badWords })).toBe(false)
  })

  it('returns false when status is an unknown value', () => {
    expect(isSession({ ...validSession(), status: 'paused' })).toBe(false)
  })

  it('returns false when status is missing', () => {
    const { status: _s, ...rest } = validSession()

    expect(isSession(rest)).toBe(false)
  })

  it('returns false when createdAt is missing', () => {
    const { createdAt: _c, ...rest } = validSession()

    expect(isSession(rest)).toBe(false)
  })

  it('returns false when createdAt is not a string', () => {
    expect(isSession({ ...validSession(), createdAt: 1234567890 })).toBe(false)
  })

  it('returns true for type "repetition"', () => {
    expect(isSession({ ...validSession(), type: 'repetition' })).toBe(true)
  })

  it('returns true for type "review"', () => {
    expect(isSession({ ...validSession(), type: 'review' })).toBe(true)
  })

  it('returns false when type is an unknown value', () => {
    expect(isSession({ ...validSession(), type: 'something_else' })).toBe(false)
  })

  it('returns false when type is missing', () => {
    const { type: _t, ...rest } = validSession()

    expect(isSession(rest)).toBe(false)
  })
})
