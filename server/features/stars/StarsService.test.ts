// @vitest-environment node

/**
 * Tests for StarsService.
 */
import { describe, it, expect, beforeEach } from 'vitest'

import { FakeCreditsRepository } from '../../test-utils/FakeCreditsRepository.ts'
import { StarsService, STAR_COST_CREDITS, MAX_STARS_PER_OFFER, STARS_OFFER_SNOOZE_DAYS } from './StarsService.ts'

const TODAY = '2026-03-22'
const SNOOZE_DATE = '2026-03-29' // TODAY + 7 days

let repo: FakeCreditsRepository
let service: StarsService

beforeEach(() => {
  repo = new FakeCreditsRepository()
  service = new StarsService(repo)
})

// ── getOffer ──────────────────────────────────────────────────────────────────

describe('StarsService.getOffer', () => {
  it('returns shouldOffer false when balance is below 500', () => {
    repo.addBalance(499)

    const offer = service.getOffer(TODAY)

    expect(offer.shouldOffer).toBe(false)
    expect(offer.maxBuyable).toBe(0)
  })

  it('returns shouldOffer true when balance is exactly 500', () => {
    repo.addBalance(500)

    const offer = service.getOffer(TODAY)

    expect(offer.shouldOffer).toBe(true)
    expect(offer.maxBuyable).toBe(1)
  })

  it('caps maxBuyable at MAX_STARS_PER_OFFER regardless of balance', () => {
    repo.addBalance(10_000)

    const offer = service.getOffer(TODAY)

    expect(offer.maxBuyable).toBe(MAX_STARS_PER_OFFER)
  })

  it('computes maxBuyable as floor(balance / 500)', () => {
    repo.addBalance(1499)

    const offer = service.getOffer(TODAY)

    expect(offer.maxBuyable).toBe(2) // 1499 / 500 = 2.998 → 2
  })

  it('returns shouldOffer false when snoozed until a future date', () => {
    repo.addBalance(1000)
    repo.setStarsOfferSnoozedUntil('2026-03-30') // future

    const offer = service.getOffer(TODAY)

    expect(offer.shouldOffer).toBe(false)
  })

  it('returns shouldOffer true on the snooze expiry date itself', () => {
    repo.addBalance(1000)
    repo.setStarsOfferSnoozedUntil(TODAY) // today is on/after snooze date

    const offer = service.getOffer(TODAY)

    expect(offer.shouldOffer).toBe(true)
  })

  it('returns shouldOffer false when game is paused', () => {
    repo.addBalance(1000)
    repo.setPauseActive('2026-03-20')

    const offer = service.getOffer(TODAY)

    expect(offer.shouldOffer).toBe(false)
  })

  it('returns costPerStar equal to STAR_COST_CREDITS', () => {
    repo.addBalance(1000)

    const offer = service.getOffer(TODAY)

    expect(offer.costPerStar).toBe(STAR_COST_CREDITS)
  })
})

// ── purchaseStars ─────────────────────────────────────────────────────────────

describe('StarsService.purchaseStars', () => {
  it('deducts the correct number of credits', () => {
    repo.addBalance(1500)

    service.purchaseStars(2, TODAY)

    expect(repo.getBalance()).toBe(500) // 1500 - 1000
  })

  it('increments earned_stars by the purchased count', () => {
    repo.addBalance(1500)
    repo.awardStars(3) // pre-existing stars

    service.purchaseStars(2, TODAY)

    expect(repo.getEarnedStars()).toBe(5)
  })

  it('sets the snooze date to today + STARS_OFFER_SNOOZE_DAYS', () => {
    repo.addBalance(1000)

    service.purchaseStars(1, TODAY)

    expect(repo.getStarsOfferSnoozedUntil()).toBe(SNOOZE_DATE)
  })

  it('returns the updated stars and credits', () => {
    repo.addBalance(1500)

    const result = service.purchaseStars(2, TODAY)

    expect(result.credits).toBe(500)
    expect(result.stars).toBe(2)
  })

  it('throws when count is 0', () => {
    repo.addBalance(1000)

    expect(() => service.purchaseStars(0, TODAY)).toThrow()
  })

  it('throws when count exceeds MAX_STARS_PER_OFFER', () => {
    repo.addBalance(10_000)

    expect(() => service.purchaseStars(MAX_STARS_PER_OFFER + 1, TODAY)).toThrow()
  })

  it('throws when balance is insufficient', () => {
    repo.addBalance(499)

    expect(() => service.purchaseStars(1, TODAY)).toThrow(/Insufficient credits/)
  })

  it('snoozes the offer even after a purchase so it does not appear again this week', () => {
    repo.addBalance(3000)

    service.purchaseStars(3, TODAY)

    const offer = service.getOffer(TODAY)

    expect(offer.shouldOffer).toBe(false)
  })
})

// ── snooze ────────────────────────────────────────────────────────────────────

describe('StarsService.snooze', () => {
  it(`sets snoozedUntil to today + ${STARS_OFFER_SNOOZE_DAYS} days`, () => {
    service.snooze(TODAY)

    expect(repo.getStarsOfferSnoozedUntil()).toBe(SNOOZE_DATE)
  })

  it('suppresses the offer after snoozing', () => {
    repo.addBalance(1000)

    service.snooze(TODAY)

    const offer = service.getOffer(TODAY)

    expect(offer.shouldOffer).toBe(false)
  })

  it('re-enables the offer on the snooze expiry date', () => {
    repo.addBalance(1000)

    service.snooze(TODAY)

    const offer = service.getOffer(SNOOZE_DATE) // exactly 7 days later

    expect(offer.shouldOffer).toBe(true)
  })
})
