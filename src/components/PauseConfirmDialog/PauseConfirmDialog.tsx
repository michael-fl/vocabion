/**
 * Confirmation dialog shown before activating pause mode.
 *
 * Displays context-sensitive information depending on whether the budget
 * is sufficient to cover all missed days (Fall A) or not (Fall B):
 *
 * - **Fall A**: informs the user how many days will be retroactively charged.
 * - **Fall B**: warns the user that missed days cannot be covered and will be
 *   lost from the streak; the pause will start from today instead.
 *
 * The Cancel button lets the user abort — useful when they hoped to save
 * the streak rather than truly wanting a vacation pause.
 *
 * @example
 * ```tsx
 * <PauseConfirmDialog
 *   pauseInfo={streak.pause}
 *   onConfirm={handleActivatePause}
 *   onCancel={() => setShowPauseDialog(false)}
 * />
 * ```
 */
import { useState } from 'react'

import type { PauseInfo } from '../../api/streakApi.ts'
import { PAUSE_BUDGET_DAYS } from '../../api/streakApi.ts'
import styles from './PauseConfirmDialog.module.css'

export interface PauseConfirmDialogProps {
  pauseInfo: PauseInfo
  /** Called when the user confirms — should call the pause API. */
  onConfirm: () => Promise<void>
  /** Called when the user cancels or the dialog should close. */
  onCancel: () => void
}

/** Renders the pause confirmation dialog. */
export function PauseConfirmDialog({ pauseInfo, onConfirm, onCancel }: PauseConfirmDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isFallB = pauseInfo.daysToCharge > pauseInfo.budgetRemaining
  const streakDaysLost = isFallB ? pauseInfo.daysToCharge : 0

  async function handleConfirm() {
    setLoading(true)
    setError(null)

    try {
      await onConfirm()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to activate pause')
      setLoading(false)
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog} role="dialog" aria-modal="true">
        <p className={styles.heading}>Pause game</p>

        {isFallB ? (
          <p className={styles.body}>
            Your pause budget ({pauseInfo.budgetRemaining} of {PAUSE_BUDGET_DAYS} days remaining) is
            insufficient to cover the {streakDaysLost} missed {streakDaysLost === 1 ? 'day' : 'days'} since
            your last session. {streakDaysLost === 1 ? 'That day' : 'Those days'} cannot be protected and
            will be lost from your streak. The pause will start from today.
          </p>
        ) : pauseInfo.daysToCharge > 0 ? (
          <p className={styles.body}>
            Activating the pause will charge {pauseInfo.daysToCharge} {pauseInfo.daysToCharge === 1 ? 'day' : 'days'} retroactively
            from your pause budget ({pauseInfo.budgetRemaining} of {PAUSE_BUDGET_DAYS} remaining).
            Your streak will be preserved.
          </p>
        ) : (
          <p className={styles.body}>
            Starting the pause will protect your streak from today onwards.
            Your streak will be fully preserved.
          </p>
        )}

        {error !== null && <p className={styles.error} role="alert">{error}</p>}

        <div className={styles.actions}>
          <button className={styles.primaryButton} onClick={() => void handleConfirm()} disabled={loading}>
            Pause game
          </button>
          <button className={styles.secondaryButton} onClick={onCancel} disabled={loading}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
