/**
 * Shared utilities for normalising and deduplicating translation strings.
 *
 * Used by both the server-side answer validation and the client-side
 * TrainingScreen to ensure input field count and validation logic agree.
 *
 * @example
 * ```ts
 * import { normalizeAnswer, deduplicateTranslations } from '../../shared/utils/translationUtils.ts'
 *
 * const unique = deduplicateTranslations(['sleep', 'to sleep', 'to roost'])
 * // → ['sleep', 'to roost']  (deduplicated: 'sleep' and 'to sleep' share the same normal form)
 * ```
 */

/**
 * Normalises a translation string for comparison:
 * lowercases, replaces hyphens with spaces, trims whitespace, and strips a
 * leading `"to "` prefix (infinitive marker).
 *
 * Stripping the infinitive marker lets "stand up" match "to stand up" and vice
 * versa regardless of whether the user or the database entry includes it.
 * The prefix is only stripped when it is followed by at least one more character
 * so that the standalone word `"to"` is left unchanged.
 */
export function normalizeAnswer(s: string): string {
  const base = s.toLowerCase().replace(/-/g, ' ').trim()

  return base.startsWith('to ') ? base.slice(3) : base
}

/**
 * Deduplicates a translations array by normalised form.
 *
 * Entries whose normalised form has already been seen are dropped; the first
 * occurrence is kept. This collapses pairs like `['sleep', 'to sleep']` into
 * `['sleep']` so the user only needs to provide one answer for effectively
 * identical translations.
 *
 * @param translations - Raw translation strings from a vocab entry.
 * @returns A new array containing only the first translation for each distinct
 *   normalised form, preserving the original order.
 */
export function deduplicateTranslations(translations: string[]): string[] {
  const seen = new Set<string>()

  return translations.filter((t) => {
    const key = normalizeAnswer(t)

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}
