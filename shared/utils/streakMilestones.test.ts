// @vitest-environment node

/**
 * Tests for streakMilestones pure utility functions.
 */

import { describe, it, expect } from 'vitest'
import {
  isLastDayOfMonth,
  getEffectiveStreakStartMonth,
  getMonthMilestoneDate,
  computeStreakMonthsCompleted,
  getMilestoneMonthCredits,
  getMilestoneMonthLabel,
  diffDays,
  checkMilestoneReached,
  getNextMilestone,
} from './streakMilestones.ts'

// ── isLastDayOfMonth ──────────────────────────────────────────────────────────

describe('isLastDayOfMonth', () => {
  it('returns true for the last day of March', () => {
    expect(isLastDayOfMonth('2026-03-31')).toBe(true)
  })

  it('returns true for the last day of April', () => {
    expect(isLastDayOfMonth('2026-04-30')).toBe(true)
  })

  it('returns true for the last day of February (non-leap year)', () => {
    expect(isLastDayOfMonth('2026-02-28')).toBe(true)
  })

  it('returns true for the last day of February (leap year)', () => {
    expect(isLastDayOfMonth('2028-02-29')).toBe(true)
  })

  it('returns false for March 30', () => {
    expect(isLastDayOfMonth('2026-03-30')).toBe(false)
  })

  it('returns false for mid-month', () => {
    expect(isLastDayOfMonth('2026-03-15')).toBe(false)
  })
})

// ── getEffectiveStreakStartMonth ───────────────────────────────────────────────

describe('getEffectiveStreakStartMonth', () => {
  it('returns the same month when started on day 1', () => {
    expect(getEffectiveStreakStartMonth('2026-03-01')).toEqual({ year: 2026, month: 3 })
  })

  it('returns the same month when started on day 7', () => {
    expect(getEffectiveStreakStartMonth('2026-03-07')).toEqual({ year: 2026, month: 3 })
  })

  it('returns the next month when started on day 8', () => {
    expect(getEffectiveStreakStartMonth('2026-03-08')).toEqual({ year: 2026, month: 4 })
  })

  it('returns the next month when started on day 15', () => {
    expect(getEffectiveStreakStartMonth('2026-03-15')).toEqual({ year: 2026, month: 4 })
  })

  it('wraps to January of the next year when started in late December', () => {
    expect(getEffectiveStreakStartMonth('2026-12-15')).toEqual({ year: 2027, month: 1 })
  })
})

// ── getMonthMilestoneDate ──────────────────────────────────────────────────────

describe('getMonthMilestoneDate', () => {
  it('returns March 31 for month 1 when streak started on March 4', () => {
    expect(getMonthMilestoneDate('2026-03-04', 1)).toBe('2026-03-31')
  })

  it('returns April 30 for month 2 when streak started on March 4', () => {
    expect(getMonthMilestoneDate('2026-03-04', 2)).toBe('2026-04-30')
  })

  it('returns February 28 for month 12 when streak started on March 4 (year 1 milestone)', () => {
    // Effective start = March 2026. Month 12 = February 2027.
    expect(getMonthMilestoneDate('2026-03-04', 12)).toBe('2027-02-28')
  })

  it('returns February 28 for month 24 when streak started on March 4 (year 2 milestone)', () => {
    expect(getMonthMilestoneDate('2026-03-04', 24)).toBe('2028-02-29') // 2028 is a leap year
  })

  it('returns April 30 for month 1 when streak started on March 15 (day > 7)', () => {
    // Effective start = April 2026. Month 1 = April 2026.
    expect(getMonthMilestoneDate('2026-03-15', 1)).toBe('2026-04-30')
  })
})

// ── computeStreakMonthsCompleted ───────────────────────────────────────────────

describe('computeStreakMonthsCompleted', () => {
  it('returns 0 when today is not the last day of a month', () => {
    expect(computeStreakMonthsCompleted('2026-03-04', '2026-03-15')).toBe(0)
  })

  it('returns 1 on March 31 when streak started on March 4', () => {
    expect(computeStreakMonthsCompleted('2026-03-04', '2026-03-31')).toBe(1)
  })

  it('returns 2 on April 30 when streak started on March 4', () => {
    expect(computeStreakMonthsCompleted('2026-03-04', '2026-04-30')).toBe(2)
  })

  it('returns 12 on February 28 next year (year 1 milestone)', () => {
    expect(computeStreakMonthsCompleted('2026-03-04', '2027-02-28')).toBe(12)
  })

  it('returns 0 on March 31 when streak started on March 15 (effective start = April)', () => {
    expect(computeStreakMonthsCompleted('2026-03-15', '2026-03-31')).toBe(0)
  })

  it('returns 1 on April 30 when streak started on March 15', () => {
    expect(computeStreakMonthsCompleted('2026-03-15', '2026-04-30')).toBe(1)
  })
})

// ── getMilestoneMonthCredits ───────────────────────────────────────────────────

describe('getMilestoneMonthCredits', () => {
  it('returns 200 for month 1', () => {
    expect(getMilestoneMonthCredits(1)).toBe(200)
  })

  it('returns 200 for month 11', () => {
    expect(getMilestoneMonthCredits(11)).toBe(200)
  })

  it('returns 500 for month 12 (year 1)', () => {
    expect(getMilestoneMonthCredits(12)).toBe(500)
  })

  it('returns 200 for month 13', () => {
    expect(getMilestoneMonthCredits(13)).toBe(200)
  })

  it('returns 1000 for month 24 (year 2)', () => {
    expect(getMilestoneMonthCredits(24)).toBe(1000)
  })

  it('returns 1000 for month 36 (year 3)', () => {
    expect(getMilestoneMonthCredits(36)).toBe(1000)
  })

  it('returns 200 for month 25', () => {
    expect(getMilestoneMonthCredits(25)).toBe(200)
  })
})

// ── getMilestoneMonthLabel ─────────────────────────────────────────────────────

describe('getMilestoneMonthLabel', () => {
  it('returns "Month 1" for month 1', () => {
    expect(getMilestoneMonthLabel(1)).toBe('Month 1')
  })

  it('returns "Month 11" for month 11', () => {
    expect(getMilestoneMonthLabel(11)).toBe('Month 11')
  })

  it('returns "1 Year" for month 12', () => {
    expect(getMilestoneMonthLabel(12)).toBe('1 Year')
  })

  it('returns "Month 13" for month 13', () => {
    expect(getMilestoneMonthLabel(13)).toBe('Month 13')
  })

  it('returns "2 Years" for month 24', () => {
    expect(getMilestoneMonthLabel(24)).toBe('2 Years')
  })

  it('returns "3 Years" for month 36', () => {
    expect(getMilestoneMonthLabel(36)).toBe('3 Years')
  })
})

// ── diffDays ──────────────────────────────────────────────────────────────────

describe('diffDays', () => {
  it('returns 0 for the same date', () => {
    expect(diffDays('2026-03-16', '2026-03-16')).toBe(0)
  })

  it('returns 1 for consecutive days', () => {
    expect(diffDays('2026-03-15', '2026-03-16')).toBe(1)
  })

  it('returns 15 from March 16 to March 31', () => {
    expect(diffDays('2026-03-16', '2026-03-31')).toBe(15)
  })

  it('returns negative when target is before source', () => {
    expect(diffDays('2026-03-16', '2026-03-10')).toBe(-6)
  })
})

// ── checkMilestoneReached ─────────────────────────────────────────────────────

describe('checkMilestoneReached', () => {
  it('returns week 1 milestone when streak = 7 and weeksAwarded = 0', () => {
    const result = checkMilestoneReached({
      streakCount: 7,
      weeksAwarded: 0,
      monthsAwarded: 0,
      streakStartDate: '2026-03-04',
      today: '2026-03-10',
    })

    expect(result).toEqual({ label: 'Week 1', credits: 10, type: 'week' })
  })

  it('returns null when streak = 7 but week 1 already awarded', () => {
    expect(checkMilestoneReached({
      streakCount: 7,
      weeksAwarded: 1,
      monthsAwarded: 0,
      streakStartDate: '2026-03-04',
      today: '2026-03-10',
    })).toBeNull()
  })

  it('returns week 2 milestone when streak = 14 and weeksAwarded = 1', () => {
    const result = checkMilestoneReached({
      streakCount: 14,
      weeksAwarded: 1,
      monthsAwarded: 0,
      streakStartDate: '2026-03-04',
      today: '2026-03-17',
    })

    expect(result).toEqual({ label: '2 Weeks', credits: 20, type: 'week' })
  })

  it('returns month 1 milestone on March 31 when started March 4', () => {
    const result = checkMilestoneReached({
      streakCount: 28,
      weeksAwarded: 2,
      monthsAwarded: 0,
      streakStartDate: '2026-03-04',
      today: '2026-03-31',
    })

    expect(result).toEqual({ label: 'Month 1', credits: 200, type: 'month' })
  })

  it('returns 1 Year milestone when month 12 is completed', () => {
    const result = checkMilestoneReached({
      streakCount: 365,
      weeksAwarded: 2,
      monthsAwarded: 11,
      streakStartDate: '2026-03-04',
      today: '2027-02-28',
    })

    expect(result).toEqual({ label: '1 Year', credits: 500, type: 'month' })
  })

  it('returns 2 Years milestone when month 24 is completed', () => {
    const result = checkMilestoneReached({
      streakCount: 730,
      weeksAwarded: 2,
      monthsAwarded: 23,
      streakStartDate: '2026-03-04',
      today: '2028-02-29',
    })

    expect(result).toEqual({ label: '2 Years', credits: 1000, type: 'month' })
  })

  it('returns null when monthly milestone already awarded', () => {
    expect(checkMilestoneReached({
      streakCount: 28,
      weeksAwarded: 2,
      monthsAwarded: 1,
      streakStartDate: '2026-03-04',
      today: '2026-03-31',
    })).toBeNull()
  })

  it('returns null when today is not last day of month', () => {
    expect(checkMilestoneReached({
      streakCount: 20,
      weeksAwarded: 2,
      monthsAwarded: 0,
      streakStartDate: '2026-03-04',
      today: '2026-03-20',
    })).toBeNull()
  })

  it('returns null when streakStartDate is null (no monthly milestone possible)', () => {
    expect(checkMilestoneReached({
      streakCount: 20,
      weeksAwarded: 2,
      monthsAwarded: 0,
      streakStartDate: null,
      today: '2026-03-31',
    })).toBeNull()
  })
})

// ── getNextMilestone ──────────────────────────────────────────────────────────

describe('getNextMilestone', () => {
  it('returns null when streak is 0', () => {
    expect(getNextMilestone({
      streakCount: 0,
      weeksAwarded: 0,
      monthsAwarded: 0,
      streakStartDate: null,
      today: '2026-03-16',
    })).toBeNull()
  })

  it('returns Week 1 when weeksAwarded = 0 and streak < 7', () => {
    const result = getNextMilestone({
      streakCount: 3,
      weeksAwarded: 0,
      monthsAwarded: 0,
      streakStartDate: '2026-03-14',
      today: '2026-03-16',
    })

    expect(result).toEqual({ label: 'Week 1', credits: 10, daysUntil: 4 })
  })

  it('returns Week 2 when week 1 awarded and streak < 14', () => {
    const result = getNextMilestone({
      streakCount: 10,
      weeksAwarded: 1,
      monthsAwarded: 0,
      streakStartDate: '2026-03-07',
      today: '2026-03-16',
    })

    expect(result).toEqual({ label: '2 Weeks', credits: 20, daysUntil: 4 })
  })

  it('skips to monthly when weeksAwarded < 1 but streak already past 7', () => {
    // Existing user with streak = 20 but weeksAwarded = 0 (pre-feature data)
    const result = getNextMilestone({
      streakCount: 20,
      weeksAwarded: 0,
      monthsAwarded: 0,
      streakStartDate: '2026-03-04',
      today: '2026-03-23',
    })

    // Next monthly milestone: Month 1 = March 31
    expect(result).toEqual({ label: 'Month 1', credits: 200, daysUntil: 8 })
  })

  it('returns Month 1 info after both weeks awarded', () => {
    const result = getNextMilestone({
      streakCount: 20,
      weeksAwarded: 2,
      monthsAwarded: 0,
      streakStartDate: '2026-03-04',
      today: '2026-03-23',
    })

    expect(result).toEqual({ label: 'Month 1', credits: 200, daysUntil: 8 })
  })

  it('returns 1 Year info when approaching month 12', () => {
    const result = getNextMilestone({
      streakCount: 330,
      weeksAwarded: 2,
      monthsAwarded: 11,
      streakStartDate: '2026-03-04',
      today: '2027-02-14',
    })

    expect(result).toEqual({ label: '1 Year', credits: 500, daysUntil: 14 })
  })

  it('returns daysUntil = 0 when the milestone is today', () => {
    const result = getNextMilestone({
      streakCount: 28,
      weeksAwarded: 2,
      monthsAwarded: 0,
      streakStartDate: '2026-03-04',
      today: '2026-03-31',
    })

    expect(result).toEqual({ label: 'Month 1', credits: 200, daysUntil: 0 })
  })

  it('returns null when past weeks and streakStartDate is null', () => {
    expect(getNextMilestone({
      streakCount: 20,
      weeksAwarded: 2,
      monthsAwarded: 0,
      streakStartDate: null,
      today: '2026-03-16',
    })).toBeNull()
  })
})
