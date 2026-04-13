/**
 * Business logic for the daily practice streak system.
 *
 * A streak counts consecutive calendar days (UTC) on which the user completed
 * at least one training session. Streak state is stored in the `credits` table.
 *
 * Pause mode lets users protect their streak during vacations or emergencies.
 * Each pause starts retroactively from the day after the last session.
 * The annual budget is {@link PAUSE_BUDGET_DAYS} days; it resets on 1 January.
 *
 * @example
 * ```ts
 * const service = new StreakService(creditsRepo)
 * const info = service.getStreak('2026-03-16')
 * // → { count: 5, saveAvailable: false, pause: { active: false, ... } }
 * ```
 */
import type { CreditsRepository } from '../credits/CreditsRepository.ts'
import { ApiError } from '../../errors/ApiError.ts'
import {
  getNextMilestone,
  getMonthMilestoneDate,
  getMilestoneMonthCredits,
  getMilestoneMonthLabel,
  diffDays,
} from '../../../shared/utils/streakMilestones.ts'
import type { NextMilestone } from '../../../shared/utils/streakMilestones.ts'

/** Maximum pause days available per calendar year. */
export const PAUSE_BUDGET_DAYS = 14

/** Credit cost to save a streak (bridge a missed day). */
export const STREAK_SAVE_COST = 200

/**
 * Returns `date` shifted backwards by `days` calendar days (UTC).
 * e.g. subtractDays('2026-03-16', 1) → '2026-03-15'
 */
export function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/**
 * Returns `date` shifted forward by `days` calendar days (UTC).
 * e.g. addDays('2026-03-16', 1) → '2026-03-17'
 */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Pause budget and current status. */
export interface PauseInfo {
  /** Whether the game is currently paused. */
  active: boolean
  /** Retroactive start date of the current pause (day after last session). Null when not paused. */
  startDate: string | null
  /**
   * Total pause days consumed this year (completed pauses + current active pause so far).
   * Used to display remaining budget.
   */
  daysConsumed: number
  /** Days remaining in the annual budget (`PAUSE_BUDGET_DAYS − daysConsumed`, floored at 0). */
  budgetRemaining: number
  /**
   * When **not** paused: number of retroactive days that would be charged if the user paused right now
   * (i.e. days already missed since the last session). 0 if the user practiced today or yesterday.
   *
   * When **paused**: the number of days the current pause has been active so far.
   */
  daysToCharge: number
}

/** Current streak state returned by `getStreak`. */
export interface StreakInfo {
  /** Number of consecutive days the user has practiced. */
  count: number
  /**
   * True if the streak is saveable: the last session was on the day before
   * yesterday (calendar-day comparison, UTC). The user can pay 200 credits to
   * bridge the gap. Always false when the game is paused.
   */
  saveAvailable: boolean
  /**
   * The UTC date (`YYYY-MM-DD`) of the last completed session, or `null` if no
   * session has ever been completed. Exposed so the frontend can compute
   * time-sensitive warnings (e.g. evening reminder) using local browser time.
   */
  lastSessionDate: string | null
  /**
   * The next streak milestone to reach, with its label, credit reward, and
   * days until it fires. `null` when there is no active streak.
   */
  nextMilestone: NextMilestone | null
  /** Current pause budget state. */
  pause: PauseInfo
}

/** Result returned by `resumePause`. */
export interface ResumeResult {
  /** Total credits awarded for milestones crossed during the pause. */
  creditsAwarded: number
  /** Labels of milestones awarded (e.g. ['Week 1', 'Month 1']). Empty when none. */
  milestoneLabels: string[]
}

export class StreakService {
  constructor(private readonly creditsRepo: CreditsRepository) {}

  /**
   * Returns the current streak count and whether the streak can still be saved.
   *
   * @param today - Current date as YYYY-MM-DD (UTC). Injected for testability.
   */
  getStreak(today: string): StreakInfo {
    const lastDate = this.creditsRepo.getLastSessionDate()
    const dayBeforeYesterday = subtractDays(today, 2)
    const count = this.creditsRepo.getStreakCount()
    const pauseState = this.creditsRepo.getPauseState()

    const todayYear = parseInt(today.slice(0, 4), 10)
    const effectiveDaysUsed = pauseState.budgetYear === todayYear ? pauseState.daysUsed : 0

    const currentPauseDays = pauseState.active && pauseState.startDate !== null
      ? Math.max(0, diffDays(pauseState.startDate, today))
      : 0

    const daysToCharge = pauseState.active
      ? currentPauseDays
      : (lastDate !== null ? Math.max(0, diffDays(addDays(lastDate, 1), today)) : 0)

    const daysConsumed = effectiveDaysUsed + currentPauseDays
    const budgetRemaining = Math.max(0, PAUSE_BUDGET_DAYS - daysConsumed)

    return {
      count,
      saveAvailable: lastDate === dayBeforeYesterday && !pauseState.active,
      lastSessionDate: lastDate,
      nextMilestone: getNextMilestone({
        streakCount: count,
        weeksAwarded: this.creditsRepo.getStreakWeeksAwarded(),
        monthsAwarded: this.creditsRepo.getStreakMonthsAwarded(),
        streakStartDate: this.creditsRepo.getStreakStartDate(),
        today,
      }),
      pause: {
        active: pauseState.active,
        startDate: pauseState.startDate,
        daysConsumed,
        budgetRemaining,
        daysToCharge,
      },
    }
  }

  /**
   * Deducts {@link STREAK_SAVE_COST} credits and marks the streak as pending a bridge answer.
   *
   * @param today - Current date as YYYY-MM-DD (UTC). Injected for testability.
   * @returns The new credit balance after deduction.
   * @throws {ApiError} 400 if the streak is not saveable or the game is paused.
   * @throws {ApiError} 402 if the balance is below {@link STREAK_SAVE_COST}.
   */
  saveStreak(today: string): number {
    if (this.creditsRepo.getPauseState().active) {
      throw new ApiError(400, 'Cannot save streak while the game is paused')
    }

    const { saveAvailable } = this.getStreak(today)

    if (!saveAvailable) {
      throw new ApiError(400, 'Streak cannot be saved: last session was not exactly two days ago')
    }

    const balance = this.creditsRepo.getBalance()

    if (balance < STREAK_SAVE_COST) {
      throw new ApiError(402, `Insufficient credits: need ${STREAK_SAVE_COST} to save streak, have ${balance}`)
    }

    this.creditsRepo.addBalance(-STREAK_SAVE_COST)
    this.creditsRepo.setStreakSavePending(true)

    return this.creditsRepo.getBalance()
  }

  /**
   * Activates pause mode. The pause starts retroactively from the day after
   * the last session (or today if no session has been completed yet).
   *
   * @param today - Current date as YYYY-MM-DD (UTC). Injected for testability.
   * @returns The updated `PauseInfo` after activation.
   * @throws {ApiError} 400 if the game is already paused.
   * @throws {ApiError} 409 if the retroactive days already missed exceed the remaining budget.
   */
  activatePause(today: string): PauseInfo {
    const pauseState = this.creditsRepo.getPauseState()

    if (pauseState.active) {
      throw new ApiError(400, 'Game is already paused')
    }

    const lastDate = this.creditsRepo.getLastSessionDate()
    const pauseStartDate = lastDate !== null ? addDays(lastDate, 1) : today

    // Days already missed before today that need retroactive coverage.
    const retroactiveDays = Math.max(0, diffDays(pauseStartDate, today))

    const todayYear = parseInt(today.slice(0, 4), 10)
    const effectiveDaysUsed = pauseState.budgetYear === todayYear ? pauseState.daysUsed : 0
    const budgetRemaining = PAUSE_BUDGET_DAYS - effectiveDaysUsed

    if (retroactiveDays > budgetRemaining) {
      throw new ApiError(
        409,
        `Insufficient pause budget: need ${retroactiveDays} days to cover missed days, have ${budgetRemaining} remaining`,
      )
    }

    this.creditsRepo.setPauseActive(pauseStartDate)

    return this.getStreak(today).pause
  }

  /**
   * Deactivates pause mode, advances the streak by the pause duration, and
   * awards any streak milestones (week or monthly) that were crossed during
   * the pause window.
   *
   * @param today - Current date as YYYY-MM-DD (UTC). Injected for testability.
   * @returns Credits awarded and milestone labels for any milestones reached.
   * @throws {ApiError} 400 if the game is not currently paused.
   */
  resumePause(today: string): ResumeResult {
    const pauseState = this.creditsRepo.getPauseState()

    if (!pauseState.active || pauseState.startDate === null) {
      throw new ApiError(400, 'Game is not paused')
    }

    const pauseStartDate = pauseState.startDate

    // Number of days the pause covered (today is the first practice day again, not counted).
    const totalPauseDays = Math.max(0, diffDays(pauseStartDate, today))

    // Advance streak
    const oldStreakCount = this.creditsRepo.getStreakCount()
    const newStreakCount = oldStreakCount + totalPauseDays

    // Set lastSessionDate to yesterday so the next completed session increments correctly.
    const newLastSessionDate = subtractDays(today, 1)

    let creditsAwarded = 0
    const milestoneLabels: string[] = []

    // Award week milestones crossed during the pause.
    let weeksAwarded = this.creditsRepo.getStreakWeeksAwarded()

    if (weeksAwarded < 1 && newStreakCount >= 7) {
      this.creditsRepo.addBalance(10)
      creditsAwarded += 10
      milestoneLabels.push('Week 1')
      weeksAwarded = 1
      this.creditsRepo.setStreakWeeksAwarded(1)
    }

    if (weeksAwarded < 2 && newStreakCount >= 14) {
      this.creditsRepo.addBalance(20)
      creditsAwarded += 20
      milestoneLabels.push('2 Weeks')
      weeksAwarded = 2
      this.creditsRepo.setStreakWeeksAwarded(2)
    }

    // Award monthly milestones whose date fell within the pause window [pauseStartDate, today).
    const streakStartDate = this.creditsRepo.getStreakStartDate()
    let monthsAwarded = this.creditsRepo.getStreakMonthsAwarded()

    if (streakStartDate !== null) {
      let nextMonthCount = monthsAwarded + 1
      let milestoneDate = getMonthMilestoneDate(streakStartDate, nextMonthCount)

      while (milestoneDate >= pauseStartDate && milestoneDate < today) {
        const mc = getMilestoneMonthCredits(nextMonthCount)

        this.creditsRepo.addBalance(mc)
        creditsAwarded += mc
        milestoneLabels.push(getMilestoneMonthLabel(nextMonthCount))
        monthsAwarded = nextMonthCount
        this.creditsRepo.setStreakMonthsAwarded(monthsAwarded)

        nextMonthCount++
        milestoneDate = getMonthMilestoneDate(streakStartDate, nextMonthCount)
      }
    }

    // Update streak count and last session date (count > 1, so milestones are preserved).
    this.creditsRepo.updateStreak(newStreakCount, newLastSessionDate)

    // Consume budget and clear pause state.
    const todayYear = parseInt(today.slice(0, 4), 10)
    const effectiveDaysUsed = pauseState.budgetYear === todayYear ? pauseState.daysUsed : 0
    const newDaysUsed = effectiveDaysUsed + totalPauseDays

    this.creditsRepo.setPauseInactive(newDaysUsed, todayYear)

    return { creditsAwarded, milestoneLabels }
  }
}
