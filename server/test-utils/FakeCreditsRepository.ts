/**
 * In-memory implementation of `CreditsRepository` for use in unit tests.
 *
 * Backed by a plain integer — no SQLite, no I/O. Instantiate a fresh
 * `FakeCreditsRepository` in each test's `beforeEach` to guarantee isolation.
 *
 * @example
 * ```ts
 * const creditsRepo = new FakeCreditsRepository()
 * const service = new VocabService(vocabRepo, creditsRepo)
 * ```
 */
import type { CreditsRepository, PauseState } from '../features/credits/CreditsRepository.ts'

export class FakeCreditsRepository implements CreditsRepository {
  private balance = 0
  private maxBucketEver = 0
  private streakCount = 0
  private lastSessionDate: string | null = null
  private streakSavePending = false
  private streakStartDate: string | null = null
  private streakWeeksAwarded = 0
  private streakMonthsAwarded = 0
  private lastFocusSessionDate: string | null = null
  private lastDiscoverySessionDate: string | null = null
  private pauseState: PauseState = { active: false, startDate: null, daysUsed: 0, budgetYear: 0 }

  getBalance(): number {
    return this.balance
  }

  addBalance(delta: number): void {
    this.balance += delta
  }

  getMaxBucketEver(): number {
    return this.maxBucketEver
  }

  setMaxBucketEver(bucket: number): void {
    if (bucket > this.maxBucketEver) {
      this.maxBucketEver = bucket
    }
  }

  getStreakCount(): number {
    return this.streakCount
  }

  getLastSessionDate(): string | null {
    return this.lastSessionDate
  }

  isStreakSavePending(): boolean {
    return this.streakSavePending
  }

  setStreakSavePending(pending: boolean): void {
    this.streakSavePending = pending
  }

  updateStreak(count: number, lastSessionDate: string): void {
    this.streakCount = count
    this.lastSessionDate = lastSessionDate

    if (count === 1) {
      this.streakStartDate = lastSessionDate
      this.streakWeeksAwarded = 0
      this.streakMonthsAwarded = 0
    }
  }

  getStreakStartDate(): string | null {
    return this.streakStartDate
  }

  getStreakWeeksAwarded(): number {
    return this.streakWeeksAwarded
  }

  getStreakMonthsAwarded(): number {
    return this.streakMonthsAwarded
  }

  setStreakWeeksAwarded(count: number): void {
    this.streakWeeksAwarded = count
  }

  setStreakMonthsAwarded(count: number): void {
    this.streakMonthsAwarded = count
  }

  getLastFocusSessionDate(): string | null {
    return this.lastFocusSessionDate
  }

  setLastFocusSessionDate(date: string): void {
    this.lastFocusSessionDate = date
  }

  getLastDiscoverySessionDate(): string | null {
    return this.lastDiscoverySessionDate
  }

  setLastDiscoverySessionDate(date: string): void {
    this.lastDiscoverySessionDate = date
  }

  getPauseState(): PauseState {
    return { ...this.pauseState }
  }

  setPauseActive(startDate: string): void {
    this.pauseState.active = true
    this.pauseState.startDate = startDate
  }

  setPauseInactive(newDaysUsed: number, year: number): void {
    this.pauseState.active = false
    this.pauseState.startDate = null
    this.pauseState.daysUsed = newDaysUsed
    this.pauseState.budgetYear = year
  }
}
