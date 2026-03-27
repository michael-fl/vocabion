/**
 * Business logic for veteran session scheduling and availability.
 *
 * A veteran session fires automatically (roughly once per week) when:
 * - At least VETERAN_MIN_BUCKET6_WORDS (50) words exist in buckets 6+
 * - The next due date is today or in the past
 *
 * The first time the bucket-6+ count reaches 50 and no session has been
 * scheduled, `scheduleFirst` is called to fire within 48 hours.
 *
 * Word selection targets historically difficult words (difficulty-sorted)
 * from buckets 6+ — words the user has mastered but which were once hard.
 *
 * @example
 * ```ts
 * const service = new VeteranSessionService(creditsRepo)
 * const available = service.isAvailable('2026-03-22', 55)
 * if (available) {
 *   // create veteran session ...
 *   service.scheduleNext('2026-03-22')
 * }
 * ```
 */
import type { CreditsRepository } from '../credits/CreditsRepository.ts'

/** Minimum words in buckets 6+ required to trigger a veteran session. */
export const VETERAN_MIN_BUCKET6_WORDS = 50

/** Minimum qualifying words required to run the session (must be ≥ 10). */
export const VETERAN_MIN_WORDS = 10

/** Base interval in days between veteran sessions. */
export const VETERAN_INTERVAL_DAYS = 6

/** Maximum random extra hours added to the scheduling interval (0–48 h → 6–8 days total). */
export const VETERAN_RANDOM_HOURS = 48

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

export class VeteranSessionService {
  constructor(private readonly creditsRepo: CreditsRepository) {}

  /**
   * Returns `true` when all trigger conditions for a veteran session are met.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   * @param bucket6PlusCount - Number of words currently in buckets >= 6.
   */
  isAvailable(today: string, bucket6PlusCount: number): boolean {
    if (bucket6PlusCount < VETERAN_MIN_BUCKET6_WORDS) {
      return false
    }

    const dueAt = this.creditsRepo.getVeteranSessionDueAt()

    if (dueAt === null) {
      return false
    }

    return today >= dueAt
  }

  /**
   * Schedules the first veteran session within 48 hours of the bucket-6+ count
   * first reaching >= VETERAN_MIN_BUCKET6_WORDS. Only takes effect when no due
   * date is set yet.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   */
  scheduleFirst(today: string): void {
    if (this.creditsRepo.getVeteranSessionDueAt() !== null) {
      return
    }

    this.creditsRepo.setVeteranSessionDueAt(addRandomHours(today, VETERAN_RANDOM_HOURS))
  }

  /**
   * Schedules the next veteran session for 6 days + up to 48 random hours from
   * today (resulting in a 6–8 day window, roughly ±1 day around 7 days).
   * Called immediately after a veteran session completes.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   */
  scheduleNext(today: string): void {
    const base = addDays(today, VETERAN_INTERVAL_DAYS)

    this.creditsRepo.setVeteranSessionDueAt(addRandomHours(base, VETERAN_RANDOM_HOURS))
  }
}
