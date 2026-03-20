// @vitest-environment node

/**
 * Tests for ApiError.
 */

import { ApiError } from './ApiError.ts'

describe('ApiError', () => {
  it('sets status and message from constructor arguments', () => {
    const err = new ApiError(404, 'Not found')

    expect(err.status).toBe(404)
    expect(err.message).toBe('Not found')
  })

  it('is an instance of Error', () => {
    expect(new ApiError(400, 'Bad request')).toBeInstanceOf(Error)
  })

  it('is an instance of ApiError', () => {
    expect(new ApiError(400, 'Bad request')).toBeInstanceOf(ApiError)
  })

  it('has name set to "ApiError"', () => {
    expect(new ApiError(500, 'Server error').name).toBe('ApiError')
  })

  it('preserves different 4xx status codes', () => {
    expect(new ApiError(400, '').status).toBe(400)
    expect(new ApiError(401, '').status).toBe(401)
    expect(new ApiError(403, '').status).toBe(403)
    expect(new ApiError(409, '').status).toBe(409)
    expect(new ApiError(422, '').status).toBe(422)
  })

  it('can be caught as an Error', () => {
    const fn = () => {
      throw new ApiError(403, 'Forbidden')
    }

    expect(fn).toThrow(Error)
    expect(fn).toThrow('Forbidden')
  })

  it('can be distinguished from a plain Error via instanceof', () => {
    const apiErr = new ApiError(400, 'x')
    const plainErr = new Error('x')

    expect(apiErr instanceof ApiError).toBe(true)
    expect(plainErr instanceof ApiError).toBe(false)
  })
})
