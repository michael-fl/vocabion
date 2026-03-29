/**
 * Focus Quiz screen component.
 *
 * Multiple-choice training session where the user picks the correct
 * translation(s) from 10 clickable options. Direction is always source → target.
 * Uses the same word selection as the focus session. The user selects options
 * and submits — no typing required. Distractors are drawn from the full vocab.
 *
 * Second-chance flow applies: a time-bucket (4+) wrong answer triggers a
 * second-chance word for the same vocabulary entry.
 *
 * @example
 * ```tsx
 * <FocusQuizScreen
 *   session={session}
 *   vocabMap={vocabMap}
 *   onComplete={(completedSession, cost, earned, spent, perfect, streak, milestone, bucketBonus) =>
 *     setScreen('summary')}
 * />
 * ```
 */
import { useState, useMemo, useEffect, type ReactNode } from 'react'

import type { Session } from '../../shared/types/Session.ts'
import type { VocabEntry } from '../../shared/types/VocabEntry.ts'
import * as sessionApi from '../api/sessionApi.ts'
import * as vocabApi from '../api/vocabApi.ts'
import { deduplicateTranslations } from '../../shared/utils/translationUtils.ts'
import { dictUrl } from '../utils/dictUrl.ts'
import styles from './FocusQuizScreen.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CurrentWord {
  vocabId: string
  entry: VocabEntry
  isSecondChance: boolean
  /** For second-chance words: the original word (W1) whose bucket is displayed. */
  w1Entry?: VocabEntry
}

interface StatusMessage {
  text: ReactNode
  isCorrect: boolean
}

/**
 * One clickable option in the quiz.
 * `state` is set after submission to colour correct/wrong options.
 */
interface QuizOption {
  label: string
  state: 'idle' | 'selected' | 'correct' | 'wrong'
}

export interface FocusQuizScreenProps {
  session: Session
  vocabMap: Map<string, VocabEntry>
  onComplete: (
    session: Session,
    sessionCost: number,
    creditsEarned: number,
    creditsSpent: number,
    perfectBonus: number,
    streakCredit: number,
    milestoneLabel: string | undefined,
    bucketMilestoneBonus: number,
  ) => void
  /** Called after each successful answer submission. Use to refresh external state such as credits. */
  onAnswerSubmitted?: () => void
  /** Current credit balance (not displayed, kept for API parity with TrainingScreen). */
  credits?: number | null
  /** Milliseconds to show a correct-answer banner before auto-advancing. Defaults to 2000. Override in tests with 0. */
  correctFeedbackDelayMs?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Renders a list of answer words as comma-separated dictionary links. */
function AnswerLinks({ words }: { words: string[] }) {
  return (
    <>
      {words.map((w, i) => (
        <span key={w}>
          {i > 0 && ', '}
          <a href={dictUrl(w)} target="_blank" rel="noreferrer">{w}</a>
        </span>
      ))}
    </>
  )
}

function findNextPending(
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

function fisherYates(arr: string[]): void {
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
 * When all correct translations are verbs (start with "to "), distractors
 * are also drawn from verb targets where possible, falling back to non-verbs
 * only if not enough verb distractors are available.
 */
function buildOptions(
  entry: VocabEntry,
  correctTranslations: string[],
  vocabMap: Map<string, VocabEntry>,
): string[] {
  const correctSet = new Set(correctTranslations)
  const needed = Math.max(0, 10 - correctTranslations.length)
  const verbMode = correctTranslations.every((t) => t.startsWith('to '))

  const verbCandidates: string[] = []
  const otherCandidates: string[] = []

  for (const [id, e] of vocabMap) {
    if (id === entry.id) {
      continue
    }

    const eligible = e.target.filter((t) => !correctSet.has(t))

    if (eligible.length === 0) {
      continue
    }

    if (verbMode) {
      const verbTargets = eligible.filter((t) => t.startsWith('to '))

      if (verbTargets.length > 0) {
        verbCandidates.push(verbTargets[Math.floor(Math.random() * verbTargets.length)] ?? verbTargets[0])
      } else {
        otherCandidates.push(eligible[Math.floor(Math.random() * eligible.length)] ?? eligible[0])
      }
    } else {
      otherCandidates.push(eligible[Math.floor(Math.random() * eligible.length)] ?? eligible[0])
    }
  }

  fisherYates(verbCandidates)
  fisherYates(otherCandidates)

  // In verb mode: verb distractors first, non-verbs as fallback
  const distractors = [...verbCandidates, ...otherCandidates].slice(0, needed)
  const allOptions = [...correctTranslations, ...distractors]

  fisherYates(allOptions)

  return allOptions
}

function buildStatusMessage(result: sessionApi.AnswerResult, translations: string[]): StatusMessage {
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

// ── Component ─────────────────────────────────────────────────────────────────

/** Renders the Focus Quiz screen for a multiple-choice training session. */
export function FocusQuizScreen({
  session: initialSession,
  vocabMap,
  onComplete,
  onAnswerSubmitted,
  correctFeedbackDelayMs = 2000,
}: FocusQuizScreenProps) {
  const [currentSession, setCurrentSession] = useState(initialSession)
  const [currentWord, setCurrentWord] = useState<CurrentWord | null>(() =>
    findNextPending(initialSession, vocabMap),
  )
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set())
  /** True once the user has clicked a wrong option for the current word; disables auto-submit. */
  const [everSelectedWrong, setEverSelectedWrong] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null)
  const [completedSessionCost, setCompletedSessionCost] = useState(0)
  const [sessionCreditsEarned, setSessionCreditsEarned] = useState(0)
  const [sessionCreditsSpent] = useState(0)
  const [sessionPerfectBonus, setSessionPerfectBonus] = useState(0)
  const [sessionBucketMilestoneBonus, setSessionBucketMilestoneBonus] = useState(0)
  const [sessionStreakCredit, setSessionStreakCredit] = useState(0)
  const [sessionMilestoneLabel, setSessionMilestoneLabel] = useState<string | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)
  const [isMarked, setIsMarked] = useState(false)
  const [markingWord, setMarkingWord] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (currentWord !== null) {
      setIsMarked(currentWord.entry.marked)
    }
  }, [currentWord])

  useEffect(() => {
    if (statusMessage === null) {
      return
    }

    const isLastWord = currentSession.status === 'completed'

    if (isLastWord) {
      const delay = statusMessage.isCorrect ? 0 : correctFeedbackDelayMs
      const timer = setTimeout(() => {
        onComplete(currentSession, completedSessionCost, sessionCreditsEarned, sessionCreditsSpent, sessionPerfectBonus, sessionStreakCredit, sessionMilestoneLabel, sessionBucketMilestoneBonus)
      }, delay)

      return () => { clearTimeout(timer) }
    }
  }, [statusMessage, currentSession, onComplete, correctFeedbackDelayMs, completedSessionCost, sessionCreditsEarned, sessionCreditsSpent, sessionPerfectBonus, sessionStreakCredit, sessionMilestoneLabel, sessionBucketMilestoneBonus])

  // Build the prompt text for the current word (stable per word, not per render)
  const prompt = useMemo(() => {
    if (currentWord === null) {
      return ''
    }

    // Direction is always SOURCE_TO_TARGET for focus quiz
    return currentWord.entry.source
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWord?.entry.id, currentWord?.isSecondChance])

  // Build options list (stable per word)
  const translations = useMemo(() => {
    if (currentWord === null) {
      return []
    }

    return deduplicateTranslations(currentWord.entry.target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWord?.entry.id, currentWord?.isSecondChance])

  const optionLabels = useMemo(() => {
    if (currentWord === null) {
      return []
    }

    // For second-chance words, always 1 required; otherwise at most 2 (mirrors text-input sessions)
    const correctTranslations = currentWord.isSecondChance
      ? translations.slice(0, 1)
      : translations.slice(0, 2)

    return buildOptions(currentWord.entry, correctTranslations, vocabMap)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWord?.entry.id, currentWord?.isSecondChance, vocabMap])

  if (currentWord === null) {
    return <p>No words available.</p>
  }

  const { entry, isSecondChance, w1Entry } = currentWord
  const displayedBucket = (w1Entry ?? entry).bucket
  const requiredCount = isSecondChance ? 1 : Math.min(translations.length, 2)
  const canSubmit = selectedLabels.size === requiredCount && !submitting && !submitted

  const answered = currentSession.words.filter((w) => w.status !== 'pending').length
  const total = currentSession.words.length

  async function handleToggleMark() {
    const newMarked = !isMarked

    setIsMarked(newMarked)
    setMarkingWord(true)

    try {
      await vocabApi.setVocabMarked(currentWord.vocabId, newMarked)
    } catch {
      setIsMarked(!newMarked)
    } finally {
      setMarkingWord(false)
    }
  }

  function handleOptionClick(label: string) {
    if (submitted || submitting) {
      return
    }

    const next = new Set(selectedLabels)
    let currentEverWrong = everSelectedWrong

    if (next.has(label)) {
      next.delete(label)
    } else {
      // Track wrong selections — disables auto-submit for the rest of this word
      if (!translations.includes(label)) {
        currentEverWrong = true
        setEverSelectedWrong(true)
      }

      // Enforce the selection cap: evict the oldest entry when the limit is exceeded
      if (next.size >= requiredCount) {
        next.delete([...next][0] ?? '')
      }

      next.add(label)
    }

    setSelectedLabels(next)

    // Auto-submit only when all selected answers are correct AND no wrong option was ever touched
    const allCorrect = next.size === requiredCount && [...next].every((l) => translations.includes(l))

    if (allCorrect && !currentEverWrong) {
      void handleSubmit([...next])
    }
  }

  async function handleSubmit(answersOverride?: string[]) {
    const answers = answersOverride ?? [...selectedLabels]

    if (answersOverride === undefined && !canSubmit) {
      return
    }

    setError(null)
    setSubmitting(true)
    setSubmitted(true)

    try {
      const result = await sessionApi.submitAnswer(currentSession.id, currentWord.vocabId, answers, false)

      setCurrentSession(result.session)
      setStatusMessage(buildStatusMessage(result, translations))

      setSessionCreditsEarned((prev) => prev + result.creditsEarned)
      setCompletedSessionCost((prev) => prev + result.answerCost)
      setSessionPerfectBonus(result.perfectBonus)

      if (result.bucketMilestoneBonus > 0) {
        setSessionBucketMilestoneBonus((prev) => prev + result.bucketMilestoneBonus)
      }

      if (result.streakCredit > 0) {
        setSessionStreakCredit(result.streakCredit)
        setSessionMilestoneLabel(result.milestoneLabel)
      }

      onAnswerSubmitted?.()

      if (!result.sessionCompleted) {
        const delay = result.correct ? (correctFeedbackDelayMs === 0 ? 0 : 1200) : correctFeedbackDelayMs
        const nextWord = findNextPending(result.session, vocabMap)

        setTimeout(() => {
          setCurrentWord(nextWord)
          setSelectedLabels(new Set())
          setEverSelectedWrong(false)
          setSubmitted(false)
          setStatusMessage(null)
        }, delay)
      }
      // If sessionCompleted, useEffect handles the transition to summary.
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit answer')
      setSubmitted(false)
    } finally {
      setSubmitting(false)
    }
  }

  // Determine per-option visual state after submission
  function getOptionState(label: string): QuizOption['state'] {
    if (!submitted) {
      return selectedLabels.has(label) ? 'selected' : 'idle'
    }

    const isCorrect = translations.includes(label)
    const wasSelected = selectedLabels.has(label)

    if (isCorrect) {
      return 'correct'
    }

    if (wasSelected) {
      return 'wrong'
    }

    return 'idle'
  }

  function optionClassName(state: QuizOption['state']): string {
    switch (state) {
      case 'selected': return `${styles.optionBtn} ${styles.optionBtnSelected}`
      case 'correct': return `${styles.optionBtn} ${styles.optionBtnCorrect}`
      case 'wrong': return `${styles.optionBtn} ${styles.optionBtnWrong}`
      default: return styles.optionBtn
    }
  }

  const selectLabel = requiredCount === 1 ? 'Select 1 answer' : `Select ${requiredCount} answers`

  return (
    <div className={styles.screen}>
      <div>
        <h2>Focus Quiz</h2>
        <p className={styles.meta}>{answered} of {total} answered</p>
      </div>

      {error !== null && (
        <p role="alert" style={{ color: 'var(--color-error)' }}>{error}</p>
      )}

      <div className={styles.promptLine}>
        <span className={styles.prompt}>{prompt}</span>
        <span className={styles.bucketTag}>bucket {displayedBucket}</span>
        <button
          type="button"
          className={`${styles.starBtn}${isMarked ? ` ${styles.starBtnMarked}` : ''}`}
          onClick={() => { void handleToggleMark() }}
          disabled={markingWord}
          aria-label={isMarked ? 'Unstar word' : 'Star word'}
        >
          {isMarked ? '★' : '☆'}
        </button>
      </div>

      {isSecondChance && (
        <p className={styles.secondChanceNotice}>
          Second chance! Answer correctly to keep word in its current bucket.
        </p>
      )}

      <p className={styles.selectHint}>{selectLabel}</p>

      {/* Options on the left; feedback panel on the right — fixed column width keeps options stable. */}
      <div className={styles.quizBody}>
        <div>
          <div className={styles.optionsGrid}>
            {optionLabels.map((label) => {
              const state = getOptionState(label)

              return (
                <button
                  key={label}
                  type="button"
                  className={optionClassName(state)}
                  onClick={() => { handleOptionClick(label) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (canSubmit) { void handleSubmit() }
                    }
                  }}
                  disabled={submitted || submitting}
                  aria-pressed={selectedLabels.has(label)}
                >
                  {label}
                </button>
              )
            })}
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              onClick={() => { void handleSubmit() }}
              disabled={!canSubmit}
            >
              Submit
            </button>
          </div>
        </div>

        <div className={styles.feedbackPanel}>
          {statusMessage !== null && (
            <div role="status" className={`${styles.statusBanner} ${statusMessage.isCorrect ? styles.statusBannerCorrect : styles.statusBannerWrong}`}>
              {statusMessage.text}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
