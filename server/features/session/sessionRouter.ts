/**
 * Express router for training session endpoints.
 *
 * All routes are mounted at `/api/v1/session` by the app factory in `server/app.ts`.
 *
 * Routes:
 * - `GET  /open`                          → get the currently open session (null if none)
 * - `POST /`                              → create a new session
 * - `POST /:id/answer`                    → submit an answer for the current word
 * - `POST /:id/words/:vocabId/correct`    → retroactively mark a word as correct
 * - `POST /:id/replay`                    → create a replay from a completed focus or starred session
 *
 * @example
 * ```ts
 * app.use('/api/v1/session', createSessionRouter(sessionService))
 * ```
 */
import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'

import { createSessionSchema, createStarredSessionSchema, submitAnswerSchema } from '../../validation/sessionSchemas.ts'
import type { SessionService } from './sessionService.ts'

export function createSessionRouter(service: SessionService): Router {
  const router = Router()

  // GET /starred-available — must come before /:id routes to avoid param conflict
  router.get('/starred-available', (_req: Request, res: Response) => {
    res.json(service.getStarredSessionAvailable())
  })

  // POST /starred
  router.post('/starred', (req: Request, res: Response, next: NextFunction) => {
    const result = createStarredSessionSchema.safeParse(req.body)

    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    try {
      res.status(201).json(service.createStarredSession(result.data.direction))
    } catch (err) {
      next(err)
    }
  })

  // GET /open — must come before /:id/answer to avoid param conflict
  router.get('/open', (_req: Request, res: Response) => {
    const session = service.getOpenSession()

    res.json({ session: session ?? null })
  })

  // POST /
  router.post('/', (req: Request, res: Response, next: NextFunction) => {
    const result = createSessionSchema.safeParse(req.body)

    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    try {
      res.status(201).json(service.createSession(result.data))
    } catch (err) {
      next(err)
    }
  })

  // POST /:id/answer
  router.post('/:id/answer', (req: Request, res: Response, next: NextFunction) => {
    const result = submitAnswerSchema.safeParse(req.body)

    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    try {
      const { vocabId, answers, hintsUsed } = result.data
      res.json(service.submitAnswer(req.params.id, vocabId, answers, hintsUsed))
    } catch (err) {
      next(err)
    }
  })

  // POST /:id/words/:vocabId/correct
  router.post('/:id/words/:vocabId/correct', (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(service.markWordCorrect(req.params.id, req.params.vocabId))
    } catch (err) {
      next(err)
    }
  })

  // POST /:id/words/:vocabId/pushback
  router.post('/:id/words/:vocabId/pushback', (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(service.pushBackWord(req.params.id, req.params.vocabId))
    } catch (err) {
      next(err)
    }
  })

  // POST /:id/replay
  router.post('/:id/replay', (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(201).json(service.createReplaySession(req.params.id))
    } catch (err) {
      next(err)
    }
  })

  return router
}
