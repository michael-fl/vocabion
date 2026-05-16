/**
 * Utility for generating answer hints during vocabulary training.
 *
 * Each space-separated word is partially revealed based on its length,
 * with the remaining characters replaced by dots.
 *
 * @example
 * ```ts
 * generateHint('to have lunch') // → 't. ha.. lu...'
 * generateHint('car')           // → 'c..'
 * ```
 */

/**
 * Returns the number of significant characters in a string —
 * its length after stripping all spaces and hyphens.
 * Used to compute and display the character count alongside hint placeholders.
 *
 * @example
 * countSignificantChars('soft drink') // → 9
 * countSignificantChars('well-known') // → 9
 */
export function countSignificantChars(s: string): number {
  return s.replace(/[-\s]/g, '').length
}

/**
 * Returns the credit cost of a hint for a word at the given SRS bucket.
 *
 * - Bucket 0: 1 credit (likely a new word — UI disables the paid button)
 * - Buckets 1–3: 10 credits (flat rate)
 * - Bucket n ≥ 4: 10 × (n − 2) credits — scales without cap so a hint on a
 *   well-mastered word costs proportionally more (bucket 4 → 20, bucket 6 → 40,
 *   bucket 10 → 80, bucket 14 → 120, …).
 *
 * @example
 * getHintCost(0)  // → 1
 * getHintCost(3)  // → 10
 * getHintCost(4)  // → 20
 * getHintCost(6)  // → 40
 * getHintCost(14) // → 120
 */
export function getHintCost(bucket: number): number {
  if (bucket === 0) { return 1 }
  return bucket <= 3 ? 10 : 10 * (bucket - 2)
}

/**
 * Generates a hint for the given answer string.
 *
 * Each space-separated word is partially revealed — the rest is replaced by dots.
 * `maxShown` controls the maximum number of characters revealed per word:
 * - Words shorter than 4 characters always show only the first character.
 * - Words with 4 or more characters show up to `maxShown` characters.
 *
 * @param answer   The target answer string.
 * @param maxShown Maximum revealed chars per word (default 2; pass 1 for a stricter hint).
 *
 * @example
 * generateHint('automobile')     // → 'au........'  (maxShown = 2)
 * generateHint('automobile', 1)  // → 'a.........'  (maxShown = 1)
 */
export function generateHint(answer: string, maxShown = 2): string {
  return answer
    .split(' ')
    .map((word) => {
      const shown = word.length < 4 ? 1 : maxShown
      return word.slice(0, shown) + '.'.repeat(word.length - shown)
    })
    .join(' ')
}
