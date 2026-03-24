/**
 * Business logic for training session management and SRS answer processing.
 *
 * Depends on `SessionRepository` and `VocabRepository` interfaces — never on
 * any concrete database implementation. Instantiated once at server startup
 * and injected into the session router.
 *
 * @example
 * ```ts
 * const service = new SessionService(sessionRepo, vocabRepo, creditsRepo, stressService)
 * const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 10 })
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
import { selectSessionWords, selectRepetitionWords, selectFocusWords, selectDiscoveryWords, selectStarredWords, selectStressWords, selectVeteranWords, isDue } from './srsSelection.ts'
import { getIntervalMs } from '../../../shared/utils/srsInterval.ts'
import { computeScore } from './srsScore.ts'
import { subtractDays } from '../streak/StreakService.ts'
import { checkMilestoneReached, diffDays } from '../../../shared/utils/streakMilestones.ts'
import type { StressSessionService } from './stressSessionService.ts'
import { STRESS_MIN_CREDITS, STRESS_MIN_WORDS, STRESS_SESSION_SIZE, calcStressFee } from './stressSessionService.ts'
import type { VeteranSessionService } from './veteranSessionService.ts'
import { VETERAN_MIN_BUCKET6_WORDS, VETERAN_MIN_WORDS } from './veteranSessionService.ts'
import { computeDifficulty } from '../../../shared/utils/difficulty.ts'

// ── Public types ──────────────────────────────────────────────────────────────

/** Number of active-pool words (buckets 1–4) below which a discovery session is triggered. */
export const DISCOVERY_POOL_THRESHOLD = 80

/** Minimum number of marked words required to start a starred session. */
export const STARRED_MIN_WORDS = 5

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
   * Credits deducted for this specific wrong answer: 1 if the balance was ≥ 1 and the
   * word is not a "virgin" word (bucket ≤ 1 and maxBucket ≤ 1), otherwise 0.
   * 0 for correct answers. Balance never goes negative.
   */
  answerCost: number
  /**
   * Credits earned by this specific answer (i.e. the word reached a new highest
   * time-based bucket). 0 for wrong answers or when no new bucket milestone was hit.
   */
  creditsEarned: number
  /**
   * Bonus credits awarded for completing the session with a perfect score (no mistakes,
   * no hints, and no second-chance words). 20 on a perfect session, 0 otherwise.
   */
  perfectBonus: number
  /**
   * One-time credit bonus awarded the first time any word globally reaches a bucket ≥ 6
   * that has never existed before. Scales as min((N−5)×100, 500). 0 otherwise.
   * A +1 star is also awarded when that new bucket is a group boundary (4, 6, 10, 14).
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

/** The automatic session types that participate in the shuffle rotation. */
const SHUFFLED_TYPES: SessionType[] = ['stress', 'discovery', 'focus', 'veteran', 'repetition', 'normal']

/** Fisher-Yates shuffle. Returns a new array. */
function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr]

  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }

  return out
}

export class SessionService {
  private sequence: SessionType[] = []
  private sequenceIndex = 0

  constructor(
    private readonly sessionRepo: SessionRepository,
    private readonly vocabRepo: VocabRepository,
    private readonly creditsRepo: CreditsRepository,
    private readonly stressService: StressSessionService,
    private readonly veteranService: VeteranSessionService,
    /** Override the shuffle function — used in tests to get a deterministic sequence. */
    private readonly shuffleFn: (types: SessionType[]) => SessionType[] = shuffleArray,
  ) {}

  /** Returns the currently open session, or `undefined` if none exists. */
  getOpenSession(): Session | undefined {
    return this.sessionRepo.findOpen()
  }

  /**
   * Creates a new training session using the SRS word selection algorithm.
   *
   * Session types are drawn from a shuffled round-robin sequence containing all
   * six automatic types (stress, discovery, focus, veteran, repetition, normal).
   * The sequence is advanced until a type whose eligibility conditions are met is
   * found. When the sequence is exhausted it is reshuffled. Starred sessions are
   * always manual and never part of this rotation.
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

    if (allEntries.length === 0) {
      throw new ApiError(400, 'No vocabulary entries are available for a session')
    }

    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const discSize = options.discoverySize ?? 24
    const repSize = options.repetitionSize ?? 24
    const balance = this.creditsRepo.getBalance()
    const bucket6PlusCount = allEntries.filter((e) => e.bucket >= 6).length

    // Trigger first-time scheduling for timed session types.
    if (balance >= STRESS_MIN_CREDITS) {
      this.stressService.scheduleFirst(today)
    }

    if (bucket6PlusCount >= VETERAN_MIN_BUCKET6_WORDS) {
      this.veteranService.scheduleFirst(today)
    }

    // Advance through the shuffled sequence until a qualifying type is found.
    // Normal always qualifies (words exist), so the loop always terminates.
    let selected: VocabEntry[] | null = null
    let sessionType: SessionType = 'normal'

    while (selected === null) {
      if (this.sequenceIndex >= this.sequence.length) {
        this.sequence = this.shuffleFn(SHUFFLED_TYPES)
        this.sequenceIndex = 0
      }

      const candidate = this.sequence[this.sequenceIndex]
      this.sequenceIndex++

      const words = this.trySelectType(candidate, allEntries, today, balance, bucket6PlusCount, options, now, discSize, repSize)

      if (words !== null) {
        selected = words
        sessionType = candidate
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
   * Returns whether a starred session can be started right now.
   *
   * A starred session is available when:
   * - The game is not paused.
   * - At least `STARRED_MIN_WORDS` words are marked (★).
   * - No starred session has been completed today (UTC).
   */
  getStarredSessionAvailable(): { available: boolean; markedCount: number; alreadyDoneToday: boolean } {
    const isPaused = this.creditsRepo.getPauseState().active
    const sessionInProgress = this.isSessionInProgress()
    const markedCount = this.vocabRepo.findAll().filter((e) => e.marked).length
    const today = new Date().toISOString().slice(0, 10)
    const alreadyDoneToday = this.creditsRepo.getLastStarredSessionDate() === today

    return {
      available: !isPaused && !sessionInProgress && markedCount >= STARRED_MIN_WORDS && !alreadyDoneToday,
      markedCount,
      alreadyDoneToday,
    }
  }

  /**
   * Creates a new starred session from the user's marked (★) words.
   *
   * At most 100 words are included, prioritised by score descending (ties
   * shuffled). The session type is `'starred'` and it does not affect the
   * normal/repetition alternation cycle. Limited to one per calendar day (UTC).
   *
   * @throws {ApiError} 423 if the streak is paused.
   * @throws {ApiError} 409 if a session is already open or one was already completed today.
   * @throws {ApiError} 400 if fewer than `STARRED_MIN_WORDS` words are marked.
   */
  createStarredSession(direction: Session['direction']): Session {
    if (this.creditsRepo.getPauseState().active) {
      throw new ApiError(423, 'Cannot start a session while the streak is paused')
    }

    const existing = this.sessionRepo.findOpen()

    if (existing !== undefined) {
      if (this.isSessionInProgress(existing)) {
        throw new ApiError(409, 'A training session is already open')
      }

      // Unstarted session — discard it so the starred session can be created.
      this.sessionRepo.delete(existing.id)
    }

    const today = new Date().toISOString().slice(0, 10)

    if (this.creditsRepo.getLastStarredSessionDate() === today) {
      throw new ApiError(409, 'A starred session has already been completed today')
    }

    const selected = selectStarredWords(this.vocabRepo.findAll(), 100)

    if (selected === null || selected.length < STARRED_MIN_WORDS) {
      throw new ApiError(400, `At least ${STARRED_MIN_WORDS} starred words are required for a starred session`)
    }

    const now = new Date()
    const session: Session = {
      id: crypto.randomUUID(),
      direction,
      type: 'starred',
      words: selected.map((e) => ({ vocabId: e.id, status: 'pending' })),
      status: 'open',
      createdAt: now.toISOString(),
    }

    this.sessionRepo.insert(session)

    return session
  }

  /**
   * Creates a new focus session containing the same words as an existing completed
   * focus session, reshuffled into a random order.
   *
   * Called when the user accepts the Focus Replay offer on the summary screen.
   * The replay is a plain `focus` session. Preventing a second replay offer is
   * enforced on the frontend via an `isReplay` flag — no DB marker is needed.
   *
   * Only original words from the completed session are included (second-chance
   * duplicate entries are excluded).
   *
   * @throws {ApiError} 404 if the original session is not found.
   * @throws {ApiError} 400 if the original session is not of type `focus`.
   * @throws {ApiError} 409 if a session is already open.
   */
  createReplaySession(originalSessionId: string): Session {
    const original = this.sessionRepo.findById(originalSessionId)

    if (original === undefined) {
      throw new ApiError(404, `Session not found: ${originalSessionId}`)
    }

    if (original.type !== 'focus') {
      throw new ApiError(400, 'Only focus sessions can be replayed')
    }

    const existing = this.sessionRepo.findOpen()

    if (existing !== undefined) {
      throw new ApiError(409, 'A training session is already open')
    }

    const originalVocabIds = original.words
      .filter((w) => w.secondChanceFor === undefined)
      .map((w) => w.vocabId)

    const shuffled = shuffleArray(originalVocabIds)

    const session: Session = {
      id: crypto.randomUUID(),
      direction: original.direction,
      type: 'focus',
      words: shuffled.map((vocabId) => ({ vocabId, status: 'pending' })),
      status: 'open',
      createdAt: new Date().toISOString(),
    }

    this.sessionRepo.insert(session)

    return session
  }

  /**
   * Returns the word selection for a given candidate session type, or `null` if
   * the type's eligibility conditions are not currently met (in which case the
   * caller skips it and tries the next type in the sequence).
   */
  private trySelectType(
    type: SessionType,
    allEntries: VocabEntry[],
    today: string,
    balance: number,
    bucket6PlusCount: number,
    options: CreateSessionOptions,
    now: Date,
    discSize: number,
    repSize: number,
  ): VocabEntry[] | null {
    switch (type) {
      case 'stress': {
        const qualifyingCount = allEntries.filter((e) => e.bucket >= 2).length

        return this.stressService.isAvailable(today, balance, qualifyingCount)
          ? selectStressWords(allEntries, STRESS_SESSION_SIZE, STRESS_MIN_WORDS)
          : null
      }
      case 'discovery': {
        const lastDiscoveryDate = this.creditsRepo.getLastDiscoverySessionDate()
        const activePoolCount = allEntries.filter((e) => e.bucket >= 1 && e.bucket <= 4).length

        if (lastDiscoveryDate === today || activePoolCount >= DISCOVERY_POOL_THRESHOLD) {
          return null
        }

        return selectDiscoveryWords(allEntries, discSize)
      }
      case 'focus':
        return selectFocusWords(allEntries, options.size)
      case 'veteran':
        return this.veteranService.isAvailable(today, bucket6PlusCount)
          ? selectVeteranWords(allEntries, options.veteranSize, VETERAN_MIN_WORDS)
          : null
      case 'repetition': {
        const words = selectRepetitionWords(allEntries, repSize, now)

        return words.length >= repSize ? words : null
      }
      case 'normal': {
        const words = selectSessionWords(allEntries, options.size, now)

        return words.length > 0 ? words : null
      }
      default:
        // 'starred' is never in the automatic rotation.
        return null
    }
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

    // Stress sessions use fee-based credit deductions and no second-chance.
    // Correct answers still promote the word (if due), but earn no credits.
    const isStress = session.type === 'stress'
    const stressFee = isStress ? calcStressFee(session.words.length) : undefined

    if (correct) {
      const result = this.handleCorrectAnswer(word, entry, updatedWords, wordIndex, now, checkResult.typos, !isStress)
      outcome = result.outcome
      creditsEarned = result.creditsEarned
      bucketMilestoneBonus = result.bucketMilestoneBonus
    } else {
      const result = this.handleWrongAnswer(word, entry, updatedWords, wordIndex, now, session.words, isPartial, checkResult.typos, session.type === 'discovery', stressFee)
      outcome = result.outcome
      answerCost = result.answerCost
    }

    const sessionCompleted = updatedWords.every((w) => w.status !== 'pending')
    const updatedSession: Session = {
      ...session,
      words: updatedWords,
      status: sessionCompleted ? 'completed' : 'open',
      firstAnsweredAt: session.firstAnsweredAt ?? (wasFirstAnswer ? now : null),
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
      if (updatedSession.type === 'discovery') {
        this.creditsRepo.setLastDiscoverySessionDate(now.slice(0, 10))
      }

      if (updatedSession.type === 'starred') {
        this.creditsRepo.setLastStarredSessionDate(now.slice(0, 10))
      }

      if (updatedSession.type === 'stress') {
        this.stressService.scheduleNext(now.slice(0, 10))
      }

      if (updatedSession.type === 'veteran') {
        this.veteranService.scheduleNext(now.slice(0, 10))
      }

      const isPerfect =
        !hintsUsed &&
        updatedWords.every((w) => w.status === 'correct') &&
        updatedWords.every((w) => w.secondChanceFor === undefined)

      if (isPerfect) {
        const isLargePerfectBonus = updatedSession.type === 'discovery' || updatedSession.type === 'stress'

        perfectBonus = isLargePerfectBonus ? 100 : 20
        this.creditsRepo.addBalance(perfectBonus)
      }

      // Award streak credit for the first session of each calendar day (UTC),
      // but only when the streak reaches 2 or more. A milestone reward replaces
      // the standard +1 daily credit when one is reached.
      //
      // The effective session date is when the first answer was given, not when
      // the session was completed. This lets a cross-midnight session (started
      // yesterday, finished today) count for yesterday's streak. If the session
      // spanned more than 2 calendar days it is treated as a fresh start today.
      const completionDate = now.slice(0, 10)
      const sessionDate = updatedSession.firstAnsweredAt?.slice(0, 10) ?? completionDate
      const spanDays = diffDays(sessionDate, completionDate)
      const effectiveDate = spanDays > 1 ? completionDate : sessionDate

      const lastDate = this.creditsRepo.getLastSessionDate()

      if (lastDate !== effectiveDate) {
        const yesterday = subtractDays(effectiveDate, 1)
        const newStreak = lastDate === yesterday ? this.creditsRepo.getStreakCount() + 1 : 1

        this.creditsRepo.updateStreak(newStreak, effectiveDate)

        if (newStreak >= 2) {
          const milestone = checkMilestoneReached({
            streakCount: newStreak,
            weeksAwarded: this.creditsRepo.getStreakWeeksAwarded(),
            monthsAwarded: this.creditsRepo.getStreakMonthsAwarded(),
            streakStartDate: this.creditsRepo.getStreakStartDate(),
            today: completionDate,
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
        const updatedMaxScore = Math.max(e.maxScore, updatedScore)
        const scoreChanged = updatedScore !== e.score || updatedMaxScore !== e.maxScore

        if (scoreChanged) {
          const withScore: VocabEntry = { ...e, score: updatedScore, maxScore: updatedMaxScore }

          this.vocabRepo.update({ ...withScore, difficulty: computeDifficulty(withScore) })
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
    earnCredits = true,
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

    // Correct answer: promote the word.
    const newBucket = entry.bucket + 1
    const newMaxBucket = Math.max(entry.maxBucket, newBucket)
    const creditDelta = earnCredits && newMaxBucket > entry.maxBucket ? 5 : 0

    this.vocabRepo.update({ ...entry, bucket: newBucket, maxBucket: newMaxBucket, lastAskedAt: now })

    if (creditDelta > 0) {
      this.creditsRepo.addBalance(creditDelta)
    }

    // New global bucket: fires the first time any word reaches a bucket level never seen before.
    // Awards +1 star when first entering a named group (Established b4, Veteran b6, Master b10, Legend b14).
    // Awards a scaled credit bonus for buckets ≥ 6, capped at 500
    // (bucket 6 → +100, bucket 7 → +200, …, bucket 10+ → +500).
    const GROUP_STAR_BUCKETS = new Set([4, 6, 10, 14])
    let bucketMilestoneBonus = 0

    if (earnCredits && newBucket >= 4 && newBucket > this.creditsRepo.getMaxBucketEver()) {
      this.creditsRepo.setMaxBucketEver(newBucket)

      if (GROUP_STAR_BUCKETS.has(newBucket)) {
        this.creditsRepo.addStars(1)
      }

      if (newBucket >= 6) {
        bucketMilestoneBonus = Math.min((newBucket - 5) * 100, 500)
        this.creditsRepo.addBalance(bucketMilestoneBonus)
      }
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
    stressFee?: number,
  ): { outcome: AnswerOutcome; answerCost: number } {
    updatedWords[wordIndex] = { ...word, status: 'incorrect' }

    // Compute the answer cost: stress uses fee-based deductions; discovery is free;
    // virgin words (bucket ≤ 1 and maxBucket ≤ 1 — never seen a higher bucket) are free;
    // all others deduct 1 credit.
    const balance = this.creditsRepo.getBalance()
    let answerCost: number

    if (stressFee !== undefined) {
      answerCost = Math.min(isPartial ? stressFee / 2 : stressFee, balance)
    } else {
      const isVirginWord = entry.bucket <= 1 && entry.maxBucket <= 1
      answerCost = (free || isVirginWord) ? 0 : Math.min(1, balance)
    }

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
      if (stressFee !== undefined) {
        // Stress partial: word stays in its current bucket regardless of bucket number
        this.vocabRepo.update({ ...entry, lastAskedAt: now })
      } else if (entry.bucket === 0) {
        // Bucket 0 words always advance to bucket 1, even on a partial answer
        this.vocabRepo.update({ ...entry, bucket: 1, lastAskedAt: now })
      } else {
        // Partially correct: word stays in its current bucket
        this.vocabRepo.update({ ...entry, lastAskedAt: now })
      }

      return { outcome: typos.length > 0 ? 'partial_typo' : 'partial', answerCost }
    }

    if (stressFee !== undefined) {
      // Stress wrong: reset to bucket 1 (same as normal session), no second-chance flow
      this.vocabRepo.update({ ...entry, bucket: 1, lastAskedAt: now })

      return { outcome: 'incorrect', answerCost }
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

  /** Returns `true` when the open session exists and has at least one answered word. */
  private isSessionInProgress(session?: Session): boolean {
    const s = session ?? this.sessionRepo.findOpen()

    return s?.words.some((w) => w.status !== 'pending') === true
  }

  /**
   * Selects a second-chance word that is not already part of the session,
   * preferring difficult and high-scored words.
   *
   * Each candidate is scored as `difficulty * 2 + bucket`. Candidates are sorted
   * descending by this score and the top tier — the larger of (top 5) or (top 25%)
   * — is collected. The final word is picked at random from that tier, so the
   * selection is biased toward hard words without being fully deterministic.
   */
  private selectSecondChanceWord(
    sessionWords: SessionWord[],
    originalEntry: VocabEntry,
  ): VocabEntry | undefined {
    const usedIds = new Set(sessionWords.map((w) => w.vocabId))

    const candidates = this.vocabRepo
      .findAll()
      .filter((e) => !usedIds.has(e.id) && e.id !== originalEntry.id)

    if (candidates.length === 0) {
      return undefined
    }

    const scored = candidates
      .map((e) => ({ entry: e, score: e.difficulty * 2 + e.bucket }))
      .sort((a, b) => b.score - a.score)

    const topN = Math.max(5, Math.ceil(scored.length * 0.25))
    const topTier = scored.slice(0, topN)

    return topTier[Math.floor(Math.random() * topTier.length)].entry
  }
}
