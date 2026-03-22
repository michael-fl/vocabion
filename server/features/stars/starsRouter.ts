/**
 * Express router for the stars purchase API (`/api/v1/stars`).
 *
 * Endpoints:
 * - `GET  /offer`    — returns whether the buy-stars dialog should be shown.
 * - `POST /purchase` — deducts credits, awards stars, snoozes the offer.
 * - `POST /snooze`   — snoozes the offer without a purchase (user declined).
 *
 * @example
 * ```ts
 * app.use('/api/v1/stars', createStarsRouter(starsService))
 * ```
 */
import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'

import { purchaseStarsSchema } from '../../validation/starsSchemas.ts'
import type { StarsService } from './StarsService.ts'

function getTodayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Creates and returns the stars router.
 * @param starsService - Fully constructed service instance.
 */
export function createStarsRouter(starsService: StarsService): Router {
  const router = Router()

  /** Returns the offer state: whether the dialog should be shown and how many stars are buyable. */
  router.get('/offer', (_req: Request, res: Response) => {
    const today = getTodayUtc()

    res.json(starsService.getOffer(today))
  })

  /** Purchases stars: deducts credits, adds stars, snoozes the offer for 7 days. */
  router.post('/purchase', (req: Request, res: Response, next: NextFunction) => {
    const result = purchaseStarsSchema.safeParse(req.body)

    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    try {
      const today = getTodayUtc()
      const purchaseResult = starsService.purchaseStars(result.data.count, today)

      res.json(purchaseResult)
    } catch (err) {
      next(err)
    }
  })

  /** Snoozes the offer for 7 days without purchasing (user declined or aborted). */
  router.post('/snooze', (_req: Request, res: Response) => {
    const today = getTodayUtc()

    starsService.snooze(today)

    res.json({ snoozedUntil: today })
  })

  return router
}
