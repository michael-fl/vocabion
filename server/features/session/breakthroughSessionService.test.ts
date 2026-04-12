// @vitest-environment node

/**
 * Unit tests for BreakthroughSessionService.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { BreakthroughSessionService } from './breakthroughSessionService.ts'
import { FakeCreditsRepository } from '../../test-utils/FakeCreditsRepository.ts'

let creditsRepo: FakeCreditsRepository
let service: BreakthroughSessionService

beforeEach(() => {
  creditsRepo = new FakeCreditsRepository()
  service = new BreakthroughSessionService(creditsRepo)
})

describe('BreakthroughSessionService — isAvailable', () => {
  it('returns false when no due date has been set', () => {
    expect(service.isAvailable('2026-03-24')).toBe(false)
  })

  it('returns false when due date is in the future', () => {
    creditsRepo.setBreakthroughSessionDueAt('9999-12-31')

    expect(service.isAvailable('2026-03-24')).toBe(false)
  })

  it('returns true when due date is today', () => {
    creditsRepo.setBreakthroughSessionDueAt('2026-03-24')

    expect(service.isAvailable('2026-03-24')).toBe(true)
  })

  it('returns true when due date is in the past', () => {
    creditsRepo.setBreakthroughSessionDueAt('2026-01-01')

    expect(service.isAvailable('2026-03-24')).toBe(true)
  })
})

describe('BreakthroughSessionService — scheduleFirst', () => {
  it('sets a due date when none exists', () => {
    service.scheduleFirst('2026-03-24')

    expect(creditsRepo.getBreakthroughSessionDueAt()).not.toBeNull()
  })

  it('does not overwrite an existing due date', () => {
    creditsRepo.setBreakthroughSessionDueAt('2026-05-01')
    service.scheduleFirst('2026-03-24')

    expect(creditsRepo.getBreakthroughSessionDueAt()).toBe('2026-05-01')
  })

  it('schedules for today (immediately eligible)', () => {
    service.scheduleFirst('2026-03-24')

    expect(creditsRepo.getBreakthroughSessionDueAt()).toBe('2026-03-24')
  })
})

describe('BreakthroughSessionService — scheduleNext', () => {
  it('sets a due date exactly BREAKTHROUGH_INTERVAL_DAYS (1 day) from today', () => {
    service.scheduleNext('2026-03-24')

    expect(creditsRepo.getBreakthroughSessionDueAt()).toBe('2026-03-25')
  })

  it('overwrites any existing due date', () => {
    creditsRepo.setBreakthroughSessionDueAt('2026-01-01')
    service.scheduleNext('2026-03-24')

    expect(creditsRepo.getBreakthroughSessionDueAt()).not.toBe('2026-01-01')
  })
})
