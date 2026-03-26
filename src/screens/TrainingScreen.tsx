/**
 * Training screen component.
 *
 * The answer form is always visible. A non-blocking status banner above the
 * form shows the result of the last answer:
 * - Correct answer: banner shows "Correct!" and the form advances to the next
 *   word automatically after a short delay. The banner clears when it advances.
 * - Wrong answer: banner shows "Incorrect. Correct answer: …" and the form
 *   advances immediately to the next word. The banner stays visible until the
 *   user submits their next answer.
 *
 * After a fully incorrect answer the user can click "Add [answer] [+]" to add
 * their typed answer as a valid alternative in the database.
 *
 * When the last word of the session is answered, the component calls
 * `onComplete` after the same delay (correct) or a fixed 2 s delay (wrong).
 *
 * @example
 * ```tsx
 * <TrainingScreen
 *   session={session}
 *   vocabMap={vocabMap}
 *   onComplete={(completedSession) => setScreen('summary')}
 * />
 * ```
 */
import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react'

import type { Session } from '../../shared/types/Session.ts'
import type { VocabEntry } from '../../shared/types/VocabEntry.ts'
import * as sessionApi from '../api/sessionApi.ts'
import * as vocabApi from '../api/vocabApi.ts'
import * as creditsApi from '../api/creditsApi.ts'
import { generateHint, getHintCost, countSignificantChars } from '../utils/hint.ts'
import { deduplicateTranslations } from '../../shared/utils/translationUtils.ts'
import { dictUrl } from '../utils/dictUrl.ts'
import styles from './TrainingScreen.module.css'

export interface TrainingScreenProps {
  session: Session
  vocabMap: Map<string, VocabEntry>
  onComplete: (session: Session, sessionCost: number, creditsEarned: number, creditsSpent: number, perfectBonus: number, streakCredit: number, milestoneLabel: string | undefined, bucketMilestoneBonus: number) => void
  /** Called after each successful answer submission. Use to refresh external state such as credits. */
  onAnswerSubmitted?: () => void
  /** Current credit balance. When provided, enables the hint button when balance ≥ 10. */
  credits?: number | null
  /** Milliseconds to show a correct-answer banner before auto-advancing. Defaults to 2000. Override in tests with 0. */
  correctFeedbackDelayMs?: number
}

interface CurrentWord {
  vocabId: string
  entry: VocabEntry
  isSecondChance: boolean
  /** For second-chance words: the original word (W1) whose bucket is displayed. */
  w1Entry?: VocabEntry
}

interface StatusMessage {
  text: ReactNode
  /** True for fully correct outcomes — summary transition is immediate. */
  isCorrect: boolean
}

/** Hint placeholder text and the total significant-character count of the correct answer. */
interface HintInfo {
  text: string
  totalChars: number
}

/** One candidate answer the user may want to promote to a valid alternative. */
interface PendingAlternativeAnswer {
  text: string
  adding: boolean
  added: boolean
}

/**
 * Tracks wrong answers that the user may want to add as valid alternatives.
 * Only set for `incorrect` and `second_chance_incorrect` outcomes.
 * Each typed answer gets its own button so the user can pick which ones are correct.
 */
interface PendingAlternative {
  vocabId: string
  answers: PendingAlternativeAnswer[]
  /** Bucket the word was in before the wrong answer demoted it. */
  originalBucket: number
  /** Credits deducted for this wrong answer (0 or 1); refunded on first successful add. */
  answerCost: number
  /** Current starred state of the word; toggled independently of adding the alternative. */
  altMarked: boolean
  /** True once the bucket restore + credit refund have been applied (at most once). */
  bucketRestored: boolean
}

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

function buildStatusMessage(result: sessionApi.AnswerResult, translations: string[]): StatusMessage {
  const { outcome, newBucket, w1NewBucket } = result
  const links = <AnswerLinks words={translations} />

  switch (outcome) {
    case 'correct':
      return { text: <>Correct! → bucket {newBucket} · {links}</>, isCorrect: true }
    case 'correct_typo': {
      const typoNote = result.typos?.map((t) => `"${t.typed}" → "${t.correct}"`).join(', ') ?? ''
      return { text: <>Correct! (Spelling: {typoNote}) → bucket {newBucket} · {links}</>, isCorrect: true }
    }
    case 'second_chance_correct':
      return { text: <>Second chance passed! Original word → second chance session · {links}</>, isCorrect: true }
    case 'second_chance_correct_typo': {
      const typoNote = result.typos?.map((t) => `"${t.typed}" → "${t.correct}"`).join(', ') ?? ''
      return { text: <>Second chance passed! (Spelling: {typoNote}) Original word → second chance session · {links}</>, isCorrect: true }
    }
    case 'incorrect':
      return { text: <>Incorrect. Correct answer: {links} — → bucket 1</>, isCorrect: false }
    case 'partial':
      return { text: <>Partially correct. Correct answers: {links} — → bucket {newBucket}</>, isCorrect: false }
    case 'partial_typo': {
      const typoNote = result.typos?.map((t) => `"${t.typed}" → "${t.correct}"`).join(', ') ?? ''
      return { text: <>Partially correct. (Spelling: {typoNote}) Correct answers: {links} — → bucket {newBucket}</>, isCorrect: false }
    }
    case 'second_chance':
      return { text: <>Incorrect. Correct answer: {links} — succeed: → bucket {newBucket - 1}, fail: → bucket 1</>, isCorrect: false }
    case 'second_chance_partial':
      return { text: <>Second chance failed (partial). Correct answers: {links} — original word → bucket {w1NewBucket ?? 1}</>, isCorrect: false }
    case 'second_chance_partial_typo': {
      const typoNote = result.typos?.map((t) => `"${t.typed}" → "${t.correct}"`).join(', ') ?? ''
      return { text: <>Second chance failed (partial). (Spelling: {typoNote}) Correct answers: {links} — original word → bucket {w1NewBucket ?? 1}</>, isCorrect: false }
    }
    case 'second_chance_incorrect':
      return { text: <>Second chance failed. Correct answer: {links} — original word → bucket {w1NewBucket ?? 1}</>, isCorrect: false }
  }
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

/** Renders the training screen for an active session. */
export function TrainingScreen({
  session: initialSession,
  vocabMap,
  onComplete,
  onAnswerSubmitted,
  credits = null,
  correctFeedbackDelayMs = 2000,
}: TrainingScreenProps) {
  const [currentSession, setCurrentSession] = useState(initialSession)
  const [currentWord, setCurrentWord] = useState<CurrentWord | null>(() =>
    findNextPending(initialSession, vocabMap),
  )
  const [answers, setAnswers] = useState(['', ''])
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null)
  const [pendingAlternative, setPendingAlternative] = useState<PendingAlternative | null>(null)
  const [completedSessionCost, setCompletedSessionCost] = useState(0)
  const [sessionCreditsEarned, setSessionCreditsEarned] = useState(0)
  const [sessionCreditsSpent, setSessionCreditsSpent] = useState(0)
  const [sessionPerfectBonus, setSessionPerfectBonus] = useState(0)
  const [bucketMilestoneBonus, setBucketMilestoneBonus] = useState(0)
  const [sessionBucketMilestoneBonus, setSessionBucketMilestoneBonus] = useState(0)
  const [sessionStreakCredit, setSessionStreakCredit] = useState(0)
  const [sessionMilestoneLabel, setSessionMilestoneLabel] = useState<string | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)
  const [hints, setHints] = useState<HintInfo[] | null>(null)
  const [hintUpgraded, setHintUpgraded] = useState(false)
  const [requestingHint, setRequestingHint] = useState(false)
  const [isMarked, setIsMarked] = useState(false)
  const [markingWord, setMarkingWord] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const submittingRef = useRef(false)
  /** True during the 2-second grace window after a new stress word appears. Ignores accidental empty submits. */
  const stressGraceRef = useRef(false)

  useEffect(() => {
    firstInputRef.current?.focus()

    setHintUpgraded(false)

    if (currentWord === null) {
      setHints(null)
      return
    }

    setIsMarked(currentWord.entry.marked)

    const bucket = (currentWord.w1Entry ?? currentWord.entry).bucket

    if (bucket <= 1) {
      const wordTranslations = deduplicateTranslations(
        currentSession.direction === 'SOURCE_TO_TARGET' ? currentWord.entry.target : [currentWord.entry.source],
      )
      const count = Math.min(wordTranslations.length, 2)
      // Bucket 0: reveal up to 2 chars per word; bucket 1: reveal only 1 char per word
      const maxShown = bucket === 0 ? 2 : 1
      const shuffled = [...wordTranslations].sort(() => Math.random() - 0.5)
      setHints(shuffled.slice(0, count).map((t) => ({ text: generateHint(t, maxShown), totalChars: countSignificantChars(t) })))
    } else {
      setHints(null)
    }
  }, [currentWord, currentSession.direction])

  useEffect(() => {
    if (statusMessage === null) {
      return
    }

    const isLastWord = currentSession.status === 'completed'

    if (isLastWord) {
      // Correct answers proceed immediately; wrong/partial answers pause so the user can read the feedback.
      const delay = statusMessage.isCorrect ? 0 : correctFeedbackDelayMs
      const timer = setTimeout(() => {
        onComplete(currentSession, completedSessionCost, sessionCreditsEarned, sessionCreditsSpent, sessionPerfectBonus, sessionStreakCredit, sessionMilestoneLabel, sessionBucketMilestoneBonus)
      }, delay)
      return () => { clearTimeout(timer) }
    }

    // All status messages stay visible until the next answer is submitted.
  }, [statusMessage, currentSession, onComplete, correctFeedbackDelayMs, completedSessionCost, sessionCreditsEarned, sessionCreditsSpent, sessionPerfectBonus, sessionStreakCredit, sessionMilestoneLabel, sessionBucketMilestoneBonus])

  // Stress session countdown timer: counts down per word, auto-submits on expiry.
  useEffect(() => {
    if (currentSession.type !== 'stress' || currentWord === null) {
      setTimeLeft(null)
      return
    }

    const wordTranslations = deduplicateTranslations(
      currentSession.direction === 'SOURCE_TO_TARGET' ? currentWord.entry.target : [currentWord.entry.source],
    )
    const fieldCount = Math.min(wordTranslations.length, 2)
    const limit = fieldCount > 1 ? 15 : 10

    stressGraceRef.current = true
    const graceTimeout = setTimeout(() => { stressGraceRef.current = false }, 2000)

    setTimeLeft(limit)

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval)

          if (!submittingRef.current) {
            formRef.current?.requestSubmit()
          }

          return 0
        }

        return prev - 1
      })
    }, 1000)

    return () => { clearInterval(interval); clearTimeout(graceTimeout); stressGraceRef.current = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWord?.entry.id, currentWord?.isSecondChance, currentSession.type])

  // useMemo must be called unconditionally (before early return) — Rules of Hooks.
  // When currentWord is null the returned value is unused.
  const prompt = useMemo(() => {
    if (currentWord === null) {
      return ''
    }

    const words = currentSession.direction === 'SOURCE_TO_TARGET' ? [currentWord.entry.source] : currentWord.entry.target

    return words[Math.floor(Math.random() * words.length)] ?? ''
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWord?.entry.id, currentWord?.isSecondChance])

  if (currentWord === null) {
    return <p>No words available.</p>
  }

  const { entry, isSecondChance, w1Entry } = currentWord
  const displayedBucket = (w1Entry ?? entry).bucket
  const hintCost = getHintCost(displayedBucket)
  const translations = deduplicateTranslations(currentSession.direction === 'SOURCE_TO_TARGET' ? entry.target : [entry.source])
  const requiredCount = Math.min(translations.length, 2)

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

  async function handleToggleAltMark() {
    if (pendingAlternative === null) {
      return
    }

    const newMarked = !pendingAlternative.altMarked

    setPendingAlternative({ ...pendingAlternative, altMarked: newMarked })

    try {
      await vocabApi.setVocabMarked(pendingAlternative.vocabId, newMarked)
    } catch {
      setPendingAlternative({ ...pendingAlternative, altMarked: !newMarked })
    }
  }

  async function handleHint() {
    setRequestingHint(true)

    try {
      await creditsApi.spendCredits(hintCost)
      const shuffledTranslations = [...translations].sort(() => Math.random() - 0.5)
      setHints(shuffledTranslations.slice(0, requiredCount).map((t) => ({ text: generateHint(t), totalChars: countSignificantChars(t) })))
      setHintUpgraded(true)
      setAnswers(Array(requiredCount).fill('') as string[])
      setSessionCreditsSpent((prev) => prev + hintCost)
      onAnswerSubmitted?.()
      firstInputRef.current?.focus()
    } catch {
      // Leave hints unchanged — button remains enabled to retry
    } finally {
      setRequestingHint(false)
    }
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()

    const trimmed = answers
      .slice(0, requiredCount)
      .map((a) => a.trim())

    // Guard: in a stress session, ignore an all-empty manual submit that arrives within
    // 2 seconds of the timer starting — it is almost certainly a late "panic" keypress
    // meant for the previous question that the timer already auto-submitted.
    const allEmpty = trimmed.every((a) => a.length === 0)

    if (isStress && allEmpty && stressGraceRef.current) {
      return
    }

    setStatusMessage(null)
    setPendingAlternative(null)
    setError(null)
    setSubmitting(true)
    submittingRef.current = true

    // An all-empty submission is treated as "I don't know" — still a valid (wrong) answer
    const payload = trimmed.filter((a) => a.length > 0)
    const toSubmit = payload.length > 0 ? payload : ['']

    try {
      const result = await sessionApi.submitAnswer(currentSession.id, currentWord.vocabId, toSubmit, sessionCreditsSpent > 0)

      setCurrentSession(result.session)
      setStatusMessage(buildStatusMessage(result, translations))

      setSessionCreditsEarned((prev) => prev + result.creditsEarned)
      setCompletedSessionCost((prev) => prev + result.answerCost)
      setSessionPerfectBonus(result.perfectBonus)
      if (result.bucketMilestoneBonus > 0) {
        setBucketMilestoneBonus(result.bucketMilestoneBonus)
        setSessionBucketMilestoneBonus((prev) => prev + result.bucketMilestoneBonus)
      }
      if (result.streakCredit > 0) {
        setSessionStreakCredit(result.streakCredit)
        setSessionMilestoneLabel(result.milestoneLabel)
      }
      onAnswerSubmitted?.()

      if (
        result.outcome === 'incorrect' ||
        result.outcome === 'second_chance_incorrect' ||
        result.outcome === 'partial' ||
        result.outcome === 'partial_typo' ||
        result.outcome === 'second_chance_partial' ||
        result.outcome === 'second_chance_partial_typo'
      ) {
        const originalBucket = vocabMap.get(currentWord.vocabId)?.bucket ?? 0
        const existingNorm = new Set(translations.map((t) => t.toLowerCase().replace(/-/g, ' ').trim()))
        const newAnswers = toSubmit.filter((a) => !existingNorm.has(a.toLowerCase().replace(/-/g, ' ').trim()))
        const altMarked = vocabMap.get(currentWord.vocabId)?.marked ?? false

        const pendingAnswers: PendingAlternativeAnswer[] = newAnswers.map((text) => ({ text, adding: false, added: false }))

        setPendingAlternative({ vocabId: currentWord.vocabId, answers: pendingAnswers, originalBucket, answerCost: result.answerCost, altMarked, bucketRestored: false })
      }

      if (!result.sessionCompleted) {
        // Advance the form to the next word immediately for both correct and wrong.
        setCurrentWord(findNextPending(result.session, vocabMap))
        setAnswers(['', ''])
      }
      // If sessionCompleted, useEffect handles the transition to summary.
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit answer')
    } finally {
      setSubmitting(false)
      submittingRef.current = false
    }
  }

  async function handlePushBack() {
    if (currentWord === null) {
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const updatedSession = await sessionApi.pushBackWord(currentSession.id, currentWord.vocabId)

      setCurrentSession(updatedSession)
      setCurrentWord(findNextPending(updatedSession, vocabMap))
      setAnswers(['', ''])
      setStatusMessage(null)
      setHints(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to push back word')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleAddAlternative(answerText: string) {
    if (pendingAlternative === null) {
      return
    }

    const answeredEntry = vocabMap.get(pendingAlternative.vocabId)

    if (answeredEntry === undefined) {
      return
    }

    const updateAnswers = (patch: Partial<PendingAlternativeAnswer>) => {
      setPendingAlternative((prev) => {
        if (prev === null) {
          return prev
        }

        return {
          ...prev,
          answers: prev.answers.map((a) => (a.text === answerText ? { ...a, ...patch } : a)),
        }
      })
    }

    updateAnswers({ adding: true })

    try {
      if (currentSession.direction === 'SOURCE_TO_TARGET') {
        await vocabApi.addOrMergeVocab([answeredEntry.source], [answerText])
      } else {
        await vocabApi.addOrMergeVocab([answerText], answeredEntry.target)
      }

      if (!pendingAlternative.bucketRestored) {
        const restoredBucket = pendingAlternative.originalBucket + 1

        await vocabApi.setVocabBucket(pendingAlternative.vocabId, restoredBucket)

        const updatedSession = await sessionApi.markWordCorrect(currentSession.id, pendingAlternative.vocabId)

        setCurrentSession(updatedSession)

        if (pendingAlternative.answerCost > 0) {
          await creditsApi.refundCredits(pendingAlternative.answerCost)
          setCompletedSessionCost((prev) => Math.max(0, prev - pendingAlternative.answerCost))
          onAnswerSubmitted?.()
        }

        setPendingAlternative((prev) => (prev !== null ? { ...prev, bucketRestored: true } : prev))
      }

      updateAnswers({ adding: false, added: true })
    } catch {
      updateAnswers({ adding: false })
    }
  }

  const isStress = currentSession.type === 'stress'

  return (
    <div className={styles.screen}>
      <div>
        <h2>
          {currentSession.type === 'repetition'
            ? 'Repetition Session'
            : currentSession.type === 'focus'
              ? 'Focus Session'
              : currentSession.type === 'discovery'
                ? 'Discovery Session'
                : currentSession.type === 'stress'
                  ? 'Stress Session'
                  : currentSession.type === 'veteran'
                    ? 'Veteran Session'
                    : currentSession.type === 'breakthrough'
                      ? 'Breakthrough Session'
                      : currentSession.type === 'second_chance_session'
                        ? 'Second Chance Session'
                        : currentSession.type === 'recovery'
                          ? 'Recovery Session'
                          : 'Learning Session'}
        </h2>
        <p className={styles.meta}>{answered} of {total} answered</p>
      </div>

      {isStress && timeLeft !== null && (
        <div className={styles.stressBar}>
          <span
            className={`${styles.stressTimer}${timeLeft <= 5 ? ` ${styles.stressTimerLow}` : ''}`}
            aria-label={`Time remaining: ${timeLeft} seconds`}
          >
            {timeLeft}s
          </span>
          {credits !== null && (
            <span className={styles.stressBalance}>Balance: {credits.toLocaleString()} credits</span>
          )}
        </div>
      )}

      {statusMessage !== null && (
        <p
          role="status"
          className={`${styles.statusBanner} ${statusMessage.isCorrect ? styles.statusBannerCorrect : styles.statusBannerWrong}`}
        >
          {statusMessage.text}
        </p>
      )}

      {bucketMilestoneBonus > 0 && (
        <p role="status" className={styles.milestoneBanner}>
          New bucket reached! +{bucketMilestoneBonus} credits bonus!
        </p>
      )}

      {pendingAlternative !== null && (
        <div className={styles.alternativeActions}>
          {pendingAlternative.answers.map((a) => (
            !a.added && (
              <div key={a.text} className={styles.alternativeRow}>
                <span>
                  Add &quot;<a href={dictUrl(a.text)} target="_blank" rel="noreferrer">{a.text}</a>&quot;
                </span>
                <button
                  type="button"
                  aria-label={`Add "${a.text}" as alternative`}
                  onClick={() => void handleAddAlternative(a.text)}
                  disabled={a.adding}
                >
                  +
                </button>
              </div>
            )
          ))}

          {pendingAlternative.bucketRestored && (
            <p>Alternative added. Word restored to bucket {pendingAlternative.originalBucket + 1}.</p>
          )}

          {(() => {
            const altEntry = vocabMap.get(pendingAlternative.vocabId)
            const altWords = altEntry !== undefined
              ? (currentSession.direction === 'SOURCE_TO_TARGET' ? [altEntry.source] : altEntry.target)
              : pendingAlternative.answers.map((a) => a.text)
            const altPrompt = altWords.join(' / ')

            return (
              <div className={styles.alternativeRow}>
                <span>Mark &quot;{altWords.map((w, i) => (
                  <span key={w}>
                    {i > 0 && ' / '}
                    <a href={dictUrl(w)} target="_blank" rel="noreferrer">{w}</a>
                  </span>
                ))}&quot;</span>
                <button
                  type="button"
                  className={`${styles.starBtn}${pendingAlternative.altMarked ? ` ${styles.starBtnMarked}` : ''}`}
                  aria-label={pendingAlternative.altMarked ? `Unmark "${altPrompt}"` : `Mark "${altPrompt}"`}
                  onClick={() => void handleToggleAltMark()}
                >
                  {pendingAlternative.altMarked ? '★' : '☆'}
                </button>
              </div>
            )
          })()}
        </div>
      )}

      {isSecondChance && (
        <p className={styles.secondChanceNotice}>
          <strong>Second Chance</strong> — answer correctly to reduce the penalty.
        </p>
      )}

      <form ref={formRef} className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
        <div className={styles.promptLine}>
          <span>Translate:</span>
          <strong className={styles.prompt}>{prompt}</strong>
          <span className={styles.bucketTag}>
            {displayedBucket === 0 ? '(new word)' : `Bucket ${displayedBucket}`} · {currentSession.type === 'veteran' ? `difficulty: ${(w1Entry ?? entry).difficulty}` : `score: ${(w1Entry ?? entry).score}`}
          </span>
          <button
            type="button"
            className={`${styles.starBtn}${isMarked ? ` ${styles.starBtnMarked}` : ''}`}
            aria-label={isMarked ? 'Unmark word' : 'Mark word'}
            onClick={() => void handleToggleMark()}
            disabled={markingWord}
          >
            {isMarked ? '★' : '☆'}
          </button>
        </div>

        {Array.from({ length: requiredCount }, (_, i) => {
          const hint = hints?.[i] ?? null
          const remaining = hint !== null ? hint.totalChars - countSignificantChars(answers[i] ?? '') : null

          return (
            <div key={i} className={styles.answerRow}>
              <label className={styles.answerLabel}>
                <span className={styles.answerLabelText}>
                  {requiredCount > 1 ? `Answer ${i + 1}:` : 'Your answer:'}
                </span>
                <input
                  className={styles.answerInput}
                  ref={i === 0 ? firstInputRef : undefined}
                  type="text"
                  placeholder={hint !== null ? hint.text : ''}
                  value={answers[i] ?? ''}
                  onChange={(e) => {
                    const next = [...answers]
                    next[i] = e.target.value
                    setAnswers(next)
                  }}
                />
              </label>
              {remaining !== null && (
                <span className={`${styles.remainingChars}${remaining < 0 ? ` ${styles.remainingCharsOver}` : ''}`}>
                  {remaining}
                </span>
              )}
            </div>
          )
        })}

        {error !== null && <p role="alert">{error}</p>}

        <div className={styles.formActions}>
          <button type="submit" disabled={submitting}>
            Submit
          </button>

          {!isStress && (
            <button
              type="button"
              onClick={() => void handleHint()}
              disabled={displayedBucket === 0 || credits === null || credits < hintCost || hintUpgraded || (displayedBucket > 1 && hints !== null) || requestingHint || currentSession.type === 'second_chance_session'}
            >
              {displayedBucket === 0 ? 'Hint (auto)' : `Hint (${hintCost} credits)`}
            </button>
          )}

          {currentSession.type === 'discovery' && (
            <button
              type="button"
              onClick={() => void handlePushBack()}
              disabled={submitting || pushBacksRemaining <= 0}
            >
              Push back ({pushBacksRemaining} left)
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
