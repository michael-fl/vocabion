/**
 * Business logic for breakthrough session scheduling and availability.
 *
 * A breakthrough session fires automatically (at most once per day) when:
 * - At least BREAKTHROUGH_MIN_WORDS qualifying words exist across the three
 *   word pool categories (bucket 3, due bucket-5, due words in highest bucket)
 * - The next due date is today or in the past
 *
 * The first time qualifying words reach BREAKTHROUGH_MIN_WORDS and no session
 * has been scheduled, `scheduleFirst` is called to make it immediately eligible.
 * After each session completes, the next one is scheduled for the following day.
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
import { MIN_SESSION_SIZE } from './sessionConstants.ts'

/** Minimum qualifying words required to schedule and run a breakthrough session. */
export const BREAKTHROUGH_MIN_WORDS = MIN_SESSION_SIZE

/** Maximum number of words in a breakthrough session. */
export const BREAKTHROUGH_SESSION_SIZE = 24

/** Interval in days between breakthrough sessions (maximum once per day). */
export const BREAKTHROUGH_INTERVAL_DAYS = 1

/** Adds `n` UTC days to a `YYYY-MM-DD` date string. */
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)

  d.setUTCDate(d.getUTCDate() + n)

  return d.toISOString().slice(0, 10)
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
   * Makes the first breakthrough session immediately eligible by setting the
   * due date to today. Only takes effect when no due date is set yet.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   */
  scheduleFirst(today: string): void {
    if (this.creditsRepo.getBreakthroughSessionDueAt() !== null) {
      return
    }

    this.creditsRepo.setBreakthroughSessionDueAt(today)
  }

  /**
   * Schedules the next breakthrough session for the following day.
   * Called immediately after a breakthrough session completes.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   */
  scheduleNext(today: string): void {
    this.creditsRepo.setBreakthroughSessionDueAt(addDays(today, BREAKTHROUGH_INTERVAL_DAYS))
  }
}
