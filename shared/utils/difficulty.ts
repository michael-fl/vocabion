/**
 * Pure utility for computing a vocabulary entry's difficulty score.
 *
 * Difficulty is a permanent, ever-increasing measure of how hard a word is —
 * both intrinsically (structure of its translations) and historically (how
 * much trouble the user has had with it). It is stored on the entry and
 * recomputed whenever any contributing factor changes.
 *
 * Formula:
 * ```
 * difficulty = spaceBonus + multipleBonus + lengthBonus + maxScore
 * ```
 * - `spaceBonus`    — +1 if any target variant contains a space after stripping a
 *                     leading "to " prefix (so "to fill up" qualifies but "to replenish" does not)
 * - `multipleBonus` — +1 if the word has more than one target alternative
 * - `lengthBonus`   — +1 if there is one target and it is ≥ 10 characters, or if
 *                     there are multiple targets and more than one is ≥ 10 characters
 * - `maxScore`      — the highest priority score the entry has ever had; words
 *                     with a troubled history (many errors, large fall-from-peak,
 *                     starred) permanently contribute that history to difficulty
 *
 * @example
 * ```ts
 * const d = computeDifficulty(entry) // e.g. 3
 * ```
 */
import type { VocabEntry } from '../types/VocabEntry.ts'

/**
 * Computes the difficulty score for a vocabulary entry.
 *
 * @param entry - The vocabulary entry, including its current `maxScore`.
 * @returns Non-negative integer difficulty score.
 */
export function computeDifficulty(entry: VocabEntry): number {
  const spaceBonus = entry.target.some((t) => {
    const stripped = t.startsWith('to ') ? t.slice(3) : t
    return stripped.includes(' ')
  }) ? 1 : 0
  const multipleBonus = entry.target.length > 1 ? 1 : 0
  const longCount = entry.target.filter((t) => t.length >= 10).length
  const lengthThreshold = entry.target.length === 1 ? 1 : 2
  const lengthBonus = longCount >= lengthThreshold ? 1 : 0

  return spaceBonus + multipleBonus + lengthBonus + entry.maxScore
}
