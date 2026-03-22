/**
 * Business logic for the "buy stars" feature.
 *
 * Stars are cosmetic prestige items purchasable with credits. Each star costs
 * 500 credits. Up to 3 stars can be bought per dialog invocation. The offer
 * dialog is suppressed for 7 days after any interaction (purchase, decline, or
 * abort).
 *
 * @example
 * ```ts
 * const service = new StarsService(creditsRepo)
 * const offer = service.getOffer('2026-03-22')
 * if (offer.shouldOffer) {
 *   const result = service.purchaseStars(2, '2026-03-22')
 *   console.log(result.stars, result.credits)
 * }
 * ```
 */
import type { CreditsRepository } from '../credits/CreditsRepository.ts'

/** Credits charged per purchased star. */
export const STAR_COST_CREDITS = 500

/** Maximum stars purchasable in a single dialog interaction. */
export const MAX_STARS_PER_OFFER = 3

/** Days to suppress the offer after any interaction. */
export const STARS_OFFER_SNOOZE_DAYS = 7

/** Payload returned by `getOffer`. */
export interface StarOffer {
  /** Whether the dialog should be shown right now. */
  shouldOffer: boolean
  /** Maximum number of stars the user can buy this time (0 when shouldOffer is false). */
  maxBuyable: number
  /** Credits charged per star. */
  costPerStar: number
}

/** Payload returned by `purchaseStars`. */
export interface StarPurchaseResult {
  /** Updated total earned stars. */
  stars: number
  /** Remaining credit balance after deduction. */
  credits: number
}

/** Adds `n` UTC days to a `YYYY-MM-DD` date string. */
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)

  d.setUTCDate(d.getUTCDate() + n)

  return d.toISOString().slice(0, 10)
}

export class StarsService {
  constructor(private readonly creditsRepo: CreditsRepository) {}

  /**
   * Returns whether the buy-stars dialog should be shown and how many stars
   * the user can purchase.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   */
  getOffer(today: string): StarOffer {
    const snoozedUntil = this.creditsRepo.getStarsOfferSnoozedUntil()
    const isSnoozed = snoozedUntil !== null && today < snoozedUntil
    const isPaused = this.creditsRepo.getPauseState().active
    const balance = this.creditsRepo.getBalance()

    if (isSnoozed || isPaused || balance < STAR_COST_CREDITS) {
      return { shouldOffer: false, maxBuyable: 0, costPerStar: STAR_COST_CREDITS }
    }

    const maxBuyable = Math.min(Math.floor(balance / STAR_COST_CREDITS), MAX_STARS_PER_OFFER)

    return { shouldOffer: true, maxBuyable, costPerStar: STAR_COST_CREDITS }
  }

  /**
   * Deducts `count * STAR_COST_CREDITS` credits, adds `count` stars, and
   * snoozes the offer for `STARS_OFFER_SNOOZE_DAYS` days.
   *
   * @param count - Number of stars to buy (1–MAX_STARS_PER_OFFER).
   * @param today - Current UTC date as `YYYY-MM-DD`.
   * @throws Error when the purchase is invalid (insufficient credits, count out of range).
   */
  purchaseStars(count: number, today: string): StarPurchaseResult {
    if (count < 1 || count > MAX_STARS_PER_OFFER) {
      throw new Error(`Star count must be between 1 and ${MAX_STARS_PER_OFFER}`)
    }

    const cost = count * STAR_COST_CREDITS
    const balance = this.creditsRepo.getBalance()

    if (balance < cost) {
      throw new Error(`Insufficient credits: need ${cost}, have ${balance}`)
    }

    this.creditsRepo.addBalance(-cost)
    this.creditsRepo.addStars(count)
    this.creditsRepo.setStarsOfferSnoozedUntil(addDays(today, STARS_OFFER_SNOOZE_DAYS))

    return {
      stars: this.creditsRepo.getEarnedStars(),
      credits: this.creditsRepo.getBalance(),
    }
  }

  /**
   * Snoozes the offer for `STARS_OFFER_SNOOZE_DAYS` days without a purchase.
   * Called when the user declines or aborts the dialog.
   *
   * @param today - Current UTC date as `YYYY-MM-DD`.
   */
  snooze(today: string): void {
    this.creditsRepo.setStarsOfferSnoozedUntil(addDays(today, STARS_OFFER_SNOOZE_DAYS))
  }
}
