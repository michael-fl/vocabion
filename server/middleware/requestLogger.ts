/**
 * Concise HTTP request/response logger middleware.
 *
 * Logs every incoming request and its response at INFO level using the shared
 * pino logger. Long payloads are truncated at 1000 characters.
 *
 * Log format:
 * - Request:  `→ METHOD /url [body]`
 * - Response: `← STATUS [body]`
 *
 * @example
 * ```ts
 * app.use(express.json())
 * app.use(requestLogger)
 * ```
 */
import type { NextFunction, Request, Response } from 'express'

import { logger } from '../lib/logger.ts'

const MAX_LENGTH = 1000

function truncate(s: string): string {
  return s.length > MAX_LENGTH ? `${s.slice(0, MAX_LENGTH)}…` : s
}

function serializeBody(body: unknown): string {
  if (body === undefined || body === null) {
    return ''
  }

  if (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0) {
    return ''
  }

  return truncate(JSON.stringify(body))
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const bodyStr = serializeBody(req.body as unknown)
  const requestLine = bodyStr !== '' ? `→ ${req.method} ${req.url} ${bodyStr}` : `→ ${req.method} ${req.url}`

  logger.info(requestLine)

  const originalJson = res.json.bind(res)

  res.json = function (body: unknown): Response {
    const responseStr = serializeBody(body)
    const responseLine = responseStr !== '' ? `← ${res.statusCode} ${responseStr}` : `← ${res.statusCode}`

    logger.info(responseLine)

    return originalJson(body)
  }

  next()
}
