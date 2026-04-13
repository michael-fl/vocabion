/**
 * HTTP client for the streak API (`/api/v1/streak`).
 *
 * @example
 * ```ts
 * import { getStreak, saveStreak, activatePause, resumePause } from './streakApi.ts'
 * const info = await getStreak()
 * if (info.saveAvailable) {
 *   await saveStreak()
 * }
 * ```
 */

const BASE = '/api/v1/streak'

/** Maximum pause days available per calendar year. */
export const PAUSE_BUDGET_DAYS = 14

/** The next upcoming streak milestone. */
export interface NextMilestone {
  label: string
  credits: number
  daysUntil: number
}

/** Pause budget and current pause status. */
export interface PauseInfo {
  /** Whether the game is currently paused. */
  active: boolean
  /** Retroactive start date (YYYY-MM-DD) of the current pause. Null when not paused. */
  startDate: string | null
  /** Total pause days consumed this year (completed + current active pause). */
  daysConsumed: number
  /** Days remaining in the annual 14-day budget. */
  budgetRemaining: number
  /**
   * When not paused: retroactive days that would be charged immediately on pause activation.
   * When paused: days the current pause has been active so far.
   */
  daysToCharge: number
}

/** Current streak state. */
export interface StreakInfo {
  /** Number of consecutive days the user has practiced. */
  count: number
  /**
   * True if the streak is saveable: the last session was on the day before
   * yesterday (calendar-day comparison, UTC). The user can pay 50 credits to
   * bridge the gap.
   */
  saveAvailable: boolean
  /**
   * The UTC date (`YYYY-MM-DD`) of the last completed session, or `null` if no
   * session has ever been completed.
   */
  lastSessionDate: string | null
  /** The next milestone to reach, or `null` when there is no active streak. */
  nextMilestone: NextMilestone | null
  /** Pause budget and current status. Undefined for clients that haven't yet received a response with the pause field. */
  pause?: PauseInfo
}

/** Returns the current streak count and save availability. */
export async function getStreak(): Promise<StreakInfo> {
  const res = await fetch(BASE)

  if (!res.ok) {
    throw new Error(`Failed to get streak: ${res.status}`)
  }

  return res.json() as Promise<StreakInfo>
}

/**
 * Deducts 50 credits and marks the streak as pending a bridge answer.
 * The caller must subsequently create a session so the user can answer
 * the first question, which officially extends the streak.
 *
 * Returns the new credit balance.
 */
export async function saveStreak(): Promise<number> {
  const res = await fetch(`${BASE}/save`, { method: 'POST' })

  if (!res.ok) {
    throw new Error(`Failed to save streak: ${res.status}`)
  }

  const data = (await res.json()) as { balance: number }

  return data.balance
}

/**
 * Result of activating pause mode.
 * Extends PauseInfo with the number of streak days that could not be covered
 * due to an insufficient budget (Fall B). Zero in the normal case (Fall A).
 */
export interface PauseActivationResult extends PauseInfo {
  streakDaysLost: number
}

/**
 * Activates pause mode.
 *
 * Fall A (sufficient budget): the pause starts retroactively from the day
 * after the last session; `streakDaysLost` is 0.
 *
 * Fall B (insufficient budget): the pause starts from today; `streakDaysLost`
 * contains the number of missed days that could not be covered retroactively.
 */
export async function activatePause(): Promise<PauseActivationResult> {
  const res = await fetch(`${BASE}/pause`, { method: 'POST' })

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(data.message ?? `Failed to activate pause: ${res.status}`)
  }

  return res.json() as Promise<PauseActivationResult>
}

/**
 * Deactivates pause mode, advances the streak, and awards any milestones
 * crossed during the pause.
 *
 * Returns credits awarded and milestone labels.
 */
export async function resumePause(): Promise<{ creditsAwarded: number; milestoneLabels: string[] }> {
  const res = await fetch(`${BASE}/resume`, { method: 'POST' })

  if (!res.ok) {
    throw new Error(`Failed to resume: ${res.status}`)
  }

  return res.json() as Promise<{ creditsAwarded: number; milestoneLabels: string[] }>
}
