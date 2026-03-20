/**
 * Pure utility functions for streak milestone detection and display.
 *
 * Milestones replace the standard +1 daily streak credit when reached:
 * - Week 1 (streak = 7):  10 credits
 * - Week 2 (streak = 14): 20 credits
 * - Each calendar month:  200 credits
 * - Year 1 (month 12):   500 credits
 * - Year 2+ (every 12th month after month 12): 1 000 credits
 *
 * Monthly milestones are calendar-based: if the streak started on day 1–7 of
 * a month, that month counts as month 1 (reward on its last day). If started
 * on day 8+, month 1 is the following full calendar month.
 *
 * @example
 * ```ts
 * const milestone = checkMilestoneReached({ streakCount: 7, weeksAwarded: 0, ... })
 * // → { label: 'Week 1', credits: 10, type: 'week' }
 * ```
 */

/** Info about a reached or upcoming milestone. */
export interface MilestoneInfo {
  label: string
  credits: number
}

/** A reached milestone, including which counter to increment. */
export interface MilestoneResult extends MilestoneInfo {
  type: 'week' | 'month'
}

/** Next upcoming milestone shown on the home screen. */
export interface NextMilestone extends MilestoneInfo {
  daysUntil: number
}

/**
 * Returns true when `dateStr` is the last day of its calendar month (UTC).
 */
export function isLastDayOfMonth(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00Z')
  const next = new Date(dateStr + 'T00:00:00Z')

  next.setUTCDate(next.getUTCDate() + 1)

  return next.getUTCMonth() !== d.getUTCMonth()
}

/**
 * Returns the { year, month } (1-indexed) of the first countable month for
 * monthly milestone purposes.
 *
 * If the streak started on day 1–7: that month is month 1.
 * If the streak started on day 8+: the following month is month 1.
 */
export function getEffectiveStreakStartMonth(streakStartDate: string): { year: number; month: number } {
  const d = new Date(streakStartDate + 'T00:00:00Z')

  if (d.getUTCDate() <= 7) {
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
  }

  // Move to the first day of the next month.
  const next = new Date(streakStartDate + 'T00:00:00Z')

  next.setUTCDate(1)
  next.setUTCMonth(next.getUTCMonth() + 1)

  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 }
}

/**
 * Returns the last calendar day (YYYY-MM-DD, UTC) on which the Nth monthly
 * milestone should be paid. `monthCount = 1` is the first monthly milestone.
 */
export function getMonthMilestoneDate(streakStartDate: string, monthCount: number): string {
  const { year: startYear, month: startMonth } = getEffectiveStreakStartMonth(streakStartDate)

  // Convert to 0-indexed absolute month, advance by (monthCount - 1), convert back.
  const absoluteMonth = startYear * 12 + (startMonth - 1) + (monthCount - 1)
  const targetYear = Math.floor(absoluteMonth / 12)
  const targetMonth1 = (absoluteMonth % 12) + 1 // 1-indexed

  // Day 0 of the next month equals the last day of the target month.
  const lastDay = new Date(Date.UTC(targetYear, targetMonth1, 0))

  return lastDay.toISOString().slice(0, 10)
}

/**
 * Returns how many monthly milestones are due as of `today`.
 * Returns 0 when today is not the last day of a month (no milestone can fire).
 */
export function computeStreakMonthsCompleted(streakStartDate: string, today: string): number {
  if (!isLastDayOfMonth(today)) {
    return 0
  }

  const { year: startYear, month: startMonth } = getEffectiveStreakStartMonth(streakStartDate)
  const d = new Date(today + 'T00:00:00Z')
  const todayYear = d.getUTCFullYear()
  const todayMonth = d.getUTCMonth() + 1

  return Math.max(0, (todayYear - startYear) * 12 + (todayMonth - startMonth) + 1)
}

/**
 * Returns the credit reward for the Nth monthly milestone.
 * Month 12 = 500 (year 1); month 24 and every 12th month after = 1 000; all other months = 200.
 */
export function getMilestoneMonthCredits(monthCount: number): number {
  if (monthCount % 12 === 0) {
    return monthCount >= 24 ? 1000 : 500
  }

  return 200
}

/**
 * Returns a human-readable label for the Nth monthly milestone.
 * e.g. 'Month 1', 'Month 11', '1 Year', '2 Years'.
 */
export function getMilestoneMonthLabel(monthCount: number): string {
  if (monthCount % 12 === 0) {
    const years = monthCount / 12

    return years === 1 ? '1 Year' : `${years} Years`
  }

  return `Month ${monthCount}`
}

/** Returns the absolute difference in days between two YYYY-MM-DD UTC strings. */
export function diffDays(from: string, to: string): number {
  const fromMs = new Date(from + 'T00:00:00Z').getTime()
  const toMs = new Date(to + 'T00:00:00Z').getTime()

  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000))
}

/**
 * Checks whether a streak milestone was just reached on `today`.
 * Called when a session completes (first session of the day, streak ≥ 2).
 *
 * Returns the milestone reached, or `null` if none.
 * Week milestones are checked before monthly ones.
 */
export function checkMilestoneReached(params: {
  streakCount: number
  weeksAwarded: number
  monthsAwarded: number
  streakStartDate: string | null
  today: string
}): MilestoneResult | null {
  const { streakCount, weeksAwarded, monthsAwarded, streakStartDate, today } = params

  if (streakCount === 7 && weeksAwarded === 0) {
    return { label: 'Week 1', credits: 10, type: 'week' }
  }

  if (streakCount === 14 && weeksAwarded === 1) {
    return { label: '2 Weeks', credits: 20, type: 'week' }
  }

  if (streakStartDate !== null) {
    const completed = computeStreakMonthsCompleted(streakStartDate, today)

    if (completed > monthsAwarded) {
      const nextCount = monthsAwarded + 1

      return {
        label: getMilestoneMonthLabel(nextCount),
        credits: getMilestoneMonthCredits(nextCount),
        type: 'month',
      }
    }
  }

  return null
}

/**
 * Returns the next upcoming milestone to show on the home screen.
 * Returns `null` when the streak is 0 (no active streak).
 */
export function getNextMilestone(params: {
  streakCount: number
  weeksAwarded: number
  monthsAwarded: number
  streakStartDate: string | null
  today: string
}): NextMilestone | null {
  const { streakCount, weeksAwarded, monthsAwarded, streakStartDate, today } = params

  if (streakCount === 0) {
    return null
  }

  // Week 1 (only if streak hasn't passed it yet)
  if (weeksAwarded < 1 && streakCount <= 7) {
    return { label: 'Week 1', credits: 10, daysUntil: 7 - streakCount }
  }

  // Week 2
  if (weeksAwarded < 2 && streakCount <= 14) {
    return { label: '2 Weeks', credits: 20, daysUntil: 14 - streakCount }
  }

  // Monthly milestone
  if (streakStartDate === null) {
    return null
  }

  const nextMonthCount = monthsAwarded + 1
  const targetDate = getMonthMilestoneDate(streakStartDate, nextMonthCount)
  const daysUntil = Math.max(0, diffDays(today, targetDate))

  return {
    label: getMilestoneMonthLabel(nextMonthCount),
    credits: getMilestoneMonthCredits(nextMonthCount),
    daysUntil,
  }
}
