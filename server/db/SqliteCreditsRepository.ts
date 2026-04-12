/**
 * SQLite implementation of `CreditsRepository`.
 *
 * Reads and writes the single `credits` row created by migration `004_credits.sql`.
 *
 * @example
 * ```ts
 * const repo = new SqliteCreditsRepository(db)
 * repo.addBalance(1)
 * console.log(repo.getBalance()) // 1
 * ```
 */
import type Database from 'better-sqlite3'
import type { CreditsRepository, PauseState, RotationState } from '../features/credits/CreditsRepository.ts'

export class SqliteCreditsRepository implements CreditsRepository {
  constructor(private readonly db: Database.Database) {}

  /** Returns the current credit balance. */
  getBalance(): number {
    const row = this.db
      .prepare('SELECT balance FROM credits WHERE id = 1')
      .get() as { balance: number } | undefined

    return row?.balance ?? 0
  }

  /**
   * Adds `delta` to the balance (negative values decrease it).
   */
  addBalance(delta: number): void {
    this.db
      .prepare('UPDATE credits SET balance = balance + ? WHERE id = 1')
      .run(delta)
  }

  getMaxBucketEver(): number {
    const row = this.db
      .prepare('SELECT max_bucket_ever FROM credits WHERE id = 1')
      .get() as { max_bucket_ever: number } | undefined

    return row?.max_bucket_ever ?? 0
  }

  setMaxBucketEver(bucket: number): void {
    this.db
      .prepare('UPDATE credits SET max_bucket_ever = MAX(max_bucket_ever, ?) WHERE id = 1')
      .run(bucket)
  }

  getStreakCount(): number {
    const row = this.db
      .prepare('SELECT streak_count FROM credits WHERE id = 1')
      .get() as { streak_count: number } | undefined

    return row?.streak_count ?? 0
  }

  getLastSessionDate(): string | null {
    const row = this.db
      .prepare('SELECT last_session_date FROM credits WHERE id = 1')
      .get() as { last_session_date: string | null } | undefined

    return row?.last_session_date ?? null
  }

  isStreakSavePending(): boolean {
    const row = this.db
      .prepare('SELECT streak_save_pending FROM credits WHERE id = 1')
      .get() as { streak_save_pending: number } | undefined

    return (row?.streak_save_pending ?? 0) === 1
  }

  setStreakSavePending(pending: boolean): void {
    this.db
      .prepare('UPDATE credits SET streak_save_pending = ? WHERE id = 1')
      .run(pending ? 1 : 0)
  }

  updateStreak(count: number, lastSessionDate: string): void {
    if (count === 1) {
      this.db
        .prepare(`UPDATE credits
                  SET streak_count = ?, last_session_date = ?,
                      streak_start_date = ?, streak_weeks_awarded = 0, streak_months_awarded = 0
                  WHERE id = 1`)
        .run(count, lastSessionDate, lastSessionDate)
    } else {
      this.db
        .prepare('UPDATE credits SET streak_count = ?, last_session_date = ? WHERE id = 1')
        .run(count, lastSessionDate)
    }
  }

  getStreakStartDate(): string | null {
    const row = this.db
      .prepare('SELECT streak_start_date FROM credits WHERE id = 1')
      .get() as { streak_start_date: string | null } | undefined

    return row?.streak_start_date ?? null
  }

  getStreakWeeksAwarded(): number {
    const row = this.db
      .prepare('SELECT streak_weeks_awarded FROM credits WHERE id = 1')
      .get() as { streak_weeks_awarded: number } | undefined

    return row?.streak_weeks_awarded ?? 0
  }

  getStreakMonthsAwarded(): number {
    const row = this.db
      .prepare('SELECT streak_months_awarded FROM credits WHERE id = 1')
      .get() as { streak_months_awarded: number } | undefined

    return row?.streak_months_awarded ?? 0
  }

  setStreakWeeksAwarded(count: number): void {
    this.db
      .prepare('UPDATE credits SET streak_weeks_awarded = ? WHERE id = 1')
      .run(count)
  }

  setStreakMonthsAwarded(count: number): void {
    this.db
      .prepare('UPDATE credits SET streak_months_awarded = ? WHERE id = 1')
      .run(count)
  }

  getLastDiscoverySessionDate(): string | null {
    const row = this.db
      .prepare('SELECT last_discovery_session_date FROM credits WHERE id = 1')
      .get() as { last_discovery_session_date: string | null } | undefined

    return row?.last_discovery_session_date ?? null
  }

  setLastDiscoverySessionDate(date: string): void {
    this.db
      .prepare('UPDATE credits SET last_discovery_session_date = ? WHERE id = 1')
      .run(date)
  }

  getLastStarredSessionDate(): string | null {
    const row = this.db
      .prepare('SELECT last_starred_session_date FROM credits WHERE id = 1')
      .get() as { last_starred_session_date: string | null } | undefined

    return row?.last_starred_session_date ?? null
  }

  setLastStarredSessionDate(date: string): void {
    this.db
      .prepare('UPDATE credits SET last_starred_session_date = ? WHERE id = 1')
      .run(date)
  }

  getEarnedStars(): number {
    const row = this.db
      .prepare('SELECT earned_stars FROM credits WHERE id = 1')
      .get() as { earned_stars: number } | undefined

    return row?.earned_stars ?? 0
  }

  awardStars(n: number): void {
    this.db
      .prepare('UPDATE credits SET earned_stars = MAX(earned_stars, ?) WHERE id = 1')
      .run(n)
  }

  addStars(count: number): void {
    this.db
      .prepare('UPDATE credits SET earned_stars = earned_stars + ? WHERE id = 1')
      .run(count)
  }

  getStarsOfferSnoozedUntil(): string | null {
    const row = this.db
      .prepare('SELECT stars_offer_snoozed_until FROM credits WHERE id = 1')
      .get() as { stars_offer_snoozed_until: string | null } | undefined

    return row?.stars_offer_snoozed_until ?? null
  }

  setStarsOfferSnoozedUntil(date: string | null): void {
    this.db
      .prepare('UPDATE credits SET stars_offer_snoozed_until = ? WHERE id = 1')
      .run(date)
  }

  getStressSessionDueAt(): string | null {
    const row = this.db
      .prepare('SELECT stress_session_due_at FROM credits WHERE id = 1')
      .get() as { stress_session_due_at: string | null } | undefined

    return row?.stress_session_due_at ?? null
  }

  setStressSessionDueAt(date: string | null): void {
    this.db
      .prepare('UPDATE credits SET stress_session_due_at = ? WHERE id = 1')
      .run(date)
  }

  getVeteranSessionDueAt(): string | null {
    const row = this.db
      .prepare('SELECT veteran_session_due_at FROM credits WHERE id = 1')
      .get() as { veteran_session_due_at: string | null } | undefined

    return row?.veteran_session_due_at ?? null
  }

  setVeteranSessionDueAt(date: string | null): void {
    this.db
      .prepare('UPDATE credits SET veteran_session_due_at = ? WHERE id = 1')
      .run(date)
  }

  getBreakthroughSessionDueAt(): string | null {
    const row = this.db
      .prepare('SELECT breakthrough_session_due_at FROM credits WHERE id = 1')
      .get() as { breakthrough_session_due_at: string | null } | undefined

    return row?.breakthrough_session_due_at ?? null
  }

  setBreakthroughSessionDueAt(date: string | null): void {
    this.db
      .prepare('UPDATE credits SET breakthrough_session_due_at = ? WHERE id = 1')
      .run(date)
  }

  getBreakthroughPlusSessionDueAt(): string | null {
    const row = this.db
      .prepare('SELECT breakthrough_plus_session_due_at FROM credits WHERE id = 1')
      .get() as { breakthrough_plus_session_due_at: string | null } | undefined

    return row?.breakthrough_plus_session_due_at ?? null
  }

  setBreakthroughPlusSessionDueAt(date: string | null): void {
    this.db
      .prepare('UPDATE credits SET breakthrough_plus_session_due_at = ? WHERE id = 1')
      .run(date)
  }

  getLastSecondChanceSessionDate(): string | null {
    const row = this.db
      .prepare('SELECT last_second_chance_session_date FROM credits WHERE id = 1')
      .get() as { last_second_chance_session_date: string | null } | undefined

    return row?.last_second_chance_session_date ?? null
  }

  setLastSecondChanceSessionDate(date: string): void {
    this.db
      .prepare('UPDATE credits SET last_second_chance_session_date = ? WHERE id = 1')
      .run(date)
  }

  getPauseState(): PauseState {
    const row = this.db
      .prepare('SELECT pause_active, pause_start_date, pause_days_used, pause_budget_year FROM credits WHERE id = 1')
      .get() as { pause_active: number; pause_start_date: string | null; pause_days_used: number; pause_budget_year: number } | undefined

    return {
      active: (row?.pause_active ?? 0) === 1,
      startDate: row?.pause_start_date ?? null,
      daysUsed: row?.pause_days_used ?? 0,
      budgetYear: row?.pause_budget_year ?? 0,
    }
  }

  setPauseActive(startDate: string): void {
    this.db
      .prepare('UPDATE credits SET pause_active = 1, pause_start_date = ? WHERE id = 1')
      .run(startDate)
  }

  setPauseInactive(newDaysUsed: number, year: number): void {
    this.db
      .prepare('UPDATE credits SET pause_active = 0, pause_start_date = NULL, pause_days_used = ?, pause_budget_year = ? WHERE id = 1')
      .run(newDaysUsed, year)
  }

  getRotationState(): RotationState {
    const row = this.db
      .prepare('SELECT rotation_sequence, rotation_index, rotation_last_type FROM credits WHERE id = 1')
      .get() as { rotation_sequence: string | null; rotation_index: number; rotation_last_type: string | null } | undefined

    return {
      sequence: row?.rotation_sequence !== null && row?.rotation_sequence !== undefined
        ? JSON.parse(row.rotation_sequence) as string[]
        : [],
      index: row?.rotation_index ?? 0,
      lastType: row?.rotation_last_type ?? null,
    }
  }

  saveRotationState(state: RotationState): void {
    this.db
      .prepare('UPDATE credits SET rotation_sequence = ?, rotation_index = ?, rotation_last_type = ? WHERE id = 1')
      .run(JSON.stringify(state.sequence), state.index, state.lastType)
  }
}
