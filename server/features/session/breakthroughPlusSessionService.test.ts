// @vitest-environment node

/**
 * Unit tests for BreakthroughPlusSessionService.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { BreakthroughPlusSessionService } from './breakthroughPlusSessionService.ts'
import { FakeCreditsRepository } from '../../test-utils/FakeCreditsRepository.ts'

let creditsRepo: FakeCreditsRepository
let service: BreakthroughPlusSessionService

beforeEach(() => {
  creditsRepo = new FakeCreditsRepository()
  service = new BreakthroughPlusSessionService(creditsRepo)
})

describe('BreakthroughPlusSessionService — isAvailable', () => {
  it('returns false when no due date has been set', () => {
    expect(service.isAvailable('2026-04-12')).toBe(false)
  })

  it('returns false when due date is in the future', () => {
    creditsRepo.setBreakthroughPlusSessionDueAt('9999-12-31')

    expect(service.isAvailable('2026-04-12')).toBe(false)
  })

  it('returns true when due date is today', () => {
    creditsRepo.setBreakthroughPlusSessionDueAt('2026-04-12')

    expect(service.isAvailable('2026-04-12')).toBe(true)
  })

  it('returns true when due date is in the past', () => {
    creditsRepo.setBreakthroughPlusSessionDueAt('2026-01-01')

    expect(service.isAvailable('2026-04-12')).toBe(true)
  })
})

describe('BreakthroughPlusSessionService — scheduleFirst', () => {
  it('sets due date to today when none exists', () => {
    service.scheduleFirst('2026-04-12')

    expect(creditsRepo.getBreakthroughPlusSessionDueAt()).toBe('2026-04-12')
  })

  it('does not overwrite an existing due date', () => {
    creditsRepo.setBreakthroughPlusSessionDueAt('2026-05-01')
    service.scheduleFirst('2026-04-12')

    expect(creditsRepo.getBreakthroughPlusSessionDueAt()).toBe('2026-05-01')
  })
})

describe('BreakthroughPlusSessionService — scheduleNext', () => {
  it('sets a due date exactly 1 day from today', () => {
    service.scheduleNext('2026-04-12')

    expect(creditsRepo.getBreakthroughPlusSessionDueAt()).toBe('2026-04-13')
  })

  it('overwrites any existing due date', () => {
    creditsRepo.setBreakthroughPlusSessionDueAt('2026-01-01')
    service.scheduleNext('2026-04-12')

    expect(creditsRepo.getBreakthroughPlusSessionDueAt()).not.toBe('2026-01-01')
  })
})
