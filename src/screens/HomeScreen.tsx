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
import { useState, useEffect } from 'react'

import type { VocabEntry } from '../../shared/types/VocabEntry.ts'
import type { Session } from '../../shared/types/Session.ts'
import * as sessionApi from '../api/sessionApi.ts'
import * as vocabApi from '../api/vocabApi.ts'
import * as streakApi from '../api/streakApi.ts'
import { isEveningStreakWarning } from '../utils/streakWarning.ts'
import styles from './HomeScreen.module.css'

export interface HomeScreenProps {
  onStartTraining: (session: Session, vocabMap: Map<string, VocabEntry>) => void
  /** Called after pause/resume so the parent can refresh the streak state. */
  onStreakRefresh?: () => void
  /** Current credit balance — needed to enable/disable the streak-save button. */
  credits?: number | null
  /** Current streak count and save availability. Fetched externally so the header can share the state. */
  streak?: streakApi.StreakInfo | null
}

/**
 * Renders the home screen.
 * Calls `onStartTraining` once the session and vocab data are ready.
 */
export function HomeScreen({ onStartTraining, onStreakRefresh, credits = null, streak = null }: HomeScreenProps) {
  // undefined = still loading; null = no open session
  const [openSession, setOpenSession] = useState<Session | null | undefined>(undefined)
  // A session that exists but has 0 answered words — reused silently to avoid a 409 conflict
  const [unstartedSession, setUnstartedSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    sessionApi
      .getOpenSession()
      .then((session) => {
        if (session === null) {
          setOpenSession(null)
          return
        }

        const answeredCount = session.words.filter((w) => w.status !== 'pending').length
        const hasPending = session.words.some((w) => w.status === 'pending')

        if (answeredCount > 0 && hasPending) {
          // Truly in-progress: offer to continue
          setOpenSession(session)
        } else if (answeredCount === 0) {
          // Not started yet: show "Start new session" but reuse the existing session
          setUnstartedSession(session)
          setOpenSession(null)
        } else {
          // All words answered but session still open — stale, treat as none
          setOpenSession(null)
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load session')
        setOpenSession(null)
      })
  }, [])

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

  async function handleActivatePause() {
    setLoading(true)
    setError(null)

    try {
      await streakApi.activatePause()
      onStreakRefresh?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to activate pause')
    } finally {
      setLoading(false)
    }
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

  async function handleStart(existingSession?: Session) {
    setLoading(true)
    setError(null)

    try {
      const [session, entries] = await Promise.all([
        existingSession ?? unstartedSession ?? sessionApi.createSession(),
        vocabApi.listVocab(),
      ])

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

  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>Home</h1>

      {streak !== null && (
        <p className={styles.streakLine}>
          Current streak: {streak.count} {streak.count === 1 ? 'day' : 'days'}
        </p>
      )}

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

      {pause !== null && !pause.active && streak !== null && streak.count > 0 && (
        <div className={styles.infoBanner}>
          <p>
            Pause budget: {pause.budgetRemaining} of {streakApi.PAUSE_BUDGET_DAYS} days remaining this year
            {pause.daysToCharge > 0 && <> — activating now will charge {pause.daysToCharge} {pause.daysToCharge === 1 ? 'day' : 'days'} retroactively</>}
          </p>
          <div>
            <button
              onClick={() => void handleActivatePause()}
              disabled={loading || pause.daysToCharge > pause.budgetRemaining}
            >
              {pause.daysToCharge > 0
                ? `Pause game (charges ${pause.daysToCharge} ${pause.daysToCharge === 1 ? 'day' : 'days'})`
                : 'Pause game'}
            </button>
          </div>
          {pause.daysToCharge > pause.budgetRemaining && (
            <p role="alert">Insufficient pause budget: need {pause.daysToCharge} days, have {pause.budgetRemaining} remaining.</p>
          )}
        </div>
      )}

      {streak?.saveAvailable === true && (
        <div className={styles.statusBanner}>
          <p role="status">Your streak is at risk! Save it for 50 credits.</p>
          <div>
            <button
              onClick={() => void handleSaveStreak()}
              disabled={loading || credits === null || credits < 50}
            >
              Save streak (50 credits)
            </button>
          </div>
        </div>
      )}

      {streak !== null && !streak.saveAvailable && pause?.active !== true && isEveningStreakWarning(streak.lastSessionDate, new Date()) && (
        <p role="status">Your streak is at risk! Start a session now to save it.</p>
      )}

      {error !== null && <p className={styles.error} role="alert">{error}</p>}

      {pause?.active !== true && (
        <div className={styles.actions}>
          {openSession !== null ? (
            <>
              <p>You have a session in progress.</p>
              <button onClick={() => void handleStart(openSession)} disabled={loading}>
                Continue session
              </button>
            </>
          ) : (
            <button onClick={() => void handleStart()} disabled={loading}>
              Start new session
            </button>
          )}
        </div>
      )}
    </div>
  )
}
