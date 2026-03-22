/**
 * Two-step dialog for purchasing cosmetic stars with credits.
 *
 * Step 1 — Confirm: asks whether the user wants to buy stars this week.
 * Step 2 — Select: shows buttons for 1..maxBuyable stars with the cost each.
 *
 * Clicking "No" in step 1, or "Cancel" in step 2, calls `onSnooze` and closes
 * the dialog without purchasing. Both actions suppress the offer for 7 days.
 *
 * @example
 * ```tsx
 * <StarsPurchaseDialog
 *   offer={{ shouldOffer: true, maxBuyable: 2, costPerStar: 500 }}
 *   credits={1545}
 *   onPurchase={(count) => handlePurchase(count)}
 *   onSnooze={() => handleSnooze()}
 * />
 * ```
 */
import { useState } from 'react'

import type { StarsOffer } from '../../api/starsApi.ts'
import styles from './StarsPurchaseDialog.module.css'

export interface StarsPurchaseDialogProps {
  offer: StarsOffer
  /** Current credit balance, shown in the confirm step. */
  credits: number
  /** Called with the chosen star count when the user confirms a purchase. */
  onPurchase: (count: number) => Promise<void>
  /** Called when the user declines or aborts without purchasing. */
  onSnooze: () => Promise<void>
}

/** Renders the two-step buy-stars dialog. */
export function StarsPurchaseDialog({ offer, credits, onPurchase, onSnooze }: StarsPurchaseDialogProps) {
  const [step, setStep] = useState<'confirm' | 'select'>('confirm')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleNo() {
    setLoading(true)
    setError(null)

    try {
      await onSnooze()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  async function handleCancel() {
    setLoading(true)
    setError(null)

    try {
      await onSnooze()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  async function handleBuy(count: number) {
    setLoading(true)
    setError(null)

    try {
      await onPurchase(count)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.dialog}>
        {step === 'confirm' ? (
          <>
            <h2 className={styles.heading}>Buy stars</h2>

            <p className={styles.body}>
              You have <strong>{credits.toLocaleString()} credits</strong>.
              Would you like to buy up to {offer.maxBuyable} {offer.maxBuyable === 1 ? 'star' : 'stars'} for{' '}
              {offer.costPerStar.toLocaleString()} credits each?
            </p>

            {error !== null && <p className={styles.error} role="alert">{error}</p>}

            <div className={styles.actions}>
              <button
                className={styles.primaryButton}
                onClick={() => { setStep('select') }}
                disabled={loading}
              >
                Yes
              </button>

              <button
                className={styles.secondaryButton}
                onClick={() => void handleNo()}
                disabled={loading}
              >
                No
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className={styles.heading}>How many stars?</h2>

            <p className={styles.body}>
              Each star costs {offer.costPerStar.toLocaleString()} credits.
            </p>

            {error !== null && <p className={styles.error} role="alert">{error}</p>}

            <div className={styles.starButtons}>
              {Array.from({ length: offer.maxBuyable }, (_, i) => i + 1).map((count) => {
                const cost = count * offer.costPerStar

                return (
                  <button
                    key={count}
                    className={styles.starOption}
                    onClick={() => void handleBuy(count)}
                    disabled={loading}
                  >
                    <span>{'★'.repeat(count)} {count} {count === 1 ? 'star' : 'stars'}</span>
                    <span>{cost.toLocaleString()} credits</span>
                  </button>
                )
              })}
            </div>

            <button
              className={styles.secondaryButton}
              onClick={() => void handleCancel()}
              disabled={loading}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  )
}
