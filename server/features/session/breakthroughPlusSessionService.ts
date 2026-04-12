/**
 * Business logic for Breakthrough++ session scheduling and availability.
 *
 * A Breakthrough++ session fires automatically (at most once per day) when:
 * - At least BREAKTHROUGH_PLUS_MIN_WORDS due words exist in buckets 4+
 * - The next due date is today or in the past
 *
 * The first time qualifying words reach BREAKTHROUGH_PLUS_MIN_WORDS and no
 * session has been scheduled, `scheduleFirst` is called to make it immediately
 * eligible. After each session completes, the next one is scheduled for the
 * following day.
 *
 * @example
 * ```ts
 * const service = new BreakthroughPlusSessionService(creditsRepo)
 * const available = service.isAvailable('2026-04-12')
 * if (available) {
 *   // create breakthrough_plus session ...
 *   service.scheduleNext('2026-04-12')
 * }
 * ```
 */
import type { CreditsRepository } from '../credits/CreditsRepository.ts'

/** Minimum due words in buckets 4+ required to schedule and run a Breakthrough++ session. */
export const BREAKTHROUGH_PLUS_MIN_WORDS = 30

/** Number of words per Breakthrough++ chapter (= one session). */
export const BREAKTHROUGH_PLUS_CHAPTER_SIZE = 24

/** Interval in days between Breakthrough++ sessions (maximum once per day). */
export const BREAKTHROUGH_PLUS_INTERVAL_DAYS = 1

/** Adds `n` UTC days to a `YYYY-MM-DD` date string. */
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)

  d.setUTCDate(d.getUTCDate() + n)

  return d.toISOString().slice(0, 10)
}

export class BreakthroughPlusSessionService {
  constructor(private readonly creditsRepo: CreditsRepository) {}

  /**
   * Returns `true` when a Breakthrough++ session is due.
   *
   * Word count eligibility is delegated to `selectBreakthroughPlusWords` (which
   * returns `null` when fewer than `BREAKTHROUGH_PLUS_MIN_WORDS` qualify) — so
   * this method only checks whether the scheduled due date has been reached.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   */
  isAvailable(today: string): boolean {
    const dueAt = this.creditsRepo.getBreakthroughPlusSessionDueAt()

    if (dueAt === null) {
      return false
    }

    return today >= dueAt
  }

  /**
   * Makes the first Breakthrough++ session immediately eligible by setting the
   * due date to today. Only takes effect when no due date is set yet.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   */
  scheduleFirst(today: string): void {
    if (this.creditsRepo.getBreakthroughPlusSessionDueAt() !== null) {
      return
    }

    this.creditsRepo.setBreakthroughPlusSessionDueAt(today)
  }

  /**
   * Schedules the next Breakthrough++ session for the following day.
   * Called immediately after a Breakthrough++ session completes.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   */
  scheduleNext(today: string): void {
    this.creditsRepo.setBreakthroughPlusSessionDueAt(addDays(today, BREAKTHROUGH_PLUS_INTERVAL_DAYS))
  }
}
