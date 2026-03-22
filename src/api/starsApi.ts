/**
 * HTTP client for the stars purchase API (`/api/v1/stars`).
 *
 * @example
 * ```ts
 * import { getStarsOffer, purchaseStars, snoozeStarsOffer } from './starsApi.ts'
 * const offer = await getStarsOffer()
 * if (offer.shouldOffer) {
 *   const result = await purchaseStars(2)
 *   console.log(result.stars, result.credits)
 * }
 * ```
 */

const BASE = '/api/v1/stars'

/** Returned by `getStarsOffer`. */
export interface StarsOffer {
  /** Whether the buy-stars dialog should be shown now. */
  shouldOffer: boolean
  /** Maximum stars buyable in this dialog (0 when shouldOffer is false). */
  maxBuyable: number
  /** Credits charged per star. */
  costPerStar: number
}

/** Returned by `purchaseStars`. */
export interface StarPurchaseResult {
  /** Updated total earned stars after the purchase. */
  stars: number
  /** Remaining credit balance after deduction. */
  credits: number
}

/** Returns whether the buy-stars offer dialog should be shown right now. */
export async function getStarsOffer(): Promise<StarsOffer> {
  const res = await fetch(`${BASE}/offer`)

  if (!res.ok) {
    throw new Error(`Failed to fetch stars offer: ${res.status}`)
  }

  return (await res.json()) as StarsOffer
}

/** Purchases `count` stars for `count * costPerStar` credits. Returns updated stars and credits. */
export async function purchaseStars(count: number): Promise<StarPurchaseResult> {
  const res = await fetch(`${BASE}/purchase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count }),
  })

  if (!res.ok) {
    throw new Error(`Failed to purchase stars: ${res.status}`)
  }

  return (await res.json()) as StarPurchaseResult
}

/** Snoozes the offer for 7 days without purchasing (user declined or aborted). */
export async function snoozeStarsOffer(): Promise<void> {
  const res = await fetch(`${BASE}/snooze`, { method: 'POST' })

  if (!res.ok) {
    throw new Error(`Failed to snooze stars offer: ${res.status}`)
  }
}
