// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import {
  StressSessionService,
  STRESS_MIN_CREDITS,
  STRESS_MIN_WORDS,
  STRESS_SESSION_SIZE,
  STRESS_INTERVAL_DAYS,
  calcStressFee,
} from './stressSessionService.ts'
import { FakeCreditsRepository } from '../../test-utils/FakeCreditsRepository.ts'

const TODAY = '2026-03-22'

describe('calcStressFee', () => {
  it('returns 20 for maximum session size of 24', () => {
    expect(calcStressFee(24)).toBe(20)
  })

  it('rounds down to even when fee is odd', () => {
    // floor(500 / 10) = 50 — already even
    expect(calcStressFee(10)).toBe(50)
    // floor(500 / 7) = 71 → floor(71/2)*2 = 70
    expect(calcStressFee(7)).toBe(70)
    // floor(500 / 3) = 166 → already even
    expect(calcStressFee(3)).toBe(166)
    // floor(500 / 9) = 55 → floor(55/2)*2 = 54
    expect(calcStressFee(9)).toBe(54)
  })
})

describe('StressSessionService — constants', () => {
  it('has expected constant values', () => {
    expect(STRESS_MIN_CREDITS).toBe(500)
    expect(STRESS_MIN_WORDS).toBe(5)
    expect(STRESS_SESSION_SIZE).toBe(24)
    expect(STRESS_INTERVAL_DAYS).toBe(7)
  })
})

describe('StressSessionService.isAvailable', () => {
  let creditsRepo: FakeCreditsRepository
  let service: StressSessionService

  beforeEach(() => {
    creditsRepo = new FakeCreditsRepository()
    service = new StressSessionService(creditsRepo)
  })

  it('returns false when balance < 500', () => {
    creditsRepo.addBalance(499)
    creditsRepo.setStressSessionDueAt(TODAY)

    expect(service.isAvailable(TODAY, 499, 10)).toBe(false)
  })

  it('returns false when qualifying word count < 5', () => {
    creditsRepo.addBalance(500)
    creditsRepo.setStressSessionDueAt(TODAY)

    expect(service.isAvailable(TODAY, 500, 4)).toBe(false)
  })

  it('returns false when due date is null (never scheduled)', () => {
    expect(service.isAvailable(TODAY, 500, 10)).toBe(false)
  })

  it('returns false when due date is in the future', () => {
    creditsRepo.setStressSessionDueAt('2026-03-23')

    expect(service.isAvailable(TODAY, 500, 10)).toBe(false)
  })

  it('returns true when today equals the due date', () => {
    creditsRepo.setStressSessionDueAt(TODAY)

    expect(service.isAvailable(TODAY, 500, 10)).toBe(true)
  })

  it('returns true when due date is in the past', () => {
    creditsRepo.setStressSessionDueAt('2026-03-20')

    expect(service.isAvailable(TODAY, 600, 5)).toBe(true)
  })

  it('returns true with exactly minimum values', () => {
    creditsRepo.setStressSessionDueAt(TODAY)

    expect(service.isAvailable(TODAY, STRESS_MIN_CREDITS, STRESS_MIN_WORDS)).toBe(true)
  })
})

describe('StressSessionService.scheduleFirst', () => {
  let creditsRepo: FakeCreditsRepository
  let service: StressSessionService

  beforeEach(() => {
    creditsRepo = new FakeCreditsRepository()
    service = new StressSessionService(creditsRepo)
  })

  it('sets a due date when none exists', () => {
    service.scheduleFirst(TODAY)

    const dueAt = creditsRepo.getStressSessionDueAt()

    expect(dueAt).not.toBeNull()
  })

  it('due date is today or later', () => {
    service.scheduleFirst(TODAY)

    const dueAt = creditsRepo.getStressSessionDueAt()

    expect(dueAt).not.toBeNull()

    if (dueAt !== null) {
      expect(dueAt >= TODAY).toBe(true)
    }
  })

  it('due date is at most 2 days from today', () => {
    service.scheduleFirst(TODAY)

    const dueAt = creditsRepo.getStressSessionDueAt()

    expect(dueAt).not.toBeNull()

    if (dueAt !== null) {
      expect(dueAt <= '2026-03-24').toBe(true)
    }
  })

  it('does not overwrite an existing due date', () => {
    creditsRepo.setStressSessionDueAt('2026-04-01')
    service.scheduleFirst(TODAY)

    expect(creditsRepo.getStressSessionDueAt()).toBe('2026-04-01')
  })
})

describe('StressSessionService.scheduleNext', () => {
  let creditsRepo: FakeCreditsRepository
  let service: StressSessionService

  beforeEach(() => {
    creditsRepo = new FakeCreditsRepository()
    service = new StressSessionService(creditsRepo)
  })

  it('sets a due date at least 7 days from today', () => {
    service.scheduleNext(TODAY)

    const dueAt = creditsRepo.getStressSessionDueAt()

    expect(dueAt).not.toBeNull()

    if (dueAt !== null) {
      expect(dueAt >= '2026-03-29').toBe(true)
    }
  })

  it('sets a due date at most 9 days from today', () => {
    service.scheduleNext(TODAY)

    const dueAt = creditsRepo.getStressSessionDueAt()

    expect(dueAt).not.toBeNull()

    if (dueAt !== null) {
      expect(dueAt <= '2026-03-31').toBe(true)
    }
  })

  it('overwrites an existing due date', () => {
    creditsRepo.setStressSessionDueAt(TODAY)
    service.scheduleNext(TODAY)

    const dueAt = creditsRepo.getStressSessionDueAt()

    expect(dueAt).not.toBeNull()

    if (dueAt !== null) {
      expect(dueAt > TODAY).toBe(true)
    }
  })
})
