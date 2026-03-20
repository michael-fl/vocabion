/**
 * Display utilities for the spaced repetition system.
 *
 * Pure functions — no side-effects, no I/O — so they can be tested in isolation.
 *
 * @example
 * ```ts
 * import { formatDueIn } from './srsDisplay.ts'
 * const label = formatDueIn(entry, new Date()) // "in 3 days"
 * ```
 */
import type { VocabEntry } from '../../shared/types/VocabEntry.ts'
import { getIntervalMs } from '../../shared/utils/srsInterval.ts'

/**
 * Returns a human-friendly string describing when a time-based word (bucket ≥ 4)
 * is next due for review, relative to `now`.
 *
 * - Already due or never asked → `"due now"`
 * - Less than 1 hour remaining → `"in X minutes"` (minimum 1)
 * - Less than 1 day remaining  → `"in X hours"`
 * - Less than 7 days remaining → `"in X days"`
 * - 7 or more days remaining   → `"in X weeks"`
 */
export function formatDueIn(entry: VocabEntry, now: Date): string {
  if (entry.lastAskedAt === null) {
    return 'due now'
  }

  const dueAt = new Date(entry.lastAskedAt).getTime() + getIntervalMs(entry.bucket)
  const remainingMs = dueAt - now.getTime()

  if (remainingMs <= 0) {
    return 'due now'
  }

  const minutes = Math.ceil(remainingMs / (60 * 1000))
  const hours = Math.ceil(remainingMs / (60 * 60 * 1000))
  const days = Math.ceil(remainingMs / (24 * 60 * 60 * 1000))
  const weeks = Math.round(remainingMs / (7 * 24 * 60 * 60 * 1000))

  if (remainingMs < 60 * 60 * 1000) {
    return `in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  }

  if (remainingMs < 24 * 60 * 60 * 1000) {
    return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }

  if (remainingMs < 7 * 24 * 60 * 60 * 1000) {
    return `in ${days} ${days === 1 ? 'day' : 'days'}`
  }

  return `in ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`
}
