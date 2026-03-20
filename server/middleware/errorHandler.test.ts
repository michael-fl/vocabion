// @vitest-environment node

/**
 * Tests for the global Express error handler middleware.
 */

import { vi, beforeEach, describe, it, expect } from 'vitest'

vi.mock('../lib/logger.ts', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import type { NextFunction, Request, Response } from 'express'

import { logger } from '../lib/logger.ts'
import { ApiError } from '../errors/ApiError.ts'
import { errorHandler } from './errorHandler.ts'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRes(): Response {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response

  ;(res.status as ReturnType<typeof vi.fn>).mockReturnValue(res)
  ;(res.json as ReturnType<typeof vi.fn>).mockReturnValue(res)

  return res
}

function makeReqNext(): [Request, NextFunction] {
  return [{} as Request, vi.fn() as unknown as NextFunction]
}

// ── ApiError handling ─────────────────────────────────────────────────────────

describe('errorHandler — ApiError', () => {
  let res: Response
  let req: Request
  let next: NextFunction

  beforeEach(() => {
    vi.clearAllMocks()
    res = makeRes()
    ;[req, next] = makeReqNext()
  })

  it('responds with the ApiError status code', () => {
    errorHandler(new ApiError(404, 'Not found'), req, res, next)

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds with a JSON body containing the error message', () => {
    errorHandler(new ApiError(404, 'Not found'), req, res, next)

    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' })
  })

  it('uses the correct status code for 409 conflicts', () => {
    errorHandler(new ApiError(409, 'Conflict'), req, res, next)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: 'Conflict' })
  })

  it('logs at warn level, not error', () => {
    errorHandler(new ApiError(400, 'Bad request'), req, res, next)

    expect(logger.warn).toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('does not call next()', () => {
    errorHandler(new ApiError(400, 'Bad request'), req, res, next)

    expect(next).not.toHaveBeenCalled()
  })
})

// ── Unexpected Error handling ─────────────────────────────────────────────────

describe('errorHandler — unexpected Error', () => {
  let res: Response
  let req: Request
  let next: NextFunction

  beforeEach(() => {
    vi.clearAllMocks()
    res = makeRes()
    ;[req, next] = makeReqNext()
  })

  it('responds with 500 for a plain Error', () => {
    errorHandler(new Error('boom'), req, res, next)

    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('includes the error message in the response body', () => {
    errorHandler(new Error('database locked'), req, res, next)

    expect(res.json).toHaveBeenCalledWith({ error: 'database locked' })
  })

  it('logs at error level, not warn', () => {
    errorHandler(new Error('unexpected'), req, res, next)

    expect(logger.error).toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

// ── Non-Error thrown values ───────────────────────────────────────────────────

describe('errorHandler — non-Error thrown values', () => {
  let res: Response
  let req: Request
  let next: NextFunction

  beforeEach(() => {
    vi.clearAllMocks()
    res = makeRes()
    ;[req, next] = makeReqNext()
  })

  it('responds with 500 for a thrown string', () => {
    errorHandler('something went wrong', req, res, next)

    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('uses a generic message for non-Error values', () => {
    errorHandler('something went wrong', req, res, next)

    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' })
  })

  it('responds with 500 for a thrown null', () => {
    errorHandler(null, req, res, next)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' })
  })

  it('responds with 500 for a thrown object', () => {
    errorHandler({ code: 'ECONNRESET' }, req, res, next)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' })
  })
})
