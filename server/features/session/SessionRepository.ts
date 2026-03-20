/**
 * Repository interface for training sessions.
 *
 * Services depend on this interface, never on any concrete implementation.
 * The SQLite implementation lives in `server/db/SqliteSessionRepository.ts`.
 * The in-memory fake for tests lives in `server/test-utils/FakeSessionRepository.ts`.
 *
 * @example
 * ```ts
 * class SessionService {
 *   constructor(private readonly repo: SessionRepository) {}
 * }
 * ```
 */
import type { Session } from '../../../shared/types/Session.ts'

export interface SessionRepository {
  /** Returns the currently open session, or `undefined` if none exists. */
  findOpen(): Session | undefined

  /** Returns the session with the given id, or `undefined` if not found. */
  findById(id: string): Session | undefined

  /** Returns the most recently completed session, or `undefined` if none exists. */
  findLastCompleted(): Session | undefined

  /**
   * Returns the most recently completed session whose type is not `'focus'`,
   * or `undefined` if none exists. Used by the normal/repetition alternation
   * logic so that a focus session does not disrupt the alternation state.
   */
  findLastCompletedNonFocus(): Session | undefined

  /** Inserts a new session. Throws if a session with the same id already exists. */
  insert(session: Session): void

  /** Updates the `words` and `status` fields of an existing session. */
  update(session: Session): void

  /**
   * Returns how many of the `sessionLimit` most recent completed sessions
   * (globally) contain an incorrect answer for the given word.
   * Sessions in which the word did not appear count as 0 errors.
   */
  countRecentErrors(vocabId: string, sessionLimit: number): number
}
