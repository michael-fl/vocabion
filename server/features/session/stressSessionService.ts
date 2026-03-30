/**
 * Business logic for stress session scheduling and availability.
 *
 * A stress session fires automatically (at most once per ~6 days) when:
 * - At least STRESS_MIN_WORDS (10) words exist in buckets 2+
 * - The next due date is today or in the past
 *
 * No credit balance is required to trigger a stress session. The fee mode
 * (high-stakes vs. standard) is determined once at session creation based on
 * the balance at that moment:
 * - balance >= STRESS_HIGH_STAKES_THRESHOLD (500): fee = floor(500 / sessionSize)
 * - balance < STRESS_HIGH_STAKES_THRESHOLD: fee = 1 credit per wrong answer
 *
 * The first time qualifying words reach STRESS_MIN_WORDS and no session has
 * been scheduled, `scheduleFirst` is called to set the due date within 48 hours.
 *
 * @example
 * ```ts
 * const service = new StressSessionService(creditsRepo)
 * const available = service.isAvailable('2026-03-22', 10)
 * if (available) {
 *   // create stress session ...
 *   service.scheduleNext('2026-03-22')
 * }
 * ```
 */
import type { CreditsRepository } from '../credits/CreditsRepository.ts'
import { MIN_SESSION_SIZE } from './sessionConstants.ts'

/** Minimum number of qualifying words (bucket >= 2) required to trigger a stress session. */
export const STRESS_MIN_WORDS = MIN_SESSION_SIZE

/** Maximum number of words in a stress session. */
export const STRESS_SESSION_SIZE = 24

/** Days between stress sessions (base interval). */
export const STRESS_INTERVAL_DAYS = 6

/** Maximum random extra hours added to the scheduling interval. */
export const STRESS_RANDOM_HOURS = 48

/**
 * Credit balance at session start that activates high-stakes fee mode.
 * Below this threshold the standard fee (−1 per wrong answer) applies instead.
 */
export const STRESS_HIGH_STAKES_THRESHOLD = 500

/** Calculates the per-answer credit fee for high-stakes mode: floor(500 / sessionSize) rounded down to nearest even. */
export function calcStressFee(sessionSize: number): number {
  const raw = Math.floor(STRESS_HIGH_STAKES_THRESHOLD / sessionSize)

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
   * @param qualifyingWordCount - Number of words currently in buckets >= 2.
   */
  isAvailable(today: string, qualifyingWordCount: number): boolean {
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
   * Schedules the first stress session within 48 hours of the qualifying word
   * count first reaching STRESS_MIN_WORDS. Only takes effect when no due date
   * is set yet.
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
   * Schedules the next stress session for 6 days + up to 48 random hours from today.
   * Called immediately after a stress session completes.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   */
  scheduleNext(today: string): void {
    const base = addDays(today, STRESS_INTERVAL_DAYS)

    this.creditsRepo.setStressSessionDueAt(addRandomHours(base, STRESS_RANDOM_HOURS))
  }
}
