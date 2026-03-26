// @vitest-environment node

/**
 * Unit tests for SecondChanceSessionService.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { SecondChanceSessionService } from './secondChanceSessionService.ts'
import { FakeCreditsRepository } from '../../test-utils/FakeCreditsRepository.ts'

// ── Setup ─────────────────────────────────────────────────────────────────────

let creditsRepo: FakeCreditsRepository
let service: SecondChanceSessionService

beforeEach(() => {
  creditsRepo = new FakeCreditsRepository()
  service = new SecondChanceSessionService(creditsRepo)
})

// ── calcDueAt ─────────────────────────────────────────────────────────────────

describe('calcDueAt', () => {
  it('returns at least now + 12 h', () => {
    const now = new Date('2026-03-25T11:00:00Z')
    const dueAt = new Date(service.calcDueAt(now)).getTime()

    expect(dueAt).toBeGreaterThanOrEqual(now.getTime() + 12 * 60 * 60 * 1000)
  })

  it('returns next day 00:00 UTC when now is 11:00 UTC (tomorrow 00:00 is further than now+12h)', () => {
    // 11:00 UTC → now+12h = 23:00 UTC same day (12h away); tomorrow 00:00 = 13h away → tomorrow wins
    const now = new Date('2026-03-25T11:00:00Z')
    const dueAt = service.calcDueAt(now)

    expect(dueAt).toBe('2026-03-26T00:00:00.000Z')
  })

  it('returns now + 12 h when 23:00 UTC (now+12h is further than next calendar day)', () => {
    // 23:00 UTC → tomorrow 00:00 = 1h later; now+12h = 11:00 next day → 11:00 wins
    const now = new Date('2026-03-25T23:00:00Z')
    const dueAt = service.calcDueAt(now)

    expect(dueAt).toBe('2026-03-26T11:00:00.000Z')
  })

  it('returns a valid ISO 8601 string', () => {
    const dueAt = service.calcDueAt(new Date())

    expect(() => new Date(dueAt)).not.toThrow()
    expect(typeof dueAt).toBe('string')
    expect(dueAt.length).toBeGreaterThan(0)
  })
})

// ── isAvailable ───────────────────────────────────────────────────────────────

describe('isAvailable', () => {
  it('returns true when no second chance session has been played today', () => {
    expect(service.isAvailable('2026-03-25')).toBe(true)
  })

  it('returns false after scheduleCompletion is called for the same date', () => {
    service.scheduleCompletion('2026-03-25')

    expect(service.isAvailable('2026-03-25')).toBe(false)
  })

  it('returns true for a different date after completion', () => {
    service.scheduleCompletion('2026-03-25')

    expect(service.isAvailable('2026-03-26')).toBe(true)
  })

  it('returns true when completion was recorded for a previous date', () => {
    creditsRepo.setLastSecondChanceSessionDate('2026-03-24')

    expect(service.isAvailable('2026-03-25')).toBe(true)
  })
})

// ── scheduleCompletion ────────────────────────────────────────────────────────

describe('scheduleCompletion', () => {
  it('persists the date to the credits repository', () => {
    service.scheduleCompletion('2026-03-25')

    expect(creditsRepo.getLastSecondChanceSessionDate()).toBe('2026-03-25')
  })

  it('overwrites a previously stored date', () => {
    service.scheduleCompletion('2026-03-24')
    service.scheduleCompletion('2026-03-25')

    expect(creditsRepo.getLastSecondChanceSessionDate()).toBe('2026-03-25')
  })
})
