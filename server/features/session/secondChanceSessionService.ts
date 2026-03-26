/**
 * Business logic for second chance session scheduling and availability.
 *
 * When a time-based word passes its in-session second-chance flow (W2 answered
 * correctly), W1 is placed in the "second chance bucket" (bucket 1.5) instead
 * of being demoted by one bucket. A `secondChanceDueAt` timestamp is stored on
 * the word: `max(next calendar day 00:00 UTC, now + 12 h)`.
 *
 * A second chance session resolves these words:
 * - Highest priority — checked before the regular rotation.
 * - Available when ≥ 1 word is due AND the daily limit has not been reached.
 * - At most one per calendar day; after completion the next is earliest the
 *   following calendar day.
 *
 * @example
 * ```ts
 * const service = new SecondChanceSessionService(creditsRepo)
 * const dueAt = service.calcDueAt(new Date())
 * // store dueAt on the vocab entry, then:
 * if (service.isAvailable('2026-03-25')) {
 *   // create second_chance_session
 *   service.scheduleCompletion('2026-03-25')
 * }
 * ```
 */
import type { CreditsRepository } from '../credits/CreditsRepository.ts'

/** Maximum number of words in a second chance session. */
export const SECOND_CHANCE_SESSION_SIZE = 24

export class SecondChanceSessionService {
  constructor(private readonly creditsRepo: CreditsRepository) {}

  /**
   * Computes the earliest due timestamp for a word entering bucket 1.5.
   *
   * Formula: `max(next calendar day 00:00 UTC, now + 12 h)`.
   *
   * Examples:
   * - 11:00 UTC → tomorrow 00:00 (11h later) vs 23:00 UTC (now+12h) → 23:00 wins
   * - 23:00 UTC → tomorrow 00:00 (1h later) vs 11:00 next day (now+12h) → 11:00 wins
   *
   * @param now - Current date/time.
   * @returns ISO 8601 timestamp string.
   */
  calcDueAt(now: Date): string {
    const tomorrow = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    ))

    const plus12h = new Date(now.getTime() + 12 * 60 * 60 * 1000)

    return new Date(Math.max(tomorrow.getTime(), plus12h.getTime())).toISOString()
  }

  /**
   * Returns `true` when a second chance session may be created today.
   *
   * A session is available when no second chance session has been played on
   * `today` yet. Word-count eligibility (≥ 1 due word) is delegated to
   * `selectSecondChanceSessionWords` — this method only checks the daily limit.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   */
  isAvailable(today: string): boolean {
    const last = this.creditsRepo.getLastSecondChanceSessionDate()

    return last !== today
  }

  /**
   * Records that a second chance session was completed today.
   * Prevents further second chance sessions for the rest of the calendar day.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   */
  scheduleCompletion(today: string): void {
    this.creditsRepo.setLastSecondChanceSessionDate(today)
  }
}
