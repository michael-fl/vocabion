/**
 * Utility for determining whether the evening streak warning should be shown.
 *
 * @example
 * ```ts
 * import { isEveningStreakWarning } from '../utils/streakWarning.ts'
 * if (isEveningStreakWarning(streak.lastSessionDate, new Date())) {
 *   // show warning
 * }
 * ```
 */

/**
 * Returns true when the user has practiced yesterday (local calendar day) and
 * the current local time is 20:00 or later — meaning the streak will be broken
 * if no session is started today.
 *
 * @param lastSessionDate - UTC date string from the server (`YYYY-MM-DD`).
 * @param now - Current date/time (injected for testability).
 */
export function isEveningStreakWarning(lastSessionDate: string | null, now: Date): boolean {
  if (lastSessionDate === null) {
    return false
  }

  if (now.getHours() < 20) {
    return false
  }

  const yesterday = new Date(now)

  yesterday.setDate(yesterday.getDate() - 1)

  const yesterdayStr = yesterday.toLocaleDateString('en-CA') // YYYY-MM-DD in local time

  return lastSessionDate === yesterdayStr
}
