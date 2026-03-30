/**
 * Shared numeric constants for session configuration.
 *
 * Kept in a standalone file so that all session service modules and their
 * tests can import from here without creating circular dependencies
 * (sessionService.ts imports from the individual service files, so those
 * cannot import back from sessionService.ts).
 *
 * @example
 * ```ts
 * import { MIN_SESSION_SIZE } from './sessionConstants.ts'
 * export const FOCUS_MIN_WORDS = MIN_SESSION_SIZE
 * ```
 */

/** Minimum number of qualifying words required for most session types to fire. */
export const MIN_SESSION_SIZE = 12
