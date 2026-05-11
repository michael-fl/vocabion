/**
 * Home screen component.
 *
 * On mount, checks whether there is an open training session. If so,
 * presents a "Continue session" button. Otherwise shows "Start new session".
 * Loading vocab and the session in parallel before handing off to the training screen.
 *
 * @example
 * ```tsx
 * <HomeScreen onStartTraining={(session, vocabMap) => setScreen('training')} />
 * ```
 */
import { useState, useEffect, useCallback } from 'react'

import type { VocabEntry } from '../../shared/types/VocabEntry.ts'

/**
 * Formats a `YYYY-MM-DD` date string as a human-readable local date,
 * e.g. `'2026-03-21'` → `'21 March 2026'`.
 */
function formatSessionDate(dateStr: string): string {
  const parts = dateStr.split('-')
  const year = parseInt(parts[0] ?? '0', 10)
  const month = parseInt(parts[1] ?? '1', 10)
  const day = parseInt(parts[2] ?? '1', 10)

  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
import type { Session } from '../../shared/types/Session.ts'
import * as sessionApi from '../api/sessionApi.ts'
import type { StarredAvailable, ReviewAvailable } from '../api/sessionApi.ts'
import * as vocabApi from '../api/vocabApi.ts'
import * as streakApi from '../api/streakApi.ts'
import * as starsApi from '../api/starsApi.ts'
import type { StarsOffer } from '../api/starsApi.ts'
import { isEveningStreakWarning } from '../utils/streakWarning.ts'
import { useOnVisible } from '../hooks/useOnVisible.ts'
import { StarsPurchaseDialog } from '../components/StarsPurchaseDialog/StarsPurchaseDialog.tsx'
import { PauseConfirmDialog } from '../components/PauseConfirmDialog/PauseConfirmDialog.tsx'
import styles from './HomeScreen.module.css'

export interface HomeScreenProps {
  onStartTraining: (session: Session, vocabMap: Map<string, VocabEntry>) => void
  /** Called after pause/resume so the parent can refresh the streak state. */
  onStreakRefresh?: () => void
  /** Called after a stars purchase so the parent can refresh credits and stars in the header. */
  onCreditsRefresh?: () => void
  /** Current credit balance — needed to enable/disable the streak-save button. */
  credits?: number | null
  /** Current streak count and save availability. Fetched externally so the header can share the state. */
  streak?: streakApi.StreakInfo | null
}

/**
 * Renders the home screen.
 * Calls `onStartTraining` once the session and vocab data are ready.
 */
export function HomeScreen({ onStartTraining, onStreakRefresh, onCreditsRefresh, credits = null, streak = null }: HomeScreenProps) {
  // undefined = still loading; null = no open session
  const [openSession, setOpenSession] = useState<Session | null | undefined>(undefined)
  const [starredAvailable, setStarredAvailable] = useState<StarredAvailable | null>(null)
  const [reviewAvailable, setReviewAvailable] = useState<ReviewAvailable | null>(null)
  const [starsOffer, setStarsOffer] = useState<StarsOffer | null>(null)
  const [hasVocab, setHasVocab] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPauseConfirmDialog, setShowPauseConfirmDialog] = useState(false)

  const loadData = useCallback(() => {
    Promise.all([
      sessionApi.getOpenSession(),
      sessionApi.getStarredAvailable(),
      sessionApi.getReviewAvailable(),
      starsApi.getStarsOffer(),
      vocabApi.listVocab(),
    ])
      .then(([session, starred, review, offer, entries]) => {
        setHasVocab(entries.length > 0)
        setStarredAvailable(starred)
        setReviewAvailable(review)

        if (offer.shouldOffer) {
          setStarsOffer(offer)
        }

        if (session === null) {
          setOpenSession(null)
          return
        }

        const answeredCount = session.words.filter((w) => w.status !== 'pending').length
        const hasPending = session.words.some((w) => w.status === 'pending')

        if (answeredCount > 0 && hasPending) {
          // Truly in-progress: offer to continue
          setOpenSession(session)
        } else {
          // Not started yet, or all answered but still open — treat as none
          setOpenSession(null)
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load session')
        setOpenSession(null)
        setHasVocab(false)
      })
  }, [])

  useEffect(() => { loadData() }, [loadData])

  useOnVisible(loadData)

  async function handleStarsPurchase(count: number) {
    await starsApi.purchaseStars(count)

    setStarsOffer(null)
    onCreditsRefresh?.()
  }

  async function handleStarsSnooze() {
    await starsApi.snoozeStarsOffer()

    setStarsOffer(null)
  }

  async function handleSaveStreak() {
    setLoading(true)
    setError(null)

    try {
      await streakApi.saveStreak()
      await handleStart()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save streak')
      setLoading(false)
    }
  }

  async function handleActivatePause(): Promise<void> {
    await streakApi.activatePause()
    setShowPauseConfirmDialog(false)
    onStreakRefresh?.()
  }

  async function handleResumePause() {
    setLoading(true)
    setError(null)

    try {
      await streakApi.resumePause()
      onStreakRefresh?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resume game')
    } finally {
      setLoading(false)
    }
  }

  async function handleStartStarred() {
    setLoading(true)
    setError(null)

    try {
      const [session, entries] = await Promise.all([
        sessionApi.createStarredSession(),
        vocabApi.listVocab(),
      ])

      const vocabMap = new Map(entries.map((e) => [e.id, e]))

      onStartTraining(session, vocabMap)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start starred session')
      setLoading(false)
    }
  }

  async function handleStartReview() {
    setLoading(true)
    setError(null)

    try {
      const [session, entries] = await Promise.all([
        sessionApi.createReviewSession(),
        vocabApi.listVocab(),
      ])

      const vocabMap = new Map(entries.map((e) => [e.id, e]))

      onStartTraining(session, vocabMap)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start review session')
      setLoading(false)
    }
  }

  async function handleStart(existingSession?: Session) {
    setLoading(true)
    setError(null)

    try {
      let session: Session

      if (existingSession !== undefined) {
        session = existingSession
      } else {
        try {
          session = await sessionApi.createSession()
        } catch (err: unknown) {
          // 409 means an unstarted session already exists in the DB — fetch and reuse it.
          // This can happen when the browser tab has been open for a long time and the
          // HomeScreen's cached state is stale.
          if (err instanceof Error && err.message.includes(': 409')) {
            const open = await sessionApi.getOpenSession()

            if (open === null) {
              throw err
            }

            session = open
          } else {
            throw err
          }
        }
      }

      const entries = await vocabApi.listVocab()
      const vocabMap = new Map(entries.map((e) => [e.id, e]))

      onStartTraining(session, vocabMap)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start session')
      setLoading(false)
    }
  }

  if (openSession === undefined) {
    return <p>Loading…</p>
  }

  const pause = streak?.pause ?? null
  const now = new Date()
  const todayStr = now.toLocaleDateString('en-CA')
  const yesterdayDate = new Date(now)
  yesterdayDate.setDate(now.getDate() - 1)
  const yesterdayStr = yesterdayDate.toLocaleDateString('en-CA')
  const lastDate = streak?.lastSessionDate ?? null
  const practicedToday = lastDate !== null && lastDate === todayStr

  return (
    <>
      {starsOffer !== null && credits !== null && (
        <StarsPurchaseDialog
          offer={starsOffer}
          credits={credits}
          onPurchase={handleStarsPurchase}
          onSnooze={handleStarsSnooze}
        />
      )}

      {showPauseConfirmDialog && pause !== null && !pause.active && (
        <PauseConfirmDialog
          pauseInfo={pause}
          onConfirm={handleActivatePause}
          onCancel={() => { setShowPauseConfirmDialog(false) }}
        />
      )}

      <div className={styles.screen}>
        <h1 className={styles.title}>Home</h1>

      {pause?.active === true && (
        <div className={styles.statusBanner}>
          <p role="status">
            Game paused since {pause.startDate ?? '—'} — {pause.daysToCharge} {pause.daysToCharge === 1 ? 'day' : 'days'} charged
            {' '}({pause.budgetRemaining} of {streakApi.PAUSE_BUDGET_DAYS} pause days remaining this year)
          </p>
          <button onClick={() => void handleResumePause()} disabled={loading}>
            Resume game
          </button>
        </div>
      )}

      {streak?.saveAvailable === true ? (
        <div className={styles.statusBanner}>
          <p role="status">Your streak is at risk! Save it for 200 credits.</p>
          <div>
            <button
              onClick={() => void handleSaveStreak()}
              disabled={loading || credits === null || credits < 200}
            >
              Save streak (200 credits)
            </button>
          </div>
        </div>
      ) : streak !== null && pause?.active !== true && isEveningStreakWarning(streak.lastSessionDate, new Date()) ? (
        <div className={styles.statusBanner}>
          <p role="status">Your streak is at risk! Start a session now to save it.</p>
        </div>
      ) : lastDate !== null ? (
        <div className={styles.infoBanner}>
          {practicedToday
            ? <p>You have practiced today. <span className={styles.checkmark}>✓</span></p>
            : <p>Last practiced: {lastDate === yesterdayStr ? 'Yesterday' : formatSessionDate(lastDate)} — don't forget today's session!</p>
          }
        </div>
      ) : null}

      {error !== null && <p className={styles.error} role="alert">{error}</p>}

      {pause?.active !== true && (
        <div className={styles.actions}>
          {openSession !== null && <p>You have a session in progress.</p>}
          <div className={styles.sessionButtons}>
            {openSession !== null ? (
              <button className={styles.primaryButton} onClick={() => void handleStart(openSession)} disabled={loading}>
                Continue session
              </button>
            ) : (
              <button className={styles.primaryButton} onClick={() => void handleStart()} disabled={loading || hasVocab === false}>
                Start new session
              </button>
            )}
            {hasVocab === false && (
              <p className={styles.emptyVocabHint}>No words in vocabulary — import some words to get started.</p>
            )}
            <button
              className={styles.secondaryButton}
              onClick={() => void handleStartStarred()}
              disabled={loading || starredAvailable?.available !== true}
            >
              Start ★ session
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => void handleStartReview()}
              disabled={loading || reviewAvailable?.available !== true}
              title={
                reviewAvailable?.available === true
                  ? `Replay the ${String(reviewAvailable.wordCount)} words from your last regular session`
                  : 'No completed regular session available to review'
              }
            >
              Start review session
            </button>
          </div>
        </div>
      )}

      {pause !== null && !pause.active && streak !== null && streak.count > 0 && (
        <div className={styles.pauseBox}>
          <p>
            Pause budget: {pause.budgetRemaining} of {streakApi.PAUSE_BUDGET_DAYS} days remaining this year
            {pause.daysToCharge > 0 && <> — activating now will charge {pause.daysToCharge} {pause.daysToCharge === 1 ? 'day' : 'days'} retroactively</>}
          </p>
          <div>
            <button
              onClick={() => { setShowPauseConfirmDialog(true) }}
              disabled={loading}
            >
              Pause game
            </button>
          </div>
        </div>
      )}
      </div>
    </>
  )
}
