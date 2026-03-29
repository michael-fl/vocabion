/**
 * Shared helpers for multiple-choice quiz screens (Focus Quiz, Discovery Quiz).
 *
 * Contains pure utility functions and small presentational components that are
 * reused by both `FocusQuizScreen` and `DiscoveryQuizScreen` to avoid duplication.
 *
 * @example
 * ```ts
 * import { buildOptions, fisherYates, findNextPending } from './multipleChoiceHelpers.tsx'
 * ```
 */
import type { ReactNode } from 'react'

import type { Session } from '../../shared/types/Session.ts'
import type { VocabEntry } from '../../shared/types/VocabEntry.ts'
import type { AnswerResult } from '../api/sessionApi.ts'
import { AnswerLinks } from './AnswerLinks.tsx'

// ── Exported types ─────────────────────────────────────────────────────────────

export interface CurrentWord {
  vocabId: string
  entry: VocabEntry
  isSecondChance: boolean
  /** For second-chance words: the original word (W1) whose bucket is displayed. */
  w1Entry?: VocabEntry
}

export interface StatusMessage {
  text: ReactNode
  isCorrect: boolean
}

/**
 * One clickable option in the quiz.
 * `state` is set after submission to colour correct/wrong options.
 */
export interface QuizOption {
  label: string
  state: 'idle' | 'selected' | 'correct' | 'wrong'
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns the first pending word in the session, or null if none remain. */
export function findNextPending(
  session: Session,
  vocabMap: Map<string, VocabEntry>,
): CurrentWord | null {
  for (const word of session.words) {
    if (word.status === 'pending') {
      const entry = vocabMap.get(word.vocabId)

      if (entry !== undefined) {
        const w1Entry = word.secondChanceFor !== undefined
          ? vocabMap.get(word.secondChanceFor)
          : undefined

        return { vocabId: word.vocabId, entry, isSecondChance: word.secondChanceFor !== undefined, w1Entry }
      }
    }
  }

  return null
}

/** In-place Fisher-Yates shuffle. */
export function fisherYates(arr: string[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

/**
 * Builds a shuffled list of 10 quiz options for the given entry.
 * Correct options are the entry's deduplicated target translations.
 * Distractors are sampled randomly from other entries in vocabMap.
 *
 * Distractor matching rules (applied symmetrically):
 * - All correct answers start with "to " → prefer verb distractors, fall back to non-verbs.
 * - No correct answer starts with "to "  → prefer non-verb distractors, fall back to verbs.
 * - Mixed correct answers               → any distractor is eligible.
 */
export function buildOptions(
  entry: VocabEntry,
  correctTranslations: string[],
  vocabMap: Map<string, VocabEntry>,
): string[] {
  const correctSet = new Set(correctTranslations)
  const needed = Math.max(0, 10 - correctTranslations.length)
  const verbCount = correctTranslations.filter((t) => t.startsWith('to ')).length
  const verbMode = verbCount === correctTranslations.length      // all verbs
  const nonVerbMode = verbCount === 0                            // no verbs

  // primaryCandidates holds the preferred distractor type; fallbackCandidates fill remaining slots.
  const primaryCandidates: string[] = []
  const fallbackCandidates: string[] = []

  for (const [id, e] of vocabMap) {
    if (id === entry.id) {
      continue
    }

    const eligible = e.target.filter((t) => !correctSet.has(t))

    if (eligible.length === 0) {
      continue
    }

    if (verbMode) {
      // Prefer verb targets; fall back to non-verbs.
      const verbTargets = eligible.filter((t) => t.startsWith('to '))

      if (verbTargets.length > 0) {
        primaryCandidates.push(verbTargets[Math.floor(Math.random() * verbTargets.length)] ?? verbTargets[0])
      } else {
        fallbackCandidates.push(eligible[Math.floor(Math.random() * eligible.length)] ?? eligible[0])
      }
    } else if (nonVerbMode) {
      // Prefer non-verb targets; fall back to verbs.
      const nonVerbTargets = eligible.filter((t) => !t.startsWith('to '))

      if (nonVerbTargets.length > 0) {
        primaryCandidates.push(nonVerbTargets[Math.floor(Math.random() * nonVerbTargets.length)] ?? nonVerbTargets[0])
      } else {
        fallbackCandidates.push(eligible[Math.floor(Math.random() * eligible.length)] ?? eligible[0])
      }
    } else {
      // Mixed correct answers — any distractor is fine.
      primaryCandidates.push(eligible[Math.floor(Math.random() * eligible.length)] ?? eligible[0])
    }
  }

  fisherYates(primaryCandidates)
  fisherYates(fallbackCandidates)

  // Primary candidates first, fallback fills remaining slots.
  // Deduplicate by label — multiple vocab entries can share the same target translation
  // (e.g. five words all map to "to gain"), which would cause duplicate option buttons.
  const seenLabels = new Set(correctSet)
  const distractors: string[] = []

  for (const label of [...primaryCandidates, ...fallbackCandidates]) {
    if (distractors.length >= needed) { break }
    if (!seenLabels.has(label)) {
      seenLabels.add(label)
      distractors.push(label)
    }
  }
  const allOptions = [...correctTranslations, ...distractors]

  fisherYates(allOptions)

  return allOptions
}

/** Builds the status message to display after an answer is submitted. */
export function buildStatusMessage(result: AnswerResult, translations: string[]): StatusMessage {
  const { outcome, newBucket, w1NewBucket } = result
  const links = <AnswerLinks words={translations} />

  switch (outcome) {
    case 'correct':
    case 'correct_typo':
      return { text: <>Correct! → bucket {newBucket} · {links}</>, isCorrect: true }
    case 'second_chance_correct':
    case 'second_chance_correct_typo':
      return { text: <>Second chance passed! Original word → second chance session · {links}</>, isCorrect: true }
    case 'incorrect':
      return { text: <>Incorrect. Correct answer: {links} — → bucket 1</>, isCorrect: false }
    case 'partial':
    case 'partial_typo':
      return { text: <>Partially correct. Correct answers: {links} — → bucket {newBucket}</>, isCorrect: false }
    case 'second_chance':
      return { text: <>Incorrect. Correct answer: {links} — succeed: → bucket {newBucket - 1}, fail: → bucket 1</>, isCorrect: false }
    case 'second_chance_incorrect':
      return { text: <>Second chance failed. Correct answer: {links} — original word → bucket {w1NewBucket ?? 1}</>, isCorrect: false }
  }
}
