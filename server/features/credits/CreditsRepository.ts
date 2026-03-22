/**
 * Repository interface for the credit balance counter.
 *
 * The balance is a single integer stored persistently. It is incremented when
 * a word reaches a new highest time-based bucket (≥ 4) and decremented when
 * credits are spent.
 *
 * @example
 * ```ts
 * const balance = repo.getBalance()
 * repo.addBalance(1)   // earn a credit
 * repo.addBalance(-1)  // spend a credit
 * ```
 */
/** Snapshot of the pause state stored in the `credits` row. */
export interface PauseState {
  /** Whether the game is currently in pause mode. */
  active: boolean
  /** First paused day (YYYY-MM-DD), retroactively set to `lastSessionDate + 1`. Null when not paused. */
  startDate: string | null
  /** Pause days consumed by *completed* pauses in `budgetYear`. */
  daysUsed: number
  /** Calendar year `daysUsed` belongs to; used to detect year rollover. */
  budgetYear: number
}

export interface CreditsRepository {
  /** Returns the current credit balance. */
  getBalance(): number

  /**
   * Adds `delta` to the current balance (use a negative value to spend credits).
   */
  addBalance(delta: number): void

  /**
   * Returns the highest bucket number ever reached by any word across all sessions.
   * This value never decreases and is used to gate the new-bucket milestone bonus.
   */
  getMaxBucketEver(): number

  /**
   * Updates the global high-water mark if `bucket` exceeds the current value.
   * No-op when `bucket` is ≤ the current value.
   */
  setMaxBucketEver(bucket: number): void

  /** Returns the current streak length (consecutive days practiced). */
  getStreakCount(): number

  /**
   * Returns the date (YYYY-MM-DD UTC) of the last session that counted toward
   * the streak, or `null` if the user has never completed a session.
   */
  getLastSessionDate(): string | null

  /**
   * Returns `true` if the user has paid to save a broken streak but has not
   * yet answered the first question of the bridging session.
   */
  isStreakSavePending(): boolean

  /** Sets or clears the streak-save-pending flag. */
  setStreakSavePending(pending: boolean): void

  /**
   * Atomically updates both the streak count and the last-session date.
   * When `count = 1` (new or restarted streak), also sets `streak_start_date`
   * to `lastSessionDate` and resets `streak_weeks_awarded` and
   * `streak_months_awarded` to 0.
   */
  updateStreak(count: number, lastSessionDate: string): void

  /** Returns the YYYY-MM-DD date on which the current streak began, or `null`. */
  getStreakStartDate(): string | null

  /** Returns how many weekly milestones (0–2) have been awarded for the current streak. */
  getStreakWeeksAwarded(): number

  /** Returns how many monthly milestones have been awarded for the current streak. */
  getStreakMonthsAwarded(): number

  /** Sets the number of weekly milestones awarded for the current streak. */
  setStreakWeeksAwarded(count: number): void

  /** Sets the number of monthly milestones awarded for the current streak. */
  setStreakMonthsAwarded(count: number): void

  /**
   * Returns the date (YYYY-MM-DD) on which the last focus session was completed,
   * or `null` if no focus session has ever been completed.
   */
  getLastFocusSessionDate(): string | null

  /** Records that a focus session was completed on the given date (YYYY-MM-DD). */
  setLastFocusSessionDate(date: string): void

  /**
   * Returns the date (YYYY-MM-DD) on which the last discovery session was completed,
   * or `null` if no discovery session has ever been completed.
   */
  getLastDiscoverySessionDate(): string | null

  /** Records that a discovery session was completed on the given date (YYYY-MM-DD). */
  setLastDiscoverySessionDate(date: string): void

  /**
   * Returns the date (YYYY-MM-DD) on which the last starred session was completed,
   * or `null` if no starred session has ever been completed.
   */
  getLastStarredSessionDate(): string | null

  /** Records that a starred session was completed on the given date (YYYY-MM-DD). */
  setLastStarredSessionDate(date: string): void

  /**
   * Returns the number of stars the user has earned.
   * Stars are a persistent watermark that never decreases.
   */
  getEarnedStars(): number

  /**
   * Awards stars to the user if `n` exceeds the current count.
   * No-op when `n` is ≤ the current value.
   */
  awardStars(n: number): void

  /**
   * Adds `count` purchased stars to the total.
   * Unlike `awardStars`, this is additive — it always increases `earned_stars` by `count`.
   */
  addStars(count: number): void

  /**
   * Returns the date (YYYY-MM-DD) until which the "buy stars" offer is snoozed,
   * or `null` if the offer has never been shown.
   */
  getStarsOfferSnoozedUntil(): string | null

  /**
   * Sets the date until which the "buy stars" offer is snoozed.
   * Pass `null` to clear the snooze (offer eligible immediately).
   */
  setStarsOfferSnoozedUntil(date: string | null): void

  /**
   * Returns the date (YYYY-MM-DD) when the next automatic stress session becomes available,
   * or `null` if no stress session has been scheduled yet (user has never reached ≥ 500 credits).
   */
  getStressSessionDueAt(): string | null

  /**
   * Sets the date (YYYY-MM-DD) when the next stress session becomes available.
   * Pass `null` to clear the scheduled date.
   */
  setStressSessionDueAt(date: string | null): void

  /**
   * Returns the date (YYYY-MM-DD) when the next automatic veteran session becomes available,
   * or `null` if no veteran session has been scheduled yet.
   */
  getVeteranSessionDueAt(): string | null

  /**
   * Sets the date (YYYY-MM-DD) when the next veteran session becomes available.
   * Pass `null` to clear the scheduled date.
   */
  setVeteranSessionDueAt(date: string | null): void

  /** Returns the current pause state. */
  getPauseState(): PauseState

  /** Activates pause mode; sets `pause_start_date` to `startDate`. */
  setPauseActive(startDate: string): void

  /**
   * Deactivates pause mode and records the total days consumed.
   * @param newDaysUsed - Updated cumulative days used for `year`.
   * @param year - Calendar year `newDaysUsed` belongs to.
   */
  setPauseInactive(newDaysUsed: number, year: number): void
}
