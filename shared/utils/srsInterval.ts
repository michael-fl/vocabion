/**
 * Shared SRS interval calculation for time-based buckets (≥ 4).
 *
 * Schedule:
 * - Bucket 4: 22 hours
 * - Bucket 5: 1 week
 * - Bucket 6: 2 weeks
 * - Bucket n ≥ 5: (n − 4) weeks
 *
 * @example
 * ```ts
 * import { getIntervalMs } from '../../../shared/utils/srsInterval.ts'
 * const due = new Date(lastAskedAt).getTime() + getIntervalMs(entry.bucket)
 * ```
 */

const HOUR_MS = 60 * 60 * 1000
const WEEK_MS = 7 * 24 * HOUR_MS

/**
 * Returns the review interval in milliseconds for a time-based SRS bucket (≥ 4).
 * Bucket 4 → 22 hours; bucket 5 → 1 week; bucket 6 → 2 weeks; bucket n ≥ 5 → (n−4) weeks.
 */
export function getIntervalMs(bucket: number): number {
  if (bucket === 4) {
    return 22 * HOUR_MS
  }

  return (bucket - 4) * WEEK_MS
}
