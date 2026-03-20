/**
 * Pure functions for validating user answers against vocabulary translations.
 *
 * All validation runs server-side. Logic is kept in pure functions so it can be
 * tested without any service or repository dependencies.
 *
 * @example
 * ```ts
 * import { checkAnswer } from './answerValidation.ts'
 *
 * const correct = checkAnswer(entry, 'DE_TO_EN', ['table'])
 * ```
 */
import leven from 'leven'

import type { VocabEntry } from '../../../shared/types/VocabEntry.ts'
import type { SessionDirection } from '../../../shared/types/Session.ts'
import { normalizeAnswer, deduplicateTranslations } from '../../../shared/utils/translationUtils.ts'

export { normalizeAnswer } from '../../../shared/utils/translationUtils.ts'

/**
 * Collapses all spaces and hyphens out of a normalised string.
 * Used to detect answers where the user omitted or merged word separators
 * (e.g. "softdrink" for "soft drink", "wellknown" for "well-known").
 */
export function normalizeCollapsed(s: string): string {
  return s.toLowerCase().replace(/[-\s]/g, '')
}

/** A single typo correction: what the user typed vs. the accepted correct form. */
export interface TypoMatch {
  typed: string
  correct: string
}

/** Detailed result of an answer check. */
export interface AnswerCheckResult {
  /** True when `matchedCount >= requiredCount`. */
  correct: boolean
  /** Number of user answers that matched a distinct translation (exact or typo). */
  matchedCount: number
  /** Number of correct answers required (1 or 2). */
  requiredCount: number
  /**
   * Typo matches found during this check. Populated when at least one answer was accepted
   * via Levenshtein distance (≤ 15 % of max word length) rather than an exact match.
   */
  typos: TypoMatch[]
}

/**
 * Checks the user's answers against the vocabulary entry and returns a
 * detailed result including the match count.
 *
 * Rules:
 * - If the entry has 1 translation: 1 matching answer is required.
 * - If the entry has ≥ 2 translations: 2 distinct matching answers are required.
 *
 * Comparison is case-insensitive and hyphen/space-normalised.
 * Each correct translation can only be matched once.
 *
 * @param entry - The vocabulary entry being tested.
 * @param direction - The session direction (`DE_TO_EN` or `EN_TO_DE`).
 * @param answers - The user's submitted answers (one or more strings).
 */
export function checkAnswerDetailed(
  entry: VocabEntry,
  direction: SessionDirection,
  answers: string[],
): AnswerCheckResult {
  const translations = deduplicateTranslations(direction === 'DE_TO_EN' ? entry.en : entry.de)
  const requiredCount = Math.min(translations.length, 2)

  let matchedCount = 0
  const matchedIndices = new Set<number>()
  const typos: TypoMatch[] = []

  for (const answer of answers) {
    const norm = normalizeAnswer(answer)

    // Phase 1: exact match (case-insensitive, hyphen/space-normalised)
    let matched = false

    for (let i = 0; i < translations.length; i++) {
      if (!matchedIndices.has(i) && normalizeAnswer(translations[i]) === norm) {
        matchedIndices.add(i)
        matchedCount++
        matched = true
        break
      }
    }

    if (matched) {
      continue
    }

    // Phase 1.5: collapsed match — spaces and hyphens stripped from both sides
    // Catches "softdrink" → "soft drink" and "wellknown" → "well-known"
    const collapsedAnswer = normalizeCollapsed(answer)

    for (let i = 0; i < translations.length; i++) {
      if (!matchedIndices.has(i) && normalizeCollapsed(translations[i]) === collapsedAnswer) {
        matchedIndices.add(i)
        matchedCount++
        typos.push({ typed: answer, correct: translations[i] })
        matched = true
        break
      }
    }

    if (matched) {
      continue
    }

    // Phase 2: typo match — Levenshtein distance ≤ 15 % of the longer string
    for (let i = 0; i < translations.length; i++) {
      if (matchedIndices.has(i)) {
        continue
      }

      const normTranslation = normalizeAnswer(translations[i])
      const distance = leven(norm, normTranslation)
      const maxLen = Math.max(norm.length, normTranslation.length)
      const isTypo = maxLen < 8 ? distance === 1 : distance / maxLen <= 0.15

      if (isTypo) {
        matchedIndices.add(i)
        matchedCount++
        typos.push({ typed: answer, correct: translations[i] })
        break
      }
    }
  }

  return { correct: matchedCount >= requiredCount, matchedCount, requiredCount, typos }
}

/**
 * Returns `true` if the user's answers satisfy the translation requirements.
 * Delegates to `checkAnswerDetailed`; use that function when you need match counts.
 *
 * @param entry - The vocabulary entry being tested.
 * @param direction - The session direction (`DE_TO_EN` or `EN_TO_DE`).
 * @param answers - The user's submitted answers (one or more strings).
 */
export function checkAnswer(
  entry: VocabEntry,
  direction: SessionDirection,
  answers: string[],
): boolean {
  return checkAnswerDetailed(entry, direction, answers).correct
}
