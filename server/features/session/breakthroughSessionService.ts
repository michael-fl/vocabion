/**
 * Business logic for breakthrough session scheduling and availability.
 *
 * A breakthrough session fires automatically (roughly once per week) when:
 * - At least BREAKTHROUGH_MIN_WORDS qualifying words exist across the three
 *   word pool categories (bucket 3, due bucket-5, due words in highest bucket)
 * - The next due date is today or in the past
 *
 * The first time qualifying words reach BREAKTHROUGH_MIN_WORDS and no session
 * has been scheduled, `scheduleFirst` is called to fire within 48 hours.
 * After each session completes, the next one is scheduled for 6 days +
 * up to 48 random hours (≈ once per week, ±1 day jitter).
 *
 * @example
 * ```ts
 * const service = new BreakthroughSessionService(creditsRepo)
 * const available = service.isAvailable('2026-03-24')
 * if (available) {
 *   // create breakthrough session ...
 *   service.scheduleNext('2026-03-24')
 * }
 * ```
 */
import type { CreditsRepository } from '../credits/CreditsRepository.ts'

/** Minimum qualifying words required to schedule and run a breakthrough session. */
export const BREAKTHROUGH_MIN_WORDS = 5

/** Maximum number of words in a breakthrough session. */
export const BREAKTHROUGH_SESSION_SIZE = 24

/** Base interval in days between breakthrough sessions. */
export const BREAKTHROUGH_INTERVAL_DAYS = 6

/** Maximum random extra hours added to the scheduling interval (0–48 h → 6–8 days total). */
export const BREAKTHROUGH_RANDOM_HOURS = 48

/** Adds `n` UTC days to a `YYYY-MM-DD` date string. */
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)

  d.setUTCDate(d.getUTCDate() + n)

  return d.toISOString().slice(0, 10)
}

/** Adds random hours (0 to maxHours) to a `YYYY-MM-DD` date string, returning a new `YYYY-MM-DD`. */
function addRandomHours(dateStr: string, maxHours: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const extraMs = Math.random() * maxHours * 60 * 60 * 1000

  return new Date(d.getTime() + extraMs).toISOString().slice(0, 10)
}

export class BreakthroughSessionService {
  constructor(private readonly creditsRepo: CreditsRepository) {}

  /**
   * Returns `true` when a breakthrough session is due.
   *
   * Word count eligibility is delegated to `selectBreakthroughWords` (which
   * returns `null` when fewer than `BREAKTHROUGH_MIN_WORDS` qualify) — so this
   * method only checks whether the scheduled due date has been reached.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   */
  isAvailable(today: string): boolean {
    const dueAt = this.creditsRepo.getBreakthroughSessionDueAt()

    if (dueAt === null) {
      return false
    }

    return today >= dueAt
  }

  /**
   * Schedules the first breakthrough session within 48 hours of qualifying
   * words first reaching `BREAKTHROUGH_MIN_WORDS`. Only takes effect when no
   * due date is set yet.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   */
  scheduleFirst(today: string): void {
    if (this.creditsRepo.getBreakthroughSessionDueAt() !== null) {
      return
    }

    this.creditsRepo.setBreakthroughSessionDueAt(addRandomHours(today, BREAKTHROUGH_RANDOM_HOURS))
  }

  /**
   * Schedules the next breakthrough session for 6 days + up to 48 random
   * hours from today (resulting in a 6–8 day window, roughly ±1 day around
   * 7 days). Called immediately after a breakthrough session completes.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   */
  scheduleNext(today: string): void {
    const base = addDays(today, BREAKTHROUGH_INTERVAL_DAYS)

    this.creditsRepo.setBreakthroughSessionDueAt(addRandomHours(base, BREAKTHROUGH_RANDOM_HOURS))
  }
}
