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
export type SessionDirection = 'DE_TO_EN' | 'EN_TO_DE'

/** The type of a training session. */
export type SessionType = 'normal' | 'repetition' | 'focus' | 'discovery' | 'starred'

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
   * - `repetition` — review session drawn exclusively from due time-based buckets (4+).
   * - `focus` — targets the highest-priority words across all non-zero buckets.
   * - `discovery` — introduces new words exclusively from bucket 0; triggered when
   *   the active pool (buckets 1–4) falls below a threshold.
   * - `starred` — reviews all words the user has starred (marked with ★), up to 100;
   *   limited to once per day and started explicitly by the user.
   */
  type: SessionType

  /** Ordered list of words selected for this session. Stored as JSON in SQLite. */
  words: SessionWord[]

  status: 'open' | 'completed'

  /** ISO 8601 creation timestamp. */
  createdAt: string
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
  const { id, direction, type, words, status, createdAt } = v

  if (typeof id !== 'string') {
    return false
  }

  if (direction !== 'DE_TO_EN' && direction !== 'EN_TO_DE') {
    return false
  }

  if (type !== 'normal' && type !== 'repetition' && type !== 'focus' && type !== 'discovery' && type !== 'starred') {
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

  return true
}
