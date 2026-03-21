/**
 * Express router for vocabulary CRUD and import/export endpoints.
 *
 * All routes are mounted at `/api/v1/vocab` by the app factory in `server/app.ts`.
 *
 * Routes:
 * - `GET    /`             → list all entries
 * - `GET    /export`       → export all entries as JSON
 * - `POST   /import`       → import entries from JSON
 * - `POST   /add-or-merge` → add new entry or merge into existing one
 * - `POST   /`             → create a new entry
 * - `PUT    /:id`          → update an entry
 * - `POST   /:id/set-bucket`  → set the SRS bucket of an entry
 * - `POST   /:id/set-marked`  → set the starred/marked status of an entry
 * - `DELETE /:id`          → delete an entry
 *
 * @example
 * ```ts
 * app.use('/api/v1/vocab', createVocabRouter(vocabService))
 * ```
 */
import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'

import { createVocabEntrySchema, updateVocabEntrySchema, importVocabSchema, addOrMergeVocabSchema, setBucketSchema, setMarkedSchema, spendCreditsSchema, refundCreditsSchema } from '../../validation/vocabSchemas.ts'
import type { VocabService } from './vocabService.ts'

export function createVocabRouter(service: VocabService): Router {
  const router = Router()

  // GET /export — must come before /:id
  router.get('/export', (_req: Request, res: Response) => {
    res.json(service.exportAll())
  })

  // GET /credits — must come before /:id
  router.get('/credits', (_req: Request, res: Response) => {
    res.json({ credits: service.getCredits(), stars: service.getEarnedStars() })
  })

  // POST /credits/spend — must come before /:id
  router.post('/credits/spend', (req: Request, res: Response, next: NextFunction) => {
    const result = spendCreditsSchema.safeParse(req.body)

    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    try {
      const credits = service.spendCredits(result.data)
      res.json({ credits })
    } catch (err) {
      next(err)
    }
  })

  // POST /credits/refund — must come before /:id
  router.post('/credits/refund', (req: Request, res: Response, next: NextFunction) => {
    const result = refundCreditsSchema.safeParse(req.body)

    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    try {
      const credits = service.refundCredits(result.data)
      res.json({ credits })
    } catch (err) {
      next(err)
    }
  })

  // POST /import — must come before /:id
  router.post('/import', (req: Request, res: Response, next: NextFunction) => {
    const result = importVocabSchema.safeParse(req.body)

    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    try {
      res.json(service.importEntries(result.data))
    } catch (err) {
      next(err)
    }
  })

  // POST /add-or-merge — must come before /:id
  router.post('/add-or-merge', (req: Request, res: Response, next: NextFunction) => {
    const result = addOrMergeVocabSchema.safeParse(req.body)

    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    try {
      res.json(service.addOrMerge(result.data))
    } catch (err) {
      next(err)
    }
  })

  // GET /
  router.get('/', (_req: Request, res: Response) => {
    res.json(service.listAll())
  })

  // POST /
  router.post('/', (req: Request, res: Response, next: NextFunction) => {
    const result = createVocabEntrySchema.safeParse(req.body)

    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    try {
      res.status(201).json(service.create(result.data))
    } catch (err) {
      next(err)
    }
  })

  // POST /:id/set-bucket
  router.post('/:id/set-bucket', (req: Request, res: Response, next: NextFunction) => {
    const result = setBucketSchema.safeParse(req.body)

    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    try {
      res.json(service.setBucket(req.params.id, result.data))
    } catch (err) {
      next(err)
    }
  })

  // POST /:id/set-marked
  router.post('/:id/set-marked', (req: Request, res: Response, next: NextFunction) => {
    const result = setMarkedSchema.safeParse(req.body)

    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    try {
      res.json(service.setMarked(req.params.id, result.data))
    } catch (err) {
      next(err)
    }
  })

  // PUT /:id
  router.put('/:id', (req: Request, res: Response, next: NextFunction) => {
    const result = updateVocabEntrySchema.safeParse(req.body)

    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    try {
      res.json(service.update(req.params.id, result.data))
    } catch (err) {
      next(err)
    }
  })

  // DELETE /:id
  router.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      service.delete(req.params.id)
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  })

  return router
}
