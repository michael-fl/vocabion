/**
 * Generates external dictionary links for German–English word lookups.
 *
 * Currently points to dict.leo.org, which accepts both German and English
 * search terms on the same URL pattern.
 *
 * @example
 * ```ts
 * dictUrl('Haus')  // 'https://dict.leo.org/englisch-deutsch/Haus'
 * dictUrl('house') // 'https://dict.leo.org/englisch-deutsch/house'
 * ```
 */

const BASE = 'https://dict.leo.org/englisch-deutsch'

/**
 * Returns the dictionary URL for a given word (German or English).
 *
 * @param word - The word to look up.
 * @returns Full URL string pointing to the dictionary entry.
 */
export function dictUrl(word: string): string {
  return `${BASE}/${encodeURIComponent(word)}`
}
