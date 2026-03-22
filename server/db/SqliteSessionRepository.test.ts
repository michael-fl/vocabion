// @vitest-environment node

/**
 * Tests for SqliteSessionRepository.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

import { openDatabase } from './database.ts'
import { SqliteSessionRepository } from './SqliteSessionRepository.ts'
import type { Session } from '../../shared/types/Session.ts'

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations')

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: crypto.randomUUID(),
    direction: 'SOURCE_TO_TARGET',
    type: 'normal',
    words: [{ vocabId: 'word-1', status: 'pending' }],
    status: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let db: Database.Database
let repo: SqliteSessionRepository

beforeEach(() => {
  db = openDatabase(':memory:', MIGRATIONS_DIR)
  repo = new SqliteSessionRepository(db)
})

afterEach(() => {
  db.close()
})

// ── findOpen ──────────────────────────────────────────────────────────────────

describe('findOpen', () => {
  it('returns undefined when no sessions exist', () => {
    expect(repo.findOpen()).toBeUndefined()
  })

  it('returns the open session after inserting one', () => {
    const session = makeSession()

    repo.insert(session)

    expect(repo.findOpen()).toEqual(session)
  })

  it('returns undefined when the only session is completed', () => {
    repo.insert(makeSession({ status: 'completed' }))

    expect(repo.findOpen()).toBeUndefined()
  })

  it('returns undefined after an open session is completed via update', () => {
    const session = makeSession()

    repo.insert(session)
    repo.update({ ...session, status: 'completed' })

    expect(repo.findOpen()).toBeUndefined()
  })
})

// ── findById ──────────────────────────────────────────────────────────────────

describe('findById', () => {
  it('returns the session for a known id', () => {
    const session = makeSession()

    repo.insert(session)

    expect(repo.findById(session.id)).toEqual(session)
  })

  it('returns undefined for an unknown id', () => {
    expect(repo.findById('no-such-id')).toBeUndefined()
  })
})

// ── insert / round-trip ───────────────────────────────────────────────────────

describe('insert', () => {
  it('round-trips all fields including direction and words', () => {
    const session = makeSession({
      direction: 'TARGET_TO_SOURCE',
      words: [
        { vocabId: 'w1', status: 'correct' },
        { vocabId: 'w2', status: 'incorrect' },
      ],
    })

    repo.insert(session)

    expect(repo.findById(session.id)).toEqual(session)
  })

  it('preserves words as a proper array, not a JSON string', () => {
    const session = makeSession()

    repo.insert(session)

    const found = repo.findById(session.id)

    expect(Array.isArray(found?.words)).toBe(true)
    expect(found?.words).toEqual(session.words)
  })

  it('can insert a completed session', () => {
    const session = makeSession({ status: 'completed' })

    repo.insert(session)

    expect(repo.findById(session.id)?.status).toBe('completed')
  })
})

// ── update ────────────────────────────────────────────────────────────────────

describe('update', () => {
  it('updates status from open to completed', () => {
    const session = makeSession()

    repo.insert(session)
    repo.update({ ...session, status: 'completed' })

    expect(repo.findById(session.id)?.status).toBe('completed')
  })

  it('updates the words array', () => {
    const session = makeSession({ words: [{ vocabId: 'w1', status: 'pending' }] })

    repo.insert(session)

    const updatedWords = [
      { vocabId: 'w1', status: 'correct' as const },
      { vocabId: 'w2', status: 'pending' as const },
    ]

    repo.update({ ...session, words: updatedWords })

    expect(repo.findById(session.id)?.words).toEqual(updatedWords)
  })

  it('leaves other sessions unchanged', () => {
    const a = makeSession()
    const b = makeSession()

    repo.insert(a)
    repo.insert(b)
    repo.update({ ...a, status: 'completed' })

    expect(repo.findById(b.id)?.status).toBe('open')
  })
})

// ── findLastCompleted ──────────────────────────────────────────────────────────

describe('findLastCompleted', () => {
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

  it('round-trips the type field correctly', () => {
    const session = makeSession({ status: 'completed', type: 'repetition' })

    repo.insert(session)

    expect(repo.findLastCompleted()?.type).toBe('repetition')
  })
})
