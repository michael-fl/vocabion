/**
 * Business logic for stress session scheduling and availability.
 *
 * A stress session fires automatically (at most once per week) when:
 * - The credit balance is >= STRESS_MIN_CREDITS (500)
 * - At least STRESS_MIN_WORDS (5) words exist in buckets 2+
 * - The next due date is today or in the past
 *
 * The first time the balance reaches >= 500 and no session has been scheduled,
 * `scheduleFirst` is called to set the due date within 48 hours.
 *
 * @example
 * ```ts
 * const service = new StressSessionService(creditsRepo)
 * const available = service.isAvailable('2026-03-22', 600, 10)
 * if (available) {
 *   // create stress session ...
 *   service.scheduleNext('2026-03-22')
 * }
 * ```
 */
import type { CreditsRepository } from '../credits/CreditsRepository.ts'

/** Minimum credit balance required to trigger a stress session. */
export const STRESS_MIN_CREDITS = 500

/** Minimum number of qualifying words (bucket >= 2) required. */
export const STRESS_MIN_WORDS = 5

/** Maximum number of words in a stress session. */
export const STRESS_SESSION_SIZE = 24

/** Days between stress sessions (base interval). */
export const STRESS_INTERVAL_DAYS = 7

/** Maximum random extra hours added to the scheduling interval. */
export const STRESS_RANDOM_HOURS = 48

/** Calculates the per-answer credit fee: floor(500 / sessionSize) rounded down to nearest even. */
export function calcStressFee(sessionSize: number): number {
  const raw = Math.floor(STRESS_MIN_CREDITS / sessionSize)

  return Math.floor(raw / 2) * 2
}

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

export class StressSessionService {
  constructor(private readonly creditsRepo: CreditsRepository) {}

  /**
   * Returns `true` when all trigger conditions for a stress session are met.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   * @param balance - Current credit balance.
   * @param qualifyingWordCount - Number of words currently in buckets >= 2.
   */
  isAvailable(today: string, balance: number, qualifyingWordCount: number): boolean {
    if (balance < STRESS_MIN_CREDITS) {
      return false
    }

    if (qualifyingWordCount < STRESS_MIN_WORDS) {
      return false
    }

    const dueAt = this.creditsRepo.getStressSessionDueAt()

    if (dueAt === null) {
      // Has never been scheduled — schedule first occurrence now and report not available yet
      return false
    }

    return today >= dueAt
  }

  /**
   * Schedules the first stress session within 48 hours of the balance first
   * reaching >= STRESS_MIN_CREDITS. Only takes effect when no due date is set yet.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   */
  scheduleFirst(today: string): void {
    if (this.creditsRepo.getStressSessionDueAt() !== null) {
      return
    }

    this.creditsRepo.setStressSessionDueAt(addRandomHours(today, STRESS_RANDOM_HOURS))
  }

  /**
   * Schedules the next stress session for 7 days + up to 48 random hours from today.
   * Called immediately after a stress session completes.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   */
  scheduleNext(today: string): void {
    const base = addDays(today, STRESS_INTERVAL_DAYS)

    this.creditsRepo.setStressSessionDueAt(addRandomHours(base, STRESS_RANDOM_HOURS))
  }
}
