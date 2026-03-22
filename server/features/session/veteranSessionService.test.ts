// @vitest-environment node

/**
 * Unit tests for VeteranSessionService.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { VeteranSessionService, VETERAN_MIN_BUCKET6_WORDS, VETERAN_INTERVAL_DAYS } from './veteranSessionService.ts'
import { FakeCreditsRepository } from '../../test-utils/FakeCreditsRepository.ts'

let creditsRepo: FakeCreditsRepository
let service: VeteranSessionService

beforeEach(() => {
  creditsRepo = new FakeCreditsRepository()
  service = new VeteranSessionService(creditsRepo)
})

describe('VeteranSessionService — isAvailable', () => {
  it('returns false when bucket-6+ count is below the minimum', () => {
    creditsRepo.setVeteranSessionDueAt('2026-01-01')

    expect(service.isAvailable('2026-03-22', VETERAN_MIN_BUCKET6_WORDS - 1)).toBe(false)
  })

  it('returns false when no due date has been set', () => {
    expect(service.isAvailable('2026-03-22', VETERAN_MIN_BUCKET6_WORDS)).toBe(false)
  })

  it('returns false when due date is in the future', () => {
    creditsRepo.setVeteranSessionDueAt('9999-12-31')

    expect(service.isAvailable('2026-03-22', VETERAN_MIN_BUCKET6_WORDS)).toBe(false)
  })

  it('returns true when due date is today and count qualifies', () => {
    creditsRepo.setVeteranSessionDueAt('2026-03-22')

    expect(service.isAvailable('2026-03-22', VETERAN_MIN_BUCKET6_WORDS)).toBe(true)
  })

  it('returns true when due date is in the past and count qualifies', () => {
    creditsRepo.setVeteranSessionDueAt('2026-01-01')

    expect(service.isAvailable('2026-03-22', VETERAN_MIN_BUCKET6_WORDS)).toBe(true)
  })

  it('returns true at exactly the minimum bucket-6+ count', () => {
    creditsRepo.setVeteranSessionDueAt('2026-01-01')

    expect(service.isAvailable('2026-03-22', VETERAN_MIN_BUCKET6_WORDS)).toBe(true)
  })
})

describe('VeteranSessionService — scheduleFirst', () => {
  it('sets a due date when none exists', () => {
    service.scheduleFirst('2026-03-22')

    expect(creditsRepo.getVeteranSessionDueAt()).not.toBeNull()
  })

  it('does not overwrite an existing due date', () => {
    creditsRepo.setVeteranSessionDueAt('2026-05-01')
    service.scheduleFirst('2026-03-22')

    expect(creditsRepo.getVeteranSessionDueAt()).toBe('2026-05-01')
  })

  it('schedules within 48 hours (same day or next day or day after)', () => {
    service.scheduleFirst('2026-03-22')

    const dueAt = creditsRepo.getVeteranSessionDueAt()

    expect(dueAt).not.toBeNull()
    expect(dueAt >= '2026-03-22').toBe(true)
    expect(dueAt <= '2026-03-24').toBe(true)
  })
})

describe('VeteranSessionService — scheduleNext', () => {
  it('sets a due date at least VETERAN_INTERVAL_DAYS from today', () => {
    service.scheduleNext('2026-03-22')

    const dueAt = creditsRepo.getVeteranSessionDueAt()
    const earliest = new Date('2026-03-22T00:00:00Z')

    earliest.setUTCDate(earliest.getUTCDate() + VETERAN_INTERVAL_DAYS)

    expect(dueAt).not.toBeNull()
    expect(dueAt >= earliest.toISOString().slice(0, 10)).toBe(true)
  })

  it('sets a due date no more than VETERAN_INTERVAL_DAYS + 2 days from today', () => {
    service.scheduleNext('2026-03-22')

    const dueAt = creditsRepo.getVeteranSessionDueAt()
    const latest = new Date('2026-03-22T00:00:00Z')

    latest.setUTCDate(latest.getUTCDate() + VETERAN_INTERVAL_DAYS + 2)

    expect(dueAt).not.toBeNull()
    expect(dueAt <= latest.toISOString().slice(0, 10)).toBe(true)
  })

  it('overwrites any existing due date', () => {
    creditsRepo.setVeteranSessionDueAt('2026-01-01')
    service.scheduleNext('2026-03-22')

    expect(creditsRepo.getVeteranSessionDueAt()).not.toBe('2026-01-01')
  })
})
