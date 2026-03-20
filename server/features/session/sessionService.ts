/**
 * Business logic for training session management and SRS answer processing.
 *
 * Depends on `SessionRepository` and `VocabRepository` interfaces — never on
 * any concrete database implementation. Instantiated once at server startup
 * and injected into the session router.
 *
 * @example
 * ```ts
 * const service = new SessionService(sessionRepo, vocabRepo)
 * const session = service.createSession({ direction: 'DE_TO_EN', size: 10 })
 * ```
 */
import type { Session, SessionWord, SessionDirection, SessionType } from '../../../shared/types/Session.ts'
import type { VocabEntry } from '../../../shared/types/VocabEntry.ts'
import type { SessionRepository } from './SessionRepository.ts'
import type { VocabRepository } from '../vocab/VocabRepository.ts'
import type { CreditsRepository } from '../credits/CreditsRepository.ts'
import { ApiError } from '../../errors/ApiError.ts'
import { checkAnswerDetailed } from './answerValidation.ts'
import type { TypoMatch } from './answerValidation.ts'
import { selectSessionWords, selectRepetitionWords, selectFocusWords, selectDiscoveryWords, isDue } from './srsSelection.ts'
import { getIntervalMs } from '../../../shared/utils/srsInterval.ts'
import { computeScore } from './srsScore.ts'
import { subtractDays } from '../streak/StreakService.ts'
import { checkMilestoneReached } from '../../../shared/utils/streakMilestones.ts'

// ── Public types ──────────────────────────────────────────────────────────────

/** Number of active-pool words (buckets 1–4) below which a discovery session is triggered. */
export const DISCOVERY_POOL_THRESHOLD = 80

/** Number of free push-backs available per discovery session. */
export const DISCOVERY_PUSHBACK_BUDGET = 10

/** Options for creating a new training session. */
export interface CreateSessionOptions {
  direction: SessionDirection
  /** Number of words in a normal (learning) session. */
  size: number
  /** Number of words in a repetition session. Defaults to 24 if not provided. */
  repetitionSize?: number
  /** Number of words in a discovery session. Defaults to 24 if not provided. */
  discoverySize?: number
}

/**
 * Describes the outcome of submitting an answer:
 * - `correct` — all required answers correct; word promoted to bucket + 1.
 * - `incorrect` — all answers wrong on a frequency bucket (0–3) word; word reset to bucket 1.
 * - `partial` — one of two required answers correct on any word; word stays in its current bucket.
 * - `second_chance` — all answers wrong on a time bucket (4+) word; a second word was
 *   added to the session for a second-chance attempt.
 * - `second_chance_correct` — the second-chance word was answered correctly;
 *   W1 moves to bucket − 1, W2 stays in its current bucket.
 * - `second_chance_partial` — second-chance word was partially correct;
 *   W1 is reset to bucket 1, W2 stays in its current bucket.
 * - `second_chance_incorrect` — the second-chance word was also fully wrong;
 *   W1 is reset to bucket 1, W2 stays in its current bucket.
 */
export type AnswerOutcome =
  | 'correct'
  | 'correct_typo'
  | 'incorrect'
  | 'partial'
  | 'partial_typo'
  | 'second_chance'
  | 'second_chance_correct'
  | 'second_chance_correct_typo'
  | 'second_chance_partial'
  | 'second_chance_partial_typo'
  | 'second_chance_incorrect'

/** Returned by `submitAnswer`. */
export interface AnswerResult {
  correct: boolean
  outcome: AnswerOutcome
  sessionCompleted: boolean
  session: Session
  /**
   * New bucket of the answered word after this outcome.
   * For `second_chance`: W1's current (unchanged) bucket — useful for computing
   * what will happen if the second-chance succeeds or fails.
   */
  newBucket: number
  /**
   * Only present for `second_chance_correct`, `second_chance_partial`, and
   * `second_chance_incorrect`: the new bucket of W1 (the original wrong word)
   * after both outcomes are resolved.
   */
  w1NewBucket?: number
  /**
   * Populated for `correct_typo` and `second_chance_correct_typo`: one entry per
   * answer that was accepted via Levenshtein distance rather than an exact match.
   */
  typos?: TypoMatch[]
  /**
   * Credits deducted for this specific wrong answer: 1 if the balance was ≥ 1,
   * otherwise 0. 0 for correct answers. Balance never goes negative.
   */
  answerCost: number
  /**
   * Credits earned by this specific answer (i.e. the word reached a new highest
   * time-based bucket). 0 for wrong answers or when no new bucket milestone was hit.
   */
  creditsEarned: number
  /**
   * Bonus credits awarded for completing the session with a perfect score (no mistakes
   * and no second-chance words). 10 on a perfect session, 0 otherwise.
   */
  perfectBonus: number
  /**
   * One-time bonus of 100 credits awarded when a word is promoted into a bucket
   * number ≥ 6 that has never existed before (global high-water mark). 0 otherwise.
   */
  bucketMilestoneBonus: number
  /**
   * Streak-related credits awarded on session completion: either 1 (daily streak
   * bonus) or the milestone reward, whichever applies. 0 if no streak credit fired.
   */
  streakCredit: number
  /**
   * Human-readable label of the streak milestone reached this session, e.g.
   * 'Week 1' or 'Month 1'. `undefined` when no milestone was reached.
   */
  milestoneLabel?: string
}

// ── Service ───────────────────────────────────────────────────────────────────

export class SessionService {
  constructor(
    private readonly sessionRepo: SessionRepository,
    private readonly vocabRepo: VocabRepository,
    private readonly creditsRepo: CreditsRepository,
  ) {}

  /** Returns the currently open session, or `undefined` if none exists. */
  getOpenSession(): Session | undefined {
    return this.sessionRepo.findOpen()
  }

  /**
   * Creates a new training session using the SRS word selection algorithm.
   *
   * Session types alternate: every second session is a repetition session
   * (drawn exclusively from due time-based buckets 4+). If a repetition session
   * is due but fewer than `size` words are currently due in the time-based
   * buckets, the repetition is skipped and a normal session is created instead;
   * the next session will try repetition again.
   *
   * @throws {ApiError} 409 if a session is already open.
   * @throws {ApiError} 400 if no vocabulary entries are available at all.
   */
  createSession(options: CreateSessionOptions): Session {
    if (this.creditsRepo.getPauseState().active) {
      throw new ApiError(423, 'Cannot start a session while the streak is paused')
    }

    const existing = this.sessionRepo.findOpen()

    if (existing !== undefined) {
      throw new ApiError(409, 'A training session is already open')
    }

    const allEntries = this.vocabRepo.findAll()
    const now = new Date()
    const today = now.toISOString().slice(0, 10)

    const discSize = options.discoverySize ?? 24
    const repSize = options.repetitionSize ?? 24
    let selected = this.vocabRepo.findAll().slice(0, 0) // typed empty array
    let sessionType: SessionType

    // Discovery session has the highest priority: triggered when the active pool
    // (buckets 1–4) falls below the threshold, enough new words exist, and no
    // discovery session has already been completed today.
    const lastDiscoveryDate = this.creditsRepo.getLastDiscoverySessionDate()
    const activePoolCount = allEntries.filter((e) => e.bucket >= 1 && e.bucket <= 4).length
    const discoveryCandidates =
      lastDiscoveryDate !== today && activePoolCount < DISCOVERY_POOL_THRESHOLD
        ? selectDiscoveryWords(allEntries, discSize)
        : null

    if (discoveryCandidates !== null) {
      selected = discoveryCandidates
      sessionType = 'discovery'
    } else {
      // Focus session is next in priority: squeeze one in if none has completed today.
      const lastFocusDate = this.creditsRepo.getLastFocusSessionDate()
      const focusCandidates = lastFocusDate !== today ? selectFocusWords(allEntries, options.size) : null

      if (focusCandidates !== null) {
        selected = focusCandidates
        sessionType = 'focus'
      } else {
        // Determine intended type: alternate from the last completed non-focus session.
        // Focus sessions are skipped so they don't disturb the normal/repetition alternation.
        // No previous non-focus session → start with 'normal'.
        const lastType = this.sessionRepo.findLastCompletedNonFocus()?.type
        const intendedType: SessionType = lastType === 'normal' ? 'repetition' : 'normal'

        if (intendedType === 'repetition') {
          const candidates = selectRepetitionWords(allEntries, repSize, now)

          if (candidates.length >= repSize) {
            selected = candidates
            sessionType = 'repetition'
          } else {
            // Not enough due time-based words — skip repetition, create normal session.
            // The next call will see a 'normal' last-session and try repetition again.
            selected = selectSessionWords(allEntries, options.size, now)
            sessionType = 'normal'
          }
        } else {
          selected = selectSessionWords(allEntries, options.size, now)
          sessionType = 'normal'
        }
      }
    }

    if (selected.length === 0) {
      throw new ApiError(400, 'No vocabulary entries are available for a session')
    }

    // Clear the manuallyAdded flag on any selected words that had it set,
    // so they are treated as regular words in subsequent sessions.
    for (const entry of selected) {
      if (entry.manuallyAdded) {
        this.vocabRepo.update({ ...entry, manuallyAdded: false })
      }
    }

    const session: Session = {
      id: crypto.randomUUID(),
      direction: options.direction,
      type: sessionType,
      words: selected.map((e) => ({ vocabId: e.id, status: 'pending' })),
      status: 'open',
      createdAt: now.toISOString(),
    }

    this.sessionRepo.insert(session)

    return session
  }

  /**
   * Processes the user's answer for a word in the given session.
   *
   * Handles frequency-bucket answers (simple promote/demote), time-bucket
   * correct answers (promote), time-bucket wrong answers (second-chance flow),
   * and second-chance word outcomes.
   *
   * @throws {ApiError} 404 if session or vocab entry not found.
   * @throws {ApiError} 400 if session is completed or word is not pending.
   */
  submitAnswer(sessionId: string, vocabId: string, answers: string[], hintsUsed = false): AnswerResult {
    const session = this.sessionRepo.findById(sessionId)

    if (session === undefined) {
      throw new ApiError(404, `Session not found: ${sessionId}`)
    }

    if (session.status === 'completed') {
      throw new ApiError(400, 'Session is already completed')
    }

    const wordIndex = session.words.findIndex(
      (w) => w.vocabId === vocabId && w.status === 'pending',
    )

    if (wordIndex === -1) {
      throw new ApiError(400, `Word ${vocabId} is not pending in this session`)
    }

    const word = session.words[wordIndex]
    const entry = this.vocabRepo.findById(vocabId)

    if (entry === undefined) {
      throw new ApiError(404, `Vocabulary entry not found: ${vocabId}`)
    }

    const checkResult = checkAnswerDetailed(entry, session.direction, answers)
    const correct = checkResult.correct
    const isPartial = !correct && checkResult.matchedCount > 0 && checkResult.requiredCount > 1
    const now = new Date().toISOString()

    // Bridge a broken streak when the user answers the first question of a save-session.
    const wasFirstAnswer = session.words.every((w) => w.status === 'pending')

    if (wasFirstAnswer && this.creditsRepo.isStreakSavePending()) {
      const today = now.slice(0, 10)
      const yesterday = subtractDays(today, 1)

      this.creditsRepo.updateStreak(this.creditsRepo.getStreakCount(), yesterday)
      this.creditsRepo.setStreakSavePending(false)
    }

    const updatedWords = [...session.words]
    let outcome: AnswerOutcome
    let creditsEarned = 0
    let answerCost = 0
    let bucketMilestoneBonus = 0

    if (correct) {
      const result = this.handleCorrectAnswer(word, entry, updatedWords, wordIndex, now, checkResult.typos)
      outcome = result.outcome
      creditsEarned = result.creditsEarned
      bucketMilestoneBonus = result.bucketMilestoneBonus
    } else {
      const result = this.handleWrongAnswer(word, entry, updatedWords, wordIndex, now, session.words, isPartial, checkResult.typos, session.type === 'discovery')
      outcome = result.outcome
      answerCost = result.answerCost
    }

    const sessionCompleted = updatedWords.every((w) => w.status !== 'pending')
    const updatedSession: Session = {
      ...session,
      words: updatedWords,
      status: sessionCompleted ? 'completed' : 'open',
    }

    this.sessionRepo.update(updatedSession)

    // Resolve bucket values after all repo updates have been applied
    const newBucket = this.vocabRepo.findById(vocabId)?.bucket ?? entry.bucket
    const w1NewBucket =
      word.secondChanceFor !== undefined
        ? this.vocabRepo.findById(word.secondChanceFor)?.bucket
        : undefined

    const typos = checkResult.typos.length > 0 ? checkResult.typos : undefined

    let perfectBonus = 0
    let streakCredit = 0
    let milestoneLabel: string | undefined

    if (sessionCompleted) {
      if (updatedSession.type === 'focus') {
        this.creditsRepo.setLastFocusSessionDate(now.slice(0, 10))
      }

      if (updatedSession.type === 'discovery') {
        this.creditsRepo.setLastDiscoverySessionDate(now.slice(0, 10))
      }

      const isPerfect =
        !hintsUsed &&
        updatedWords.every((w) => w.status === 'correct') &&
        updatedWords.every((w) => w.secondChanceFor === undefined)

      if (isPerfect) {
        perfectBonus = updatedSession.type === 'discovery' ? 100 : 10
        this.creditsRepo.addBalance(perfectBonus)
      }

      // Award streak credit for the first session of each calendar day (UTC),
      // but only when the streak reaches 2 or more. A milestone reward replaces
      // the standard +1 daily credit when one is reached.
      const today = now.slice(0, 10)
      const lastDate = this.creditsRepo.getLastSessionDate()

      if (lastDate !== today) {
        const yesterday = subtractDays(today, 1)
        const newStreak = lastDate === yesterday ? this.creditsRepo.getStreakCount() + 1 : 1

        this.creditsRepo.updateStreak(newStreak, today)

        if (newStreak >= 2) {
          const milestone = checkMilestoneReached({
            streakCount: newStreak,
            weeksAwarded: this.creditsRepo.getStreakWeeksAwarded(),
            monthsAwarded: this.creditsRepo.getStreakMonthsAwarded(),
            streakStartDate: this.creditsRepo.getStreakStartDate(),
            today,
          })

          if (milestone !== null) {
            streakCredit = milestone.credits
            milestoneLabel = milestone.label
            this.creditsRepo.addBalance(streakCredit)

            if (milestone.type === 'week') {
              this.creditsRepo.setStreakWeeksAwarded(this.creditsRepo.getStreakWeeksAwarded() + 1)
            } else {
              this.creditsRepo.setStreakMonthsAwarded(this.creditsRepo.getStreakMonthsAwarded() + 1)
            }
          } else {
            streakCredit = 1
            this.creditsRepo.addBalance(streakCredit)
          }
        }
      }
    }

    // Recalculate and persist scores for all affected words.
    // When the session completes, all session words are now in completed history
    // and every word's countRecentErrors may have changed.
    const vocabIdsToRescore = sessionCompleted
      ? [...new Set(updatedSession.words.map((w) => w.vocabId))]
      : [vocabId, ...(word.secondChanceFor !== undefined ? [word.secondChanceFor] : [])]

    for (const id of vocabIdsToRescore) {
      const e = this.vocabRepo.findById(id)

      if (e !== undefined) {
        const updatedScore = computeScore(e, this.sessionRepo.countRecentErrors(id, 10))

        if (updatedScore !== e.score) {
          this.vocabRepo.update({ ...e, score: updatedScore })
        }
      }
    }

    return { correct, outcome, sessionCompleted, session: updatedSession, newBucket, w1NewBucket, typos, answerCost, creditsEarned, perfectBonus, bucketMilestoneBonus, streakCredit, milestoneLabel }
  }

  /**
   * Retroactively marks a session word as correct.
   *
   * Used when the user adds their wrong answer as a valid alternative after the
   * fact. The word's status is changed from `'incorrect'` to `'correct'` so the
   * session summary reflects the updated outcome.
   *
   * @throws {ApiError} 404 if session or vocab entry not found.
   * @throws {ApiError} 400 if the word is not in `'incorrect'` status.
   */
  markWordCorrect(sessionId: string, vocabId: string): Session {
    const session = this.sessionRepo.findById(sessionId)

    if (session === undefined) {
      throw new ApiError(404, `Session not found: ${sessionId}`)
    }

    const wordIndex = session.words.findIndex((w) => w.vocabId === vocabId && w.status === 'incorrect')

    if (wordIndex === -1) {
      throw new ApiError(400, `Word ${vocabId} is not incorrect in session ${sessionId}`)
    }

    const updatedWords = [...session.words]

    updatedWords[wordIndex] = { ...session.words[wordIndex], status: 'correct' }

    const updatedSession: Session = { ...session, words: updatedWords }

    this.sessionRepo.update(updatedSession)

    return updatedSession
  }

  /**
   * Pushes a pending word back to bucket 0 and removes it from the active session queue.
   * Only available during discovery sessions, within the per-session pushback budget.
   *
   * The word's status is set to `'pushed_back'`. If this causes all remaining words to
   * be resolved (no more pending words), the session is marked as completed.
   *
   * @returns The updated session.
   * @throws {ApiError} 404 if session or word not found.
   * @throws {ApiError} 400 if session is not a discovery session, word is not pending,
   *   or the pushback budget is exhausted.
   */
  pushBackWord(sessionId: string, vocabId: string): Session {
    const session = this.sessionRepo.findById(sessionId)

    if (session === undefined) {
      throw new ApiError(404, `Session not found: ${sessionId}`)
    }

    if (session.type !== 'discovery') {
      throw new ApiError(400, 'Push back is only available in discovery sessions')
    }

    const wordIndex = session.words.findIndex((w) => w.vocabId === vocabId && w.status === 'pending')

    if (wordIndex === -1) {
      throw new ApiError(400, `Word ${vocabId} is not pending in session ${sessionId}`)
    }

    const usedPushBacks = session.words.filter((w) => w.status === 'pushed_back').length

    if (usedPushBacks >= DISCOVERY_PUSHBACK_BUDGET) {
      throw new ApiError(400, `Push back budget exhausted (${DISCOVERY_PUSHBACK_BUDGET} per session)`)
    }

    const updatedWords = [...session.words]

    updatedWords[wordIndex] = { ...session.words[wordIndex], status: 'pushed_back' }

    const sessionCompleted = updatedWords.every((w) => w.status !== 'pending')
    const updatedSession: Session = {
      ...session,
      words: updatedWords,
      status: sessionCompleted ? 'completed' : 'open',
    }

    this.sessionRepo.update(updatedSession)

    if (sessionCompleted) {
      const today = new Date().toISOString().slice(0, 10)
      this.creditsRepo.setLastDiscoverySessionDate(today)
    }

    return updatedSession
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private handleCorrectAnswer(
    word: SessionWord,
    entry: VocabEntry,
    updatedWords: SessionWord[],
    wordIndex: number,
    now: string,
    typos: TypoMatch[],
  ): { outcome: AnswerOutcome; creditsEarned: number; bucketMilestoneBonus: number } {
    updatedWords[wordIndex] = { ...word, status: 'correct' }

    if (word.secondChanceFor !== undefined) {
      // Second-chance word answered correctly: W2 stays, W1 moves to bucket - 1.
      // W1's lastAskedAt is backdated so it becomes due again in ~24 h, ensuring
      // it appears in the next day's repetition session regardless of the new bucket's
      // normal interval.
      this.vocabRepo.update({ ...entry, lastAskedAt: now })

      const w1 = this.vocabRepo.findById(word.secondChanceFor)

      if (w1 !== undefined) {
        const newBucket = Math.max(0, w1.bucket - 1)

        // For time-based buckets (≥ 4), backdate lastAskedAt so w1 becomes due in ~24 h,
        // ensuring it appears in the next day's repetition session.
        // For frequency buckets (< 4), use now — the word will appear in every normal session anyway.
        const newLastAskedAt = newBucket >= 4
          ? new Date(new Date(now).getTime() - getIntervalMs(newBucket) + 24 * 60 * 60 * 1000).toISOString()
          : now

        this.vocabRepo.update({ ...w1, bucket: newBucket, lastAskedAt: newLastAskedAt })
      }

      return { outcome: typos.length > 0 ? 'second_chance_correct_typo' : 'second_chance_correct', creditsEarned: 0, bucketMilestoneBonus: 0 }
    }

    // Non-due time-based word answered correctly: reset the timer but do not promote.
    // Promotion is only earned when the word is actually due — answering early should
    // not accelerate the SRS schedule.
    if (entry.bucket >= 4 && !isDue(entry, new Date(now))) {
      this.vocabRepo.update({ ...entry, lastAskedAt: now })
      return { outcome: typos.length > 0 ? 'correct_typo' : 'correct', creditsEarned: 0, bucketMilestoneBonus: 0 }
    }

    // Normal correct answer: promote; update credits when a new maxBucket is reached
    const newBucket = entry.bucket + 1
    const newMaxBucket = Math.max(entry.maxBucket, newBucket)
    const creditDelta = newMaxBucket > entry.maxBucket ? (newBucket < 4 ? 1 : 5) : 0

    this.vocabRepo.update({ ...entry, bucket: newBucket, maxBucket: newMaxBucket, lastAskedAt: now })

    if (creditDelta > 0) {
      this.creditsRepo.addBalance(creditDelta)
    }

    // New-bucket milestone bonus: scales linearly when a bucket ≥ 6 is created for the first time.
    // Bucket 6 → +100, bucket 7 → +200, bucket N → +(N − 5) × 100.
    let bucketMilestoneBonus = 0

    if (newBucket >= 6 && newBucket > this.creditsRepo.getMaxBucketEver()) {
      bucketMilestoneBonus = (newBucket - 5) * 100
      this.creditsRepo.addBalance(bucketMilestoneBonus)
      this.creditsRepo.setMaxBucketEver(newBucket)
    }

    return { outcome: typos.length > 0 ? 'correct_typo' : 'correct', creditsEarned: creditDelta, bucketMilestoneBonus }
  }

  private handleWrongAnswer(
    word: SessionWord,
    entry: VocabEntry,
    updatedWords: SessionWord[],
    wordIndex: number,
    now: string,
    allSessionWords: SessionWord[],
    isPartial: boolean,
    typos: TypoMatch[],
    free = false,
  ): { outcome: AnswerOutcome; answerCost: number } {
    updatedWords[wordIndex] = { ...word, status: 'incorrect' }

    // Discovery sessions are free — wrong answers never charge credits.
    const balance = this.creditsRepo.getBalance()
    const answerCost = free ? 0 : Math.min(1, balance)

    if (answerCost > 0) {
      this.creditsRepo.addBalance(-answerCost)
    }

    if (word.secondChanceFor !== undefined) {
      if (isPartial) {
        // Second-chance word partially correct: W2 stays, W1 reset to bucket 1
        this.vocabRepo.update({ ...entry, lastAskedAt: now })

        const w1 = this.vocabRepo.findById(word.secondChanceFor)

        if (w1 !== undefined) {
          this.vocabRepo.update({ ...w1, bucket: 1, lastAskedAt: now })
        }

        return { outcome: typos.length > 0 ? 'second_chance_partial_typo' : 'second_chance_partial', answerCost }
      }

      // Second-chance word fully wrong: W2 stays, W1 reset to bucket 1
      this.vocabRepo.update({ ...entry, lastAskedAt: now })

      const w1 = this.vocabRepo.findById(word.secondChanceFor)

      if (w1 !== undefined) {
        this.vocabRepo.update({ ...w1, bucket: 1, lastAskedAt: now })
      }

      return { outcome: 'second_chance_incorrect', answerCost }
    }

    if (isPartial) {
      if (entry.bucket === 0) {
        // Bucket 0 words always advance to bucket 1, even on a partial answer
        this.vocabRepo.update({ ...entry, bucket: 1, lastAskedAt: now })
      } else {
        // Partially correct: word stays in its current bucket
        this.vocabRepo.update({ ...entry, lastAskedAt: now })
      }

      return { outcome: typos.length > 0 ? 'partial_typo' : 'partial', answerCost }
    }

    if (entry.bucket >= 4) {
      // Time-based bucket, fully wrong: trigger second-chance flow
      const secondEntry = this.selectSecondChanceWord(allSessionWords, entry)

      if (secondEntry !== undefined) {
        updatedWords.splice(wordIndex + 1, 0, { vocabId: secondEntry.id, status: 'pending', secondChanceFor: word.vocabId })
        // W1's bucket is NOT changed yet — we wait for the second-chance result
        return { outcome: 'second_chance', answerCost }
      }

      // No second-chance word available — demote W1 immediately
      this.vocabRepo.update({ ...entry, bucket: 1, lastAskedAt: now })

      return { outcome: 'incorrect', answerCost }
    }

    // Frequency bucket (0–3), fully wrong: reset to bucket 1
    this.vocabRepo.update({ ...entry, bucket: 1, lastAskedAt: now })

    return { outcome: 'incorrect', answerCost }
  }

  private selectSecondChanceWord(
    sessionWords: SessionWord[],
    originalEntry: VocabEntry,
  ): VocabEntry | undefined {
    const usedIds = new Set(sessionWords.map((w) => w.vocabId))
    const bucket = originalEntry.bucket

    for (const b of [bucket, bucket - 1, bucket + 1, bucket - 2, bucket + 2, bucket + 3]) {
      if (b < 0) {
        continue
      }

      const candidates = this.vocabRepo.findByBucket(b).filter((e) => !usedIds.has(e.id))

      if (candidates.length > 0) {
        return candidates[Math.floor(Math.random() * candidates.length)]
      }
    }

    return undefined
  }
}
