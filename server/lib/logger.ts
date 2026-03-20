/**
 * Shared pino logger instance for the Express server.
 *
 * Writes human-readable output to the terminal (via pino-pretty) and structured
 * JSON to `logs/server.log` simultaneously. In test environments (`NODE_ENV=test`)
 * logging is silenced to keep test output clean.
 *
 * Import this logger everywhere in server code instead of using `console.log`.
 *
 * @example
 * ```ts
 * import { logger } from '../lib/logger.ts'
 *
 * logger.info('Server started on port 3000')
 * logger.warn({ bucket }, 'Bucket shortfall — filling from lower bucket')
 * logger.error({ err }, 'Unexpected failure in vocabService')
 * ```
 */
import pino from 'pino'

const level = process.env.LOG_LEVEL ?? 'info'
const isTest = process.env.NODE_ENV === 'test'

export const logger = isTest
  ? pino({ level: 'silent' })
  : pino(
      { level },
      pino.transport({
        targets: [
          {
            target: 'pino-pretty',
            level,
            options: { colorize: true },
          },
          {
            target: 'pino/file',
            level,
            options: { destination: './logs/server.log', mkdir: true },
          },
        ],
      }),
    )
