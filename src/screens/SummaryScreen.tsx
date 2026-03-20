/**
 * End-of-session summary screen.
 *
 * Displays the number of correctly and incorrectly answered words from the
 * completed session. Second-chance words are counted separately so the user
 * can see both original and second-chance outcomes.
 *
 * @example
 * ```tsx
 * <SummaryScreen session={completedSession} onBack={() => setScreen('home')} />
 * ```
 */
import type { Session } from '../../shared/types/Session.ts'

export interface SummaryScreenProps {
  session: Session
  /** Credits deducted for wrong answers: 1 per incorrect word, capped at available balance. */
  sessionCost: number
  /** Credits earned during this session from word promotions. */
  creditsEarned: number
  /** Credits spent on hints during this session. */
  creditsSpent: number
  /** Bonus credits for a perfect session (no mistakes, no second chances). 10 or 0. */
  perfectBonus: number
  /** Streak-related credits awarded: 1 (daily) or the milestone amount. 0 if none. */
  streakCredit: number
  /** Label of the streak milestone reached this session, e.g. 'Week 1'. Absent if none. */
  milestoneLabel?: string
  onBack: () => void
}

/** Renders a summary of a completed training session. */
export function SummaryScreen({ session, sessionCost, creditsEarned, creditsSpent, perfectBonus, streakCredit, milestoneLabel, onBack }: SummaryScreenProps) {
  const originalWords = session.words.filter((w) => w.secondChanceFor === undefined)
  const secondChanceWords = session.words.filter((w) => w.secondChanceFor !== undefined)

  const originalCorrect = originalWords.filter((w) => w.status === 'correct').length
  const originalIncorrect = originalWords.filter((w) => w.status === 'incorrect').length

  const secondChanceCorrect = secondChanceWords.filter((w) => w.status === 'correct').length
  const secondChanceIncorrect = secondChanceWords.filter((w) => w.status === 'incorrect').length

  return (
    <div>
      <h1>Session complete</h1>

      <h2>Results</h2>

      <p>
        Correct: {originalCorrect} / {originalWords.length}
      </p>

      <p>
        Incorrect: {originalIncorrect} / {originalWords.length}
      </p>

      <p>
        Credits earned: +{creditsEarned} credit{creditsEarned !== 1 ? 's' : ''}
      </p>

      <p>
        Credits spent: −{creditsSpent} credit{creditsSpent !== 1 ? 's' : ''}
      </p>

      <p>
        Session cost: −{sessionCost} credit{sessionCost !== 1 ? 's' : ''}
      </p>

      {perfectBonus > 0 && (
        <p>
          Perfect session bonus: +{perfectBonus} credits
        </p>
      )}

      {streakCredit > 0 && milestoneLabel !== undefined && (
        <p>
          Streak milestone: {milestoneLabel}! +{streakCredit} credits
        </p>
      )}

      {streakCredit > 0 && milestoneLabel === undefined && (
        <p>
          Daily streak bonus: +{streakCredit} credits
        </p>
      )}

      <p>
        Total: {creditsEarned - creditsSpent - sessionCost + perfectBonus + streakCredit} credit{(creditsEarned - creditsSpent - sessionCost + perfectBonus + streakCredit) !== 1 ? 's' : ''}
      </p>

      {secondChanceWords.length > 0 && (
        <div>
          <h2>Second-chance words</h2>

          <p>
            Correct: {secondChanceCorrect} / {secondChanceWords.length}
          </p>

          <p>
            Incorrect: {secondChanceIncorrect} / {secondChanceWords.length}
          </p>
        </div>
      )}

      <button onClick={onBack}>Back to home</button>
    </div>
  )
}
