/**
 * Express router for the streak API (`/api/v1/streak`).
 *
 * Endpoints:
 * - `GET  /`       — returns the current streak count and whether the streak can be saved.
 * - `POST /save`   — deducts 50 credits and enables a streak-save bridging session.
 * - `POST /pause`  — activates pause mode (retroactive from day after last session).
 * - `POST /resume` — deactivates pause mode and awards any milestones crossed during the pause.
 *
 * @example
 * ```ts
 * app.use('/api/v1/streak', createStreakRouter(streakService))
 * ```
 */
import { Router } from 'express'

import type { StreakService } from './StreakService.ts'

function getTodayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Creates and returns the streak router.
 * @param streakService - Fully constructed service instance.
 */
export function createStreakRouter(streakService: StreakService): Router {
  const router = Router()

  /** Returns the current streak count and save availability. */
  router.get('/', (_req, res) => {
    const today = getTodayUtc()
    const info = streakService.getStreak(today)

    res.json(info)
  })

  /**
   * Deducts 50 credits and sets the streak-save-pending flag.
   * The frontend must subsequently create a session; the streak is bridged
   * when the user answers the first question.
   */
  router.post('/save', (_req, res) => {
    const today = getTodayUtc()
    const newBalance = streakService.saveStreak(today)

    res.json({ balance: newBalance })
  })

  /**
   * Activates pause mode. The pause starts retroactively from the day after
   * the last session. Returns the updated PauseInfo.
   */
  router.post('/pause', (_req, res) => {
    const today = getTodayUtc()
    const pauseInfo = streakService.activatePause(today)

    res.json(pauseInfo)
  })

  /**
   * Deactivates pause mode, advances the streak, and awards any milestones
   * crossed during the pause. Returns credits awarded and milestone labels.
   */
  router.post('/resume', (_req, res) => {
    const today = getTodayUtc()
    const result = streakService.resumePause(today)

    res.json(result)
  })

  return router
}
