// @vitest-environment node

/**
 * Sanity tests for FakeSessionRepository.
 *
 * These ensure the fake behaves exactly like SqliteSessionRepository so that
 * service unit tests (Phase 4) can rely on it with confidence.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { FakeSessionRepository } from './FakeSessionRepository.ts'
import type { Session } from '../../shared/types/Session.ts'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: crypto.randomUUID(),
    direction: 'SOURCE_TO_TARGET',
    type: 'normal',
    words: [{ vocabId: 'word-1', status: 'pending' }],
    status: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    firstAnsweredAt: null,
    ...overrides,
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let repo: FakeSessionRepository

beforeEach(() => {
  repo = new FakeSessionRepository()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FakeSessionRepository', () => {
  it('findOpen returns undefined initially', () => {
    expect(repo.findOpen()).toBeUndefined()
  })

  it('findById returns undefined for unknown id', () => {
    expect(repo.findById('x')).toBeUndefined()
  })

  it('insert then findOpen returns the session', () => {
    const session = makeSession()

    repo.insert(session)

    expect(repo.findOpen()).toEqual(session)
  })

  it('insert then findById returns the session', () => {
    const session = makeSession()

    repo.insert(session)

    expect(repo.findById(session.id)).toEqual(session)
  })

  it('findOpen returns undefined when the session is completed', () => {
    repo.insert(makeSession({ status: 'completed' }))

    expect(repo.findOpen()).toBeUndefined()
  })

  it('update changes status to completed', () => {
    const session = makeSession()

    repo.insert(session)
    repo.update({ ...session, status: 'completed' })

    expect(repo.findById(session.id)?.status).toBe('completed')
  })

  it('update changes the words array', () => {
    const session = makeSession()

    repo.insert(session)
    repo.update({ ...session, words: [{ vocabId: 'w1', status: 'correct' }] })

    expect(repo.findById(session.id)?.words).toEqual([{ vocabId: 'w1', status: 'correct' }])
  })

  it('findOpen returns undefined after update marks session completed', () => {
    const session = makeSession()

    repo.insert(session)
    repo.update({ ...session, status: 'completed' })

    expect(repo.findOpen()).toBeUndefined()
  })

  it('returned sessions are copies — mutating them does not affect the store', () => {
    const session = makeSession()

    repo.insert(session)

    const found = repo.findById(session.id)
    if (found === undefined) { throw new Error('session not found') }

    found.status = 'completed'

    expect(repo.findById(session.id)?.status).toBe('open')
  })
})

// ── findLastCompleted ──────────────────────────────────────────────────────────

describe('FakeSessionRepository — findLastCompleted', () => {
  it('returns undefined when no completed sessions exist', () => {
    expect(repo.findLastCompleted()).toBeUndefined()
  })

  it('returns undefined when only an open session exists', () => {
    repo.insert(makeSession({ status: 'open' }))

    expect(repo.findLastCompleted()).toBeUndefined()
  })

  it('returns the completed session', () => {
    const session = makeSession({ status: 'completed' })

    repo.insert(session)

    expect(repo.findLastCompleted()).toEqual(session)
  })

  it('returns the most recently completed session when multiple exist', () => {
    const older = makeSession({ status: 'completed', createdAt: '2026-01-01T00:00:00Z' })
    const newer = makeSession({ status: 'completed', createdAt: '2026-06-01T00:00:00Z', type: 'repetition' })

    repo.insert(older)
    repo.insert(newer)

    expect(repo.findLastCompleted()?.id).toBe(newer.id)
  })
})
