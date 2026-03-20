/**
 * In-memory implementation of `SessionRepository` for use in unit tests.
 *
 * Backed by a `Map` — no SQLite, no filesystem, no I/O. Sessions are shallow-
 * copied on read and write to prevent tests from accidentally mutating internal
 * state.
 *
 * Instantiate a fresh `FakeSessionRepository` in each test's `beforeEach` to
 * guarantee isolation between tests.
 *
 * @example
 * ```ts
 * import { FakeSessionRepository } from '../../test-utils/FakeSessionRepository.ts'
 *
 * const repo = new FakeSessionRepository()
 * const service = new SessionService(repo)
 * ```
 */
import type { Session } from '../../shared/types/Session.ts'
import type { SessionRepository } from '../features/session/SessionRepository.ts'

export class FakeSessionRepository implements SessionRepository {
  private readonly store = new Map<string, Session>()

  findOpen(): Session | undefined {
    for (const session of this.store.values()) {
      if (session.status === 'open') {
        return { ...session, words: [...session.words] }
      }
    }

    return undefined
  }

  findById(id: string): Session | undefined {
    const session = this.store.get(id)

    return session !== undefined ? { ...session, words: [...session.words] } : undefined
  }

  findLastCompleted(): Session | undefined {
    const completed = [...this.store.values()]
      .filter((s) => s.status === 'completed')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    const last = completed.at(0)

    return last !== undefined ? { ...last, words: [...last.words] } : undefined
  }

  findLastCompletedNonFocus(): Session | undefined {
    const completed = [...this.store.values()]
      .filter((s) => s.status === 'completed' && s.type !== 'focus')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    const last = completed.at(0)

    return last !== undefined ? { ...last, words: [...last.words] } : undefined
  }

  insert(session: Session): void {
    this.store.set(session.id, { ...session, words: [...session.words] })
  }

  update(session: Session): void {
    this.store.set(session.id, { ...session, words: [...session.words] })
  }

  countRecentErrors(vocabId: string, sessionLimit: number): number {
    const recentSessions = [...this.store.values()]
      .filter((s) => s.status === 'completed')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, sessionLimit)

    return recentSessions.filter((s) =>
      s.words.some((w) => w.vocabId === vocabId && w.status === 'incorrect'),
    ).length
  }
}
