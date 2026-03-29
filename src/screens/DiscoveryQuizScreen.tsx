/**
 * Discovery Quiz screen component.
 *
 * Multiple-choice training session for bucket-0 (new) words. The user picks
 * the correct translation(s) from 10 clickable options — no typing required.
 * Direction is always source → target.
 *
 * Gameplay mirrors the Focus Quiz Session with one addition: a **Push back**
 * button lets the user return a word to bucket 0 for a later session (budget:
 * 10 push-backs per session).
 *
 * No hints. Wrong answers are free (virgin words). Perfect-session bonus: +100.
 *
 * @example
 * ```tsx
 * <DiscoveryQuizScreen
 *   session={session}
 *   vocabMap={vocabMap}
 *   onComplete={(completedSession, cost, earned, spent, perfect, streak, milestone, bucketBonus) =>
 *     setScreen('summary')}
 * />
 * ```
 */
import { useState, useMemo, useEffect } from 'react'

import type { Session } from '../../shared/types/Session.ts'
import type { VocabEntry } from '../../shared/types/VocabEntry.ts'
import * as sessionApi from '../api/sessionApi.ts'
import * as vocabApi from '../api/vocabApi.ts'
import { deduplicateTranslations } from '../../shared/utils/translationUtils.ts'
import {
  type CurrentWord,
  type StatusMessage,
  type QuizOption,
  findNextPending,
  buildOptions,
  buildStatusMessage,
} from './multipleChoiceHelpers.tsx'

// Reuse the Focus Quiz CSS — the layout and option styles are identical.
import styles from './FocusQuizScreen.module.css'

// ── Props ──────────────────────────────────────────────────────────────────────

export interface DiscoveryQuizScreenProps {
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

// ── Component ──────────────────────────────────────────────────────────────────

/** Renders the Discovery Quiz screen — multiple-choice training for new (bucket-0) words. */
export function DiscoveryQuizScreen({
  session: initialSession,
  vocabMap,
  onComplete,
  onAnswerSubmitted,
  correctFeedbackDelayMs = 2000,
}: DiscoveryQuizScreenProps) {
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
        onComplete(currentSession, completedSessionCost, sessionCreditsEarned, 0, sessionPerfectBonus, sessionStreakCredit, sessionMilestoneLabel, sessionBucketMilestoneBonus)
      }, delay)

      return () => { clearTimeout(timer) }
    }
  }, [statusMessage, currentSession, onComplete, correctFeedbackDelayMs, completedSessionCost, sessionCreditsEarned, sessionPerfectBonus, sessionStreakCredit, sessionMilestoneLabel, sessionBucketMilestoneBonus])

  // Build the prompt text for the current word (stable per word, not per render)
  const prompt = useMemo(() => {
    if (currentWord === null) {
      return ''
    }

    return currentWord.entry.source
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWord?.entry.id, currentWord?.isSecondChance])

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
  const pushBacksUsed = currentSession.words.filter((w) => w.status === 'pushed_back').length
  const pushBacksRemaining = sessionApi.DISCOVERY_PUSHBACK_BUDGET - pushBacksUsed

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

  async function handlePushBack() {
    setSubmitting(true)
    setError(null)

    try {
      const updatedSession = await sessionApi.pushBackWord(currentSession.id, currentWord.vocabId)

      setCurrentSession(updatedSession)

      // Push-back can complete the session when it was the last pending word.
      if (updatedSession.status === 'completed') {
        onComplete(updatedSession, completedSessionCost, sessionCreditsEarned, 0, 0, sessionStreakCredit, sessionMilestoneLabel, sessionBucketMilestoneBonus)

        return
      }

      setCurrentWord(findNextPending(updatedSession, vocabMap))
      setSelectedLabels(new Set())
      setEverSelectedWrong(false)
      setSubmitted(false)
      setStatusMessage(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to push back word')
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
        <h2>Discovery Quiz</h2>
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
            <button
              type="button"
              onClick={() => { void handlePushBack() }}
              disabled={submitting || submitted || pushBacksRemaining <= 0}
            >
              Push back ({pushBacksRemaining} left)
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
