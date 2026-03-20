/**
 * Global Express error handler middleware.
 *
 * Must be registered as the last middleware in the Express app (after all routes).
 * Converts thrown errors into structured JSON responses:
 *
 * - `ApiError` instances → HTTP status from the error + `{ error: message }`
 * - Any other `Error` → HTTP 500 + `{ error: message }`
 * - Non-Error thrown values → HTTP 500 + `{ error: 'Internal server error' }`
 *
 * @example
 * ```ts
 * app.use(errorHandler)
 * ```
 */
import type { NextFunction, Request, Response } from 'express'

import { ApiError } from '../errors/ApiError.ts'
import { logger } from '../lib/logger.ts'

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    logger.warn({ status: err.status, message: err.message }, 'API error')
    res.status(err.status).json({ error: err.message })

    return
  }

  const message = err instanceof Error ? err.message : 'Internal server error'

  logger.error({ err }, 'Unexpected error')
  res.status(500).json({ error: message })
}
