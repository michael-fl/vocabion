/**
 * Shared domain types for vocabulary entries and session words.
 *
 * Used by both frontend (src/) and backend (server/).
 * Neither side defines its own copy of these types.
 *
 * @example
 * ```ts
 * import type { VocabEntry } from '../../shared/types/VocabEntry.ts'
 * ```
 */

/**
 * A single vocabulary entry stored in the database.
 */
export interface VocabEntry {
  /** UUID */
  id: string

  /** The source-language word (e.g. the German word). */
  source: string

  /** One or more target-language forms (e.g. English translations). */
  target: string[]

  /**
   * SRS bucket index. 0 = newest / least known.
   * Increases by 1 on a correct answer.
   * Resets to 0 on a wrong answer (with second-chance rules for buckets 4+).
   */
  bucket: number

  /**
   * Whether this word has been starred by the user as a favourite / reminder.
   * Marked words are highlighted in the vocabulary list and will later support
   * dedicated review modes.
   */
  marked: boolean

  /**
   * Set to `true` when a word is added via the UI "Add word" form.
   * Such words are always drawn before other bucket-0 words in the next session,
   * ensuring they are introduced to the user promptly.
   * Cleared automatically when the word is first included in a session.
   * Words added via JSON import are never marked as manually added.
   */
  manuallyAdded: boolean

  /**
   * Priority score used to prefer this word during session word selection.
   * Higher score means the word is shown more urgently.
   *
   * Formula: `countRecentErrors + (marked ? 1 : 0) + max(maxBucket − bucket − 2, 0)`
   * - `countRecentErrors`: wrong answers in the last 10 sessions this word appeared in
   * - `marked`: +1 if the user starred the word
   * - fall-from-peak: how far the word dropped from its highest bucket (grace of 2)
   *
   * Recomputed and stored whenever an answer is submitted or the word is starred/unstarred.
   */
  score: number

  /**
   * The highest bucket this word has ever reached.
   * Never decreases — used to award credits only once per bucket level.
   * Credits are earned when a word reaches a new highest bucket ≥ 4.
   */
  maxBucket: number

  /**
   * ISO 8601 timestamp of the last time this word was presented in a session.
   * null means the word has never appeared in a session and is always considered due.
   * Updated on every answer, correct or wrong.
   */
  lastAskedAt: string | null

  /** ISO 8601 creation timestamp. */
  createdAt: string

  /**
   * ISO 8601 timestamp of the last edit to the entry content.
   * Distinct from lastAskedAt: this changes when translations are edited,
   * not when the word is answered in a session.
   */
  updatedAt: string
}

/**
 * The status of a single word within a training session.
 */
export interface SessionWord {
  vocabId: string
  status: 'pending' | 'correct' | 'incorrect' | 'pushed_back'
  /**
   * Set when this word is the "second chance" word triggered by a wrong answer
   * on a time-based bucket (4+). Contains the vocabId of the original word that
   * was answered incorrectly.
   */
  secondChanceFor?: string
}

/**
 * Runtime type guard for VocabEntry.
 * Returns true if value conforms to the VocabEntry shape.
 * Useful for validating untrusted data such as imported JSON.
 *
 * @example
 * ```ts
 * const raw: unknown = JSON.parse(input)
 * if (isVocabEntry(raw)) {
 *   console.log(raw.source)
 * }
 * ```
 */
export function isVocabEntry(value: unknown): value is VocabEntry {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const v = value as Record<string, unknown>
  const { id, source, target, bucket, maxBucket, manuallyAdded, marked, score, lastAskedAt, createdAt, updatedAt } = v

  if (typeof id !== 'string') {
    return false
  }

  if (typeof source !== 'string' || source.length === 0) {
    return false
  }

  if (!Array.isArray(target) || !target.every((s) => typeof s === 'string')) {
    return false
  }

  if (typeof bucket !== 'number' || !Number.isInteger(bucket) || bucket < 0) {
    return false
  }

  if (typeof maxBucket !== 'number' || !Number.isInteger(maxBucket) || maxBucket < 0) {
    return false
  }

  if (typeof manuallyAdded !== 'boolean') {
    return false
  }

  if (typeof marked !== 'boolean') {
    return false
  }

  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0) {
    return false
  }

  if (lastAskedAt !== null && typeof lastAskedAt !== 'string') {
    return false
  }

  if (typeof createdAt !== 'string') {
    return false
  }

  if (typeof updatedAt !== 'string') {
    return false
  }

  return true
}

/**
 * Runtime type guard for SessionWord.
 * Returns true if value conforms to the SessionWord shape.
 */
export function isSessionWord(value: unknown): value is SessionWord {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const v = value as Record<string, unknown>
  const { vocabId, status } = v

  if (typeof vocabId !== 'string') {
    return false
  }

  if (status !== 'pending' && status !== 'correct' && status !== 'incorrect' && status !== 'pushed_back') {
    return false
  }

  return true
}
