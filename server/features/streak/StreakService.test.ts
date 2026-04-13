// @vitest-environment node

/**
 * Tests for StreakService.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { StreakService, subtractDays, addDays, PAUSE_BUDGET_DAYS } from './StreakService.ts'
import { FakeCreditsRepository } from '../../test-utils/FakeCreditsRepository.ts'

// ── subtractDays ───────────────────────────────────────────────────────────────

describe('subtractDays', () => {
  it('subtracts one day correctly', () => {
    expect(subtractDays('2026-03-16', 1)).toBe('2026-03-15')
  })

  it('subtracts two days correctly', () => {
    expect(subtractDays('2026-03-16', 2)).toBe('2026-03-14')
  })

  it('wraps across month boundaries', () => {
    expect(subtractDays('2026-03-01', 1)).toBe('2026-02-28')
  })
})

// ── addDays ────────────────────────────────────────────────────────────────────

describe('addDays', () => {
  it('adds one day correctly', () => {
    expect(addDays('2026-03-16', 1)).toBe('2026-03-17')
  })

  it('wraps across month boundaries', () => {
    expect(addDays('2026-03-31', 1)).toBe('2026-04-01')
  })
})

// ── StreakService.getStreak ────────────────────────────────────────────────────

describe('getStreak', () => {
  let creditsRepo: FakeCreditsRepository
  let service: StreakService

  beforeEach(() => {
    creditsRepo = new FakeCreditsRepository()
    service = new StreakService(creditsRepo)
  })

  it('returns count 0 and saveAvailable false when no session has been completed', () => {
    const info = service.getStreak('2026-03-16')

    expect(info.count).toBe(0)
    expect(info.saveAvailable).toBe(false)
    expect(info.lastSessionDate).toBeNull()
  })

  it('returns saveAvailable false when last session was today', () => {
    creditsRepo.updateStreak(3, '2026-03-16')

    expect(service.getStreak('2026-03-16').saveAvailable).toBe(false)
  })

  it('returns saveAvailable false when last session was yesterday', () => {
    creditsRepo.updateStreak(3, '2026-03-15')

    expect(service.getStreak('2026-03-16').saveAvailable).toBe(false)
  })

  it('returns saveAvailable true when last session was exactly two days ago', () => {
    creditsRepo.updateStreak(3, '2026-03-14')

    expect(service.getStreak('2026-03-16').saveAvailable).toBe(true)
  })

  it('returns saveAvailable false when last session was three or more days ago', () => {
    creditsRepo.updateStreak(3, '2026-03-13')

    expect(service.getStreak('2026-03-16').saveAvailable).toBe(false)
  })

  it('returns the current streak count', () => {
    creditsRepo.updateStreak(7, '2026-03-14')

    expect(service.getStreak('2026-03-16').count).toBe(7)
  })

  it('returns the lastSessionDate from the repository', () => {
    creditsRepo.updateStreak(3, '2026-03-15')

    expect(service.getStreak('2026-03-16').lastSessionDate).toBe('2026-03-15')
  })

  it('returns saveAvailable false when paused (even if last session was two days ago)', () => {
    creditsRepo.updateStreak(3, '2026-03-14')
    creditsRepo.setPauseActive('2026-03-15')

    expect(service.getStreak('2026-03-16').saveAvailable).toBe(false)
  })

  it('includes pause info with active=false and full budget when not paused', () => {
    const info = service.getStreak('2026-03-16')

    expect(info.pause.active).toBe(false)
    expect(info.pause.startDate).toBeNull()
    expect(info.pause.budgetRemaining).toBe(PAUSE_BUDGET_DAYS)
    expect(info.pause.daysConsumed).toBe(0)
    expect(info.pause.daysToCharge).toBe(0)
  })

  it('shows daysToCharge = 2 when 2 days have been missed and not paused', () => {
    creditsRepo.updateStreak(5, '2026-03-14') // last session Monday; today is Thursday

    const info = service.getStreak('2026-03-17')

    expect(info.pause.daysToCharge).toBe(2) // Tue + Wed already missed
  })

  it('shows correct daysToCharge and budgetRemaining when pause is active', () => {
    creditsRepo.updateStreak(5, '2026-03-10')
    creditsRepo.setPauseActive('2026-03-11')

    const info = service.getStreak('2026-03-15') // 4 days into the pause

    expect(info.pause.active).toBe(true)
    expect(info.pause.daysToCharge).toBe(4)
    expect(info.pause.daysConsumed).toBe(4)
    expect(info.pause.budgetRemaining).toBe(PAUSE_BUDGET_DAYS - 4)
  })

  it('resets budget when year changes', () => {
    creditsRepo.setPauseInactive(13, 2025) // 13 days used last year

    const info = service.getStreak('2026-01-05')

    expect(info.pause.daysConsumed).toBe(0)
    expect(info.pause.budgetRemaining).toBe(PAUSE_BUDGET_DAYS)
  })
})

// ── StreakService.saveStreak ───────────────────────────────────────────────────

describe('saveStreak', () => {
  let creditsRepo: FakeCreditsRepository
  let service: StreakService

  beforeEach(() => {
    creditsRepo = new FakeCreditsRepository()
    service = new StreakService(creditsRepo)
    creditsRepo.updateStreak(5, '2026-03-14')  // last session 2 days ago
  })

  it('throws ApiError 400 when the streak is not saveable', () => {
    creditsRepo.updateStreak(5, '2026-03-13')  // 3 days ago — too old

    expect(() => service.saveStreak('2026-03-16')).toThrow()
  })

  it('throws ApiError 402 when balance is below 200', () => {
    creditsRepo.addBalance(199)

    expect(() => service.saveStreak('2026-03-16')).toThrow()
  })

  it('deducts 200 credits', () => {
    creditsRepo.addBalance(300)

    service.saveStreak('2026-03-16')

    expect(creditsRepo.getBalance()).toBe(100)
  })

  it('sets streak save pending', () => {
    creditsRepo.addBalance(200)

    service.saveStreak('2026-03-16')

    expect(creditsRepo.isStreakSavePending()).toBe(true)
  })

  it('returns the new balance', () => {
    creditsRepo.addBalance(300)

    const balance = service.saveStreak('2026-03-16')

    expect(balance).toBe(100)
  })

  it('throws 400 when the game is paused', () => {
    creditsRepo.addBalance(100)
    creditsRepo.setPauseActive('2026-03-15')

    expect(() => service.saveStreak('2026-03-16')).toThrow()
  })
})

// ── StreakService.activatePause ────────────────────────────────────────────────

describe('activatePause', () => {
  let creditsRepo: FakeCreditsRepository
  let service: StreakService

  beforeEach(() => {
    creditsRepo = new FakeCreditsRepository()
    service = new StreakService(creditsRepo)
  })

  it('activates pause with retroactive start date (day after last session)', () => {
    creditsRepo.updateStreak(5, '2026-03-10')

    service.activatePause('2026-03-13')

    expect(creditsRepo.getPauseState().active).toBe(true)
    expect(creditsRepo.getPauseState().startDate).toBe('2026-03-11')
  })

  it('activates pause starting today when no session has been completed', () => {
    service.activatePause('2026-03-16')

    expect(creditsRepo.getPauseState().startDate).toBe('2026-03-16')
  })

  it('activates pause when last session was yesterday (0 retroactive days)', () => {
    creditsRepo.updateStreak(5, '2026-03-15')

    service.activatePause('2026-03-16')

    expect(creditsRepo.getPauseState().active).toBe(true)
    expect(creditsRepo.getPauseState().startDate).toBe('2026-03-16')
  })

  it('throws 400 when already paused', () => {
    creditsRepo.setPauseActive('2026-03-15')

    expect(() => service.activatePause('2026-03-16')).toThrow()
  })

  it('throws 409 when retroactive days exceed remaining budget', () => {
    creditsRepo.updateStreak(5, '2026-03-01')
    creditsRepo.setPauseInactive(13, 2026) // only 1 day left

    // 5 retroactive days missed (Mar 2–6), but only 1 day remaining
    expect(() => service.activatePause('2026-03-07')).toThrow()
  })

  it('allows activation when retroactive days exactly equal remaining budget', () => {
    creditsRepo.updateStreak(5, '2026-03-01')
    creditsRepo.setPauseInactive(11, 2026) // 3 days left

    // 3 retroactive days missed (Mar 2–4)
    expect(() => service.activatePause('2026-03-05')).not.toThrow()
  })

  it('returns updated PauseInfo', () => {
    creditsRepo.updateStreak(5, '2026-03-15')

    const info = service.activatePause('2026-03-16')

    expect(info.active).toBe(true)
    expect(info.startDate).toBe('2026-03-16')
  })
})

// ── StreakService.resumePause ──────────────────────────────────────────────────

describe('resumePause', () => {
  let creditsRepo: FakeCreditsRepository
  let service: StreakService

  beforeEach(() => {
    creditsRepo = new FakeCreditsRepository()
    service = new StreakService(creditsRepo)
  })

  it('throws 400 when the game is not paused', () => {
    expect(() => service.resumePause('2026-03-16')).toThrow()
  })

  it('advances the streak by the pause duration', () => {
    creditsRepo.updateStreak(10, '2026-03-10')
    creditsRepo.setPauseActive('2026-03-11')

    service.resumePause('2026-03-15') // 4 pause days (Mar 11–14)

    expect(creditsRepo.getStreakCount()).toBe(14)
  })

  it('sets lastSessionDate to yesterday so the next session increments correctly', () => {
    creditsRepo.updateStreak(10, '2026-03-10')
    creditsRepo.setPauseActive('2026-03-11')

    service.resumePause('2026-03-15')

    expect(creditsRepo.getLastSessionDate()).toBe('2026-03-14')
  })

  it('clears the pause state', () => {
    creditsRepo.updateStreak(5, '2026-03-10')
    creditsRepo.setPauseActive('2026-03-11')

    service.resumePause('2026-03-15')

    expect(creditsRepo.getPauseState().active).toBe(false)
    expect(creditsRepo.getPauseState().startDate).toBeNull()
  })

  it('consumes pause days from the budget', () => {
    creditsRepo.updateStreak(5, '2026-03-10')
    creditsRepo.setPauseActive('2026-03-11')

    service.resumePause('2026-03-15') // 4 days

    expect(creditsRepo.getPauseState().daysUsed).toBe(4)
    expect(creditsRepo.getPauseState().budgetYear).toBe(2026)
  })

  it('accumulates budget across multiple pauses', () => {
    creditsRepo.updateStreak(5, '2026-03-10')
    creditsRepo.setPauseInactive(3, 2026) // 3 days already used
    creditsRepo.setPauseActive('2026-03-11')

    service.resumePause('2026-03-15') // 4 more days

    expect(creditsRepo.getPauseState().daysUsed).toBe(7)
  })

  it('awards Week 1 milestone when streak crosses 7 during pause', () => {
    creditsRepo.updateStreak(4, '2026-03-10')
    creditsRepo.setPauseActive('2026-03-11')

    const result = service.resumePause('2026-03-15') // streak becomes 8

    expect(result.milestoneLabels).toContain('Week 1')
    expect(result.creditsAwarded).toBe(10)
  })

  it('awards both week milestones when streak crosses 7 and 14 during pause', () => {
    creditsRepo.updateStreak(3, '2026-03-01')
    creditsRepo.setPauseActive('2026-03-02')

    const result = service.resumePause('2026-03-20') // streak becomes 3 + 18 = 21

    expect(result.milestoneLabels).toContain('Week 1')
    expect(result.milestoneLabels).toContain('2 Weeks')
    expect(result.creditsAwarded).toBe(30)
  })

  it('awards a monthly milestone whose last day fell during the pause', () => {
    // Streak started March 4, month 1 milestone = March 31.
    // Pause covers March 28 to April 4 (resume April 4).
    creditsRepo.updateStreak(24, '2026-03-27')
    creditsRepo.updateStreak(24, '2026-03-27') // ensure startDate is set
    // Manually set streak start date by updating with count=1 then restoring
    creditsRepo.updateStreak(1, '2026-03-04')
    creditsRepo.updateStreak(24, '2026-03-27')
    creditsRepo.setPauseActive('2026-03-28')

    const result = service.resumePause('2026-04-04')

    expect(result.milestoneLabels).toContain('Month 1')
  })

  it('returns empty milestones when no milestones were crossed', () => {
    creditsRepo.updateStreak(10, '2026-03-10')
    creditsRepo.setStreakWeeksAwarded(2)  // both week milestones already awarded
    creditsRepo.setPauseActive('2026-03-11')

    const result = service.resumePause('2026-03-14') // 3 days, streak 13

    expect(result.milestoneLabels).toHaveLength(0)
    expect(result.creditsAwarded).toBe(0)
  })
})
