/**
 * Shared domain types for training sessions.
 *
 * Used by both frontend (src/) and backend (server/).
 * Neither side defines its own copy of these types.
 *
 * @example
 * ```ts
 * import type { Session, SessionDirection } from '../../shared/types/Session.ts'
 * ```
 */

import type { SessionWord } from './VocabEntry.ts'
import { isSessionWord } from './VocabEntry.ts'

export type { SessionWord }

/** The translation direction for a session. */
export type SessionDirection = 'SOURCE_TO_TARGET' | 'TARGET_TO_SOURCE'

/** The type of a training session. */
export type SessionType = 'normal' | 'repetition' | 'focus' | 'focus_quiz' | 'discovery' | 'starred' | 'stress' | 'veteran' | 'breakthrough' | 'breakthrough_plus' | 'second_chance_session' | 'recovery'

/**
 * A training session. At most one session can be open at a time.
 */
export interface Session {
  /** UUID */
  id: string

  /** Translation direction. Cannot be changed while a session is open. */
  direction: SessionDirection

  /**
   * Session type.
   * - `normal` — frequency-based learning session (buckets 0–3 plus due time-based words).
   * - `repetition` — **deprecated/legacy** — no longer created; kept in the union so old session
   *   records stored in the database remain parseable.
   * - `focus` — targets the highest-priority words across all non-zero buckets.
   * - `focus_quiz` — multiple-choice variant of focus: same word selection but the user
   *   picks the correct translation(s) from 10 clickable options instead of typing.
   *   Direction is always source → target. Part of the automatic rotation.
   * - `discovery` — introduces new words exclusively from bucket 0; triggered when
   *   the active pool (buckets 1–4) falls below a threshold.
   * - `starred` — reviews all words the user has starred (marked with ★), up to 100;
   *   limited to once per day and started explicitly by the user.
   * - `stress` — high-stakes timed challenge drawn from buckets 2+; fires automatically
   *   at most once per week when the credit balance reaches ≥ 500.
   * - `veteran` — difficulty-sorted review of words in buckets 6+ (historically hard,
   *   now mastered); fires automatically roughly once per week when ≥ 50 words exist
   *   in bucket 6+.
   * - `second_chance_session` — resolves words in the second chance bucket (bucket 1.5).
   *   Fires with highest priority when ≥ 1 bucket-1.5 word is due and the daily limit
   *   has not been reached. Words answered correctly are restored to their original bucket;
   *   wrong or partial answers demote to bucket 1. No hints available.
   * - `recovery` — targets words that once reached veteran territory (maxBucket ≥ 6) but
   *   have since regressed by at least 2 bucket levels (maxBucket − bucket ≥ 2). Part of
   *   the automatic shuffle rotation; fires whenever ≥ 5 qualifying words exist.
   * - `breakthrough_plus` — intensive backlog cleanup of overdue time-based words (buckets
   *   4+), sorted highest bucket first. Fires at most once per day when ≥ 30 due words
   *   exist. Part of the automatic shuffle rotation.
   */
  type: SessionType

  /** Ordered list of words selected for this session. Stored as JSON in SQLite. */
  words: SessionWord[]

  status: 'open' | 'completed'

  /** ISO 8601 creation timestamp. */
  createdAt: string

  /**
   * ISO 8601 timestamp of when the first answer was submitted in this session.
   * `null` until the first answer is given. Used to attribute the streak day to
   * when the user started practising, so a session started yesterday and
   * completed today still counts toward yesterday's streak.
   */
  firstAnsweredAt: string | null

  /**
   * Only present for `stress` sessions. Indicates whether the high-stakes fee
   * mode was active at session creation (balance >= 500). Determines the
   * per-wrong-answer fee for the entire session:
   * - `true`  → fee = floor(500 / sessionSize), rounded down to nearest even
   * - `false` → fee = 1 credit per wrong answer (standard mode)
   * - `undefined` → not a stress session
   */
  stressHighStakes?: boolean
}

/**
 * Runtime type guard for Session.
 * Returns true if value conforms to the Session shape.
 * Useful for validating untrusted data such as imported JSON.
 *
 * @example
 * ```ts
 * const raw: unknown = JSON.parse(input)
 * if (isSession(raw)) {
 *   console.log(raw.direction)
 * }
 * ```
 */
export function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const v = value as Record<string, unknown>
  const { id, direction, type, words, status, createdAt, firstAnsweredAt } = v

  if (typeof id !== 'string') {
    return false
  }

  if (direction !== 'SOURCE_TO_TARGET' && direction !== 'TARGET_TO_SOURCE') {
    return false
  }

  if (type !== 'normal' && type !== 'repetition' && type !== 'focus' && type !== 'focus_quiz' && type !== 'discovery' && type !== 'starred' && type !== 'stress' && type !== 'veteran' && type !== 'breakthrough' && type !== 'breakthrough_plus' && type !== 'second_chance_session' && type !== 'recovery') {
    return false
  }

  if (!Array.isArray(words) || !words.every((w) => isSessionWord(w))) {
    return false
  }

  if (status !== 'open' && status !== 'completed') {
    return false
  }

  if (typeof createdAt !== 'string') {
    return false
  }

  if (firstAnsweredAt !== null && typeof firstAnsweredAt !== 'string') {
    return false
  }

  return true
}
