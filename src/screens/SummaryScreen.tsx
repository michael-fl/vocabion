/**
 * End-of-session summary screen.
 *
 * Displays the number of correctly and incorrectly answered words from the
 * completed session. Second-chance words are counted separately so the user
 * can see both original and second-chance outcomes.
 *
 * For focus sessions the screen may offer a "Play again" button:
 * - After the original session: shown when error rate ≥ 25% (`replayCount` = 0).
 * - After Replay 1: shown when at least 1 answer was incorrect (`replayCount` = 1).
 * - After Replay 2 (`replayCount` ≥ 2): no further offer.
 *
 * @example
 * ```tsx
 * <SummaryScreen session={completedSession} onBack={() => setScreen('home')} />
 * ```
 */
import type { Session } from '../../shared/types/Session.ts'
import styles from './SummaryScreen.module.css'

/** Error rate threshold above which the Focus Replay offer is shown. */
const REPLAY_ERROR_THRESHOLD = 0.25

export interface SummaryScreenProps {
  session: Session
  /** Credits deducted for wrong answers: 1 per incorrect word, capped at available balance. */
  sessionCost: number
  /** Credits earned during this session from word promotions. */
  creditsEarned: number
  /** Credits spent on hints during this session. */
  creditsSpent: number
  /** Bonus credits for a perfect session (no mistakes, no hints, no second chances). 10 or 0. */
  perfectBonus: number
  /** Streak-related credits awarded: 1 (daily) or the milestone amount. 0 if none. */
  streakCredit: number
  /** Label of the streak milestone reached this session, e.g. 'Week 1'. Absent if none. */
  milestoneLabel?: string
  /** Bonus credits earned by promoting a word to a new maximum bucket ≥ 6. 0 if none. */
  bucketMilestoneBonus?: number
  /**
   * When present, renders a "Play again" button below the summary for eligible
   * focus sessions. Called when the user accepts the replay offer.
   */
  onReplay?: () => void
  /**
   * How many focus replays have already been played for this original session.
   * - `0` (default): this is the original session — offer replay if error rate ≥ 25%.
   * - `1`: this is Replay 1 — offer Replay 2 if at least 1 answer was incorrect.
   * - `2+`: no further replay is offered.
   */
  replayCount?: number
  onBack: () => void
}

/** Renders a summary of a completed training session. */
export function SummaryScreen({ session, sessionCost, creditsEarned, creditsSpent, perfectBonus, streakCredit, milestoneLabel, bucketMilestoneBonus = 0, onReplay, replayCount = 0, onBack }: SummaryScreenProps) {
  const isStress = session.type === 'stress'
  const sessionLabel = session.type === 'stress' ? 'Stress Session complete' : 'Session complete'
  const originalWords = session.words.filter((w) => w.secondChanceFor === undefined)
  const secondChanceWords = session.words.filter((w) => w.secondChanceFor !== undefined)

  const originalCorrect = originalWords.filter((w) => w.status === 'correct').length
  const originalIncorrect = originalWords.filter((w) => w.status === 'incorrect').length

  const secondChanceCorrect = secondChanceWords.filter((w) => w.status === 'correct').length
  const secondChanceIncorrect = secondChanceWords.filter((w) => w.status === 'incorrect').length

  const total = creditsEarned - creditsSpent - sessionCost + perfectBonus + streakCredit

  const errorRate = originalWords.length > 0 ? originalIncorrect / originalWords.length : 0

  let showReplayOffer = false

  if (session.type === 'focus' && onReplay !== undefined) {
    if (replayCount === 0) {
      showReplayOffer = errorRate >= REPLAY_ERROR_THRESHOLD
    } else if (replayCount === 1) {
      showReplayOffer = originalIncorrect >= 1
    }
  }

  return (
    <div className={styles.screen}>
      <h1 className={styles.heading}>{sessionLabel}</h1>

      {bucketMilestoneBonus > 0 && (
        <div className={styles.bucketMilestoneBanner} role="status">
          <span className={styles.bucketMilestoneBadge}>New personal best!</span>
          <p className={styles.bucketMilestoneText}>
            You promoted a word to a record-high bucket for the first time.
          </p>
          <p className={styles.bucketMilestoneBonus}>+{bucketMilestoneBonus} bonus credits</p>
        </div>
      )}

      {perfectBonus > 0 && (
        <div className={styles.perfectBanner} role="status">
          <span className={styles.perfectBadge}>Perfect session!</span>
          <p className={styles.perfectText}>
            All words answered correctly on the first try — no mistakes, no hints, no second chances.
          </p>
          <p className={styles.perfectBonus}>+{perfectBonus} bonus credits</p>
        </div>
      )}

      <div className={styles.card}>
        <h2 className={styles.cardHeading}>Results</h2>

        <div className={styles.statRowGroup}>
          <p className={styles.statRow}>
            Correct: {originalCorrect} / {originalWords.length}
          </p>

          <p className={styles.statRow}>
            Incorrect: {originalIncorrect} / {originalWords.length}
          </p>
        </div>
      </div>

      <div className={styles.card}>
        <h2 className={styles.cardHeading}>Credits</h2>

        <div className={styles.statRowGroup}>
          {!isStress && (
            <p className={styles.statRow}>
              Credits earned: +{creditsEarned} credit{creditsEarned !== 1 ? 's' : ''}
            </p>
          )}

          {!isStress && (
            <p className={styles.statRow}>
              Credits spent: −{creditsSpent} credit{creditsSpent !== 1 ? 's' : ''}
            </p>
          )}

          <p className={styles.statRow}>
            Session cost: −{sessionCost} credit{sessionCost !== 1 ? 's' : ''}
          </p>

          {perfectBonus > 0 && (
            <p className={styles.statRow}>
              Perfect session bonus: +{perfectBonus} credits
            </p>
          )}

          {streakCredit > 0 && milestoneLabel !== undefined && (
            <p className={styles.statRow}>
              Streak milestone: {milestoneLabel}! +{streakCredit} credits
            </p>
          )}

          {streakCredit > 0 && milestoneLabel === undefined && (
            <p className={styles.statRow}>
              Daily streak bonus: +{streakCredit} credits
            </p>
          )}
        </div>

        <hr className={styles.divider} />

        <p className={styles.statRowTotal}>
          Total: {total} credit{total !== 1 ? 's' : ''}
        </p>
      </div>

      {secondChanceWords.length > 0 && (
        <div className={styles.card}>
          <h2 className={styles.cardHeading}>Second-chance words</h2>

          <div className={styles.statRowGroup}>
            <p className={styles.statRow}>
              Correct: {secondChanceCorrect} / {secondChanceWords.length}
            </p>

            <p className={styles.statRow}>
              Incorrect: {secondChanceIncorrect} / {secondChanceWords.length}
            </p>
          </div>
        </div>
      )}

      {showReplayOffer && (
        <div className={styles.replaySection}>
          <p className={styles.replayText}>
            {replayCount === 0
              ? `You got ${originalIncorrect} out of ${originalWords.length} wrong — want to try again?`
              : `You still got ${originalIncorrect} wrong — want one last try?`}
          </p>

          <button className={styles.replayButton} onClick={onReplay}>Play again</button>
        </div>
      )}

      <button className={styles.backButton} onClick={onBack}>Back to home</button>
    </div>
  )
}
