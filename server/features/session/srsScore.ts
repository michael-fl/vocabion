/**
 * Pure utility for computing a vocabulary entry's priority score.
 *
 * The score controls how urgently a word is shown in session word selection:
 * within any candidate bucket, words are sorted by score descending (ties
 * shuffled randomly) before the required number of words is drawn.
 *
 * Formula:
 * ```
 * score = recentErrorCount + (marked ? 2 : 0) + max(maxBucket − bucket − 2, 0)
 * ```
 * - `recentErrorCount` — wrong answers in the last 10 sessions where this word appeared
 * - `marked` — +2 when the user has starred the word (ensures score ≥ 2, qualifying for focus sessions)
 * - fall-from-peak — how far the word fell from its highest bucket, with a grace of 2
 *
 * @example
 * ```ts
 * const score = computeScore(entry, 3) // entry answered wrong 3 of last 10 times
 * ```
 */
import type { VocabEntry } from '../../../shared/types/VocabEntry.ts'

/**
 * Computes the priority score for a vocabulary entry.
 *
 * @param entry - The vocabulary entry to score.
 * @param recentErrorCount - Number of erroneous answers in the last 10 sessions
 *   where this word appeared.
 * @returns Non-negative integer score.
 */
export function computeScore(entry: VocabEntry, recentErrorCount: number): number {
  const markedBonus = entry.marked ? 2 : 0
  const fallFromPeak = Math.max(entry.maxBucket - entry.bucket - 2, 0)

  return recentErrorCount + markedBonus + fallFromPeak
}
