/**
 * HTTP client for the session API (`/api/v1/session`).
 *
 * All functions throw an `Error` if the server responds with a non-OK status.
 *
 * @example
 * ```ts
 * import { getOpenSession, createSession, submitAnswer } from './sessionApi.ts'
 * const session = await createSession('SOURCE_TO_TARGET', 12)
 * const result = await submitAnswer(session.id, wordId, ['table'])
 * ```
 */
import type { Session, SessionDirection, SessionType } from '../../shared/types/Session.ts'

const BASE = '/api/v1/session'

/** Number of free push-backs available per discovery session. Must match server constant. */
export const DISCOVERY_PUSHBACK_BUDGET = 10

/** Minimum remaining due words in buckets 4+ required to offer a next Breakthrough++ chapter. Must match server MIN_SESSION_SIZE. */
export const BREAKTHROUGH_PLUS_NEXT_CHAPTER_MIN_WORDS = 12

/** Describes what happened when an answer was submitted. */
export type AnswerOutcome =
  | 'correct'
  | 'correct_typo'
  | 'incorrect'
  | 'partial'
  | 'partial_typo'
  | 'second_chance'
  | 'second_chance_correct'
  | 'second_chance_correct_typo'
  | 'second_chance_incorrect'

/** A single typo correction returned when a close-but-not-exact answer was accepted. */
export interface TypoMatch {
  typed: string
  correct: string
}

/** Returned by `submitAnswer`. */
export interface AnswerResult {
  correct: boolean
  outcome: AnswerOutcome
  sessionCompleted: boolean
  session: Session
  /** New bucket of the answered word. For `second_chance`: W1's current (unchanged) bucket. */
  newBucket: number
  /** For `second_chance_correct/partial/incorrect`: new bucket of W1 after resolution. */
  w1NewBucket?: number
  /** For `correct_typo` and `second_chance_correct_typo`: one entry per typo-matched answer. */
  typos?: TypoMatch[]
  /** Credits deducted for this wrong answer: 1 if balance was ≥ 1, otherwise 0. */
  answerCost: number
  /** Credits earned by this answer (word reached a new highest time-based bucket). */
  creditsEarned: number
  /** Bonus credits awarded for a perfect session (no mistakes, no hints, no second chances). 10 or 0. */
  perfectBonus: number
  /** One-time bonus of 100 credits when a word enters a bucket ≥ 6 that has never existed before. 100 or 0. */
  bucketMilestoneBonus: number
  /** Streak-related credits awarded on session completion: 1 (daily) or the milestone amount. 0 if none. */
  streakCredit: number
  /** Label of the streak milestone reached, e.g. 'Week 1' or 'Month 1'. Absent if no milestone. */
  milestoneLabel?: string
  /**
   * Only populated for `breakthrough_plus` sessions when `sessionCompleted` is true.
   * The number of due words in buckets 4+ remaining after this chapter.
   * 0 means the pool is exhausted. `undefined` for all other session types.
   */
  remainingDueCount?: number
}

/** Returns the currently open session, or `null` if none exists. */
export async function getOpenSession(): Promise<Session | null> {
  const res = await fetch(`${BASE}/open`)

  if (!res.ok) {
    throw new Error(`Failed to get open session: ${res.status}`)
  }

  const data = (await res.json()) as { session: Session | null }

  return data.session
}

/** Availability info for a starred session. */
export interface StarredAvailable {
  available: boolean
  markedCount: number
  alreadyDoneToday: boolean
}

/** Returns whether a starred session can be started right now. */
export async function getStarredAvailable(): Promise<StarredAvailable> {
  const res = await fetch(`${BASE}/starred-available`)

  if (!res.ok) {
    throw new Error(`Failed to get starred session availability: ${res.status}`)
  }

  return res.json() as Promise<StarredAvailable>
}

/** Creates a new starred session (all marked words, up to 100). */
export async function createStarredSession(
  direction: SessionDirection = 'SOURCE_TO_TARGET',
): Promise<Session> {
  const res = await fetch(`${BASE}/starred`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction }),
  })

  if (!res.ok) {
    throw new Error(`Failed to create starred session: ${res.status}`)
  }

  return res.json() as Promise<Session>
}

/** Availability info for a manual review session. */
export interface ReviewAvailable {
  available: boolean
  sourceSessionId: string | null
  sourceSessionType: SessionType | null
  wordCount: number
}

/** Returns whether a review session can be started right now. */
export async function getReviewAvailable(): Promise<ReviewAvailable> {
  const res = await fetch(`${BASE}/review/available`)

  if (!res.ok) {
    throw new Error(`Failed to get review session availability: ${res.status}`)
  }

  return res.json() as Promise<ReviewAvailable>
}

/** Creates a new review session replaying the words of the last regular session. */
export async function createReviewSession(
  direction: SessionDirection = 'SOURCE_TO_TARGET',
): Promise<Session> {
  const res = await fetch(`${BASE}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction }),
  })

  if (!res.ok) {
    throw new Error(`Failed to create review session: ${res.status}`)
  }

  return res.json() as Promise<Session>
}

/** Creates a new training session with the given direction and word count. */
export async function createSession(
  direction: SessionDirection = 'SOURCE_TO_TARGET',
  size = 12,
): Promise<Session> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction, size }),
  })

  if (!res.ok) {
    throw new Error(`Failed to create session: ${res.status}`)
  }

  return res.json() as Promise<Session>
}

/**
 * Retroactively marks a session word as correct.
 *
 * Called after the user adds their answer as a valid alternative, so the
 * session summary reflects the updated outcome.
 */
export async function markWordCorrect(sessionId: string, vocabId: string): Promise<Session> {
  const res = await fetch(`${BASE}/${sessionId}/words/${vocabId}/correct`, {
    method: 'POST',
  })

  if (!res.ok) {
    throw new Error(`Failed to mark word as correct: ${res.status}`)
  }

  return res.json() as Promise<Session>
}

/** Pushes a pending word back to bucket 0 in a discovery session. Returns the updated session. */
export async function pushBackWord(sessionId: string, vocabId: string): Promise<Session> {
  const res = await fetch(`${BASE}/${sessionId}/words/${vocabId}/pushback`, {
    method: 'POST',
  })

  if (!res.ok) {
    throw new Error(`Failed to push back word: ${res.status}`)
  }

  return res.json() as Promise<Session>
}

/**
 * Creates the next Breakthrough++ chapter session after the user chooses to
 * continue from the summary screen.
 */
export async function createNextChapterSession(sessionId: string): Promise<Session> {
  const res = await fetch(`${BASE}/${sessionId}/next-chapter`, {
    method: 'POST',
  })

  if (!res.ok) {
    throw new Error(`Failed to create next chapter: ${res.status}`)
  }

  return res.json() as Promise<Session>
}

/**
 * Creates a new focus session with the same words as the given completed focus
 * session, reshuffled into a random order.
 *
 * Called when the user accepts the Focus Replay offer on the summary screen.
 */
export async function createReplaySession(sessionId: string): Promise<Session> {
  const res = await fetch(`${BASE}/${sessionId}/replay`, {
    method: 'POST',
  })

  if (!res.ok) {
    throw new Error(`Failed to create replay session: ${res.status}`)
  }

  return res.json() as Promise<Session>
}

/** Submits an answer for a word in the given session. */
export async function submitAnswer(
  sessionId: string,
  vocabId: string,
  answers: string[],
  hintsUsed = false,
): Promise<AnswerResult> {
  const res = await fetch(`${BASE}/${sessionId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vocabId, answers, hintsUsed }),
  })

  if (!res.ok) {
    throw new Error(`Failed to submit answer: ${res.status}`)
  }

  return res.json() as Promise<AnswerResult>
}
