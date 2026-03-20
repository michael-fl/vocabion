/**
 * Represents an expected API error with an HTTP status code.
 *
 * Throw this from service or route code to signal a client error (4xx) or
 * a known server-side failure. The global error handler middleware converts
 * it into a structured JSON response with the given status code.
 *
 * @example
 * ```ts
 * throw new ApiError(404, 'Vocabulary entry not found')
 * throw new ApiError(409, 'A session is already open')
 * ```
 */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)

    this.name = 'ApiError'
    this.status = status
  }
}
