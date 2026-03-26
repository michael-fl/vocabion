/**
 * Server entry point.
 *
 * Opens the SQLite database, runs migrations, wires repositories → services →
 * routers, and starts the HTTP server.
 *
 * Environment variables:
 * - `PORT`    — HTTP port (default 3000)
 * - `DB_PATH` — SQLite file path (default `./vocabion.db`)
 */
import { join } from 'node:path'

import { openDatabase } from './db/database.ts'
import { SqliteVocabRepository } from './db/SqliteVocabRepository.ts'
import { SqliteSessionRepository } from './db/SqliteSessionRepository.ts'
import { SqliteCreditsRepository } from './db/SqliteCreditsRepository.ts'
import { VocabService } from './features/vocab/vocabService.ts'
import { SessionService } from './features/session/sessionService.ts'
import { StressSessionService } from './features/session/stressSessionService.ts'
import { VeteranSessionService } from './features/session/veteranSessionService.ts'
import { BreakthroughSessionService } from './features/session/breakthroughSessionService.ts'
import { SecondChanceSessionService } from './features/session/secondChanceSessionService.ts'
import { StreakService } from './features/streak/StreakService.ts'
import { StarsService } from './features/stars/StarsService.ts'
import { createApp } from './app.ts'
import { logger } from './lib/logger.ts'

const PORT = parseInt(process.env.PORT ?? '3000', 10)
const DB_PATH = process.env.DB_PATH ?? './data/vocabion.db'
const MIGRATIONS_DIR = join(import.meta.dirname, 'db/migrations')

const db = openDatabase(DB_PATH, MIGRATIONS_DIR)

const vocabRepo = new SqliteVocabRepository(db)
const sessionRepo = new SqliteSessionRepository(db)
const creditsRepo = new SqliteCreditsRepository(db)

const vocabService = new VocabService(vocabRepo, sessionRepo, creditsRepo)
const stressSessionService = new StressSessionService(creditsRepo)
const veteranSessionService = new VeteranSessionService(creditsRepo)
const breakthroughSessionService = new BreakthroughSessionService(creditsRepo)
const secondChanceSessionService = new SecondChanceSessionService(creditsRepo)
const sessionService = new SessionService(sessionRepo, vocabRepo, creditsRepo, stressSessionService, veteranSessionService, breakthroughSessionService, secondChanceSessionService)
const streakService = new StreakService(creditsRepo)
const starsService = new StarsService(creditsRepo)

const app = createApp({ vocab: vocabService, session: sessionService, streak: streakService, stars: starsService })

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Server started')
})
