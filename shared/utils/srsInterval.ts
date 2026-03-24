/**
 * Shared SRS interval calculation for time-based buckets (≥ 4).
 *
 * Schedule:
 * - Bucket  4:  1 day
 * - Bucket  5:  1 week
 * - Bucket  6:  2 weeks
 * - Bucket  7:  3 weeks
 * - Bucket  8:  4 weeks
 * - Bucket  9:  5 weeks
 * - Bucket 10:  6 weeks
 * - Bucket 11:  8 weeks
 * - Bucket 12+: 12 weeks (cap)
 *
 * @example
 * ```ts
 * import { getIntervalMs } from '../../../shared/utils/srsInterval.ts'
 * const due = new Date(lastAskedAt).getTime() + getIntervalMs(entry.bucket)
 * ```
 */

const HOUR_MS = 60 * 60 * 1000
const DAY_MS  = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS

/**
 * Returns the review interval in milliseconds for a time-based SRS bucket (≥ 4).
 * Bucket 4 → 1 day; buckets 5–10 → (n−4) weeks; bucket 11 → 8 weeks; bucket 12+ → 12 weeks.
 */
export function getIntervalMs(bucket: number): number {
  if (bucket === 4)  { return DAY_MS }
  if (bucket <= 10)  { return (bucket - 4) * WEEK_MS }
  if (bucket === 11) { return 8 * WEEK_MS }
  return 12 * WEEK_MS
}
