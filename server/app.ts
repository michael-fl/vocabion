/**
 * Express application factory.
 *
 * Wires together middleware, routers, and the error handler without starting
 * the HTTP server. Keeping the app creation separate from `listen()` makes the
 * app importable in integration tests without binding to a port.
 *
 * @example
 * ```ts
 * // server/index.ts
 * const app = createApp({ vocab: vocabService, session: sessionService })
 * app.listen(3000)
 *
 * // In a test
 * const app = createApp({ vocab: vocabService, session: sessionService })
 * const res = await supertest(app).get('/api/v1/vocab')
 * ```
 */
import express from 'express'
import type { Express } from 'express'
import pinoHttp from 'pino-http'

import { logger } from './lib/logger.ts'
import { errorHandler } from './middleware/errorHandler.ts'
import { createVocabRouter } from './features/vocab/vocabRouter.ts'
import { createSessionRouter } from './features/session/sessionRouter.ts'
import { createStreakRouter } from './features/streak/streakRouter.ts'
import type { VocabService } from './features/vocab/vocabService.ts'
import type { SessionService } from './features/session/sessionService.ts'
import type { StreakService } from './features/streak/StreakService.ts'

export interface AppServices {
  vocab: VocabService
  session: SessionService
  streak: StreakService
}

/**
 * Creates and configures the Express application.
 *
 * @param services - Fully constructed service instances to inject into routers.
 * @returns Configured Express app (not yet listening).
 */
export function createApp(services: AppServices): Express {
  const app = express()

  app.use(pinoHttp({ logger }))
  app.use(express.json())

  app.use('/api/v1/vocab', createVocabRouter(services.vocab))
  app.use('/api/v1/session', createSessionRouter(services.session))
  app.use('/api/v1/streak', createStreakRouter(services.streak))

  app.use(errorHandler)

  return app
}
