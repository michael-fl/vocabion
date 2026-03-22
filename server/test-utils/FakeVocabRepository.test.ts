// @vitest-environment node

/**
 * Sanity tests for FakeVocabRepository.
 *
 * These ensure the fake behaves exactly like SqliteVocabRepository so that
 * service unit tests (Phase 4) can rely on it with confidence.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { FakeVocabRepository } from './FakeVocabRepository.ts'
import type { VocabEntry } from '../../shared/types/VocabEntry.ts'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<VocabEntry> = {}): VocabEntry {
  return {
    id: crypto.randomUUID(),
    source: 'Tisch',
    target: ['table'],
    bucket: 0,
    lastAskedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    maxBucket: 0,
    maxScore: 0,
    difficulty: 0,
    manuallyAdded: false,
    marked: false,
    score: 0,
    ...overrides,
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let repo: FakeVocabRepository

beforeEach(() => {
  repo = new FakeVocabRepository()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FakeVocabRepository', () => {
  it('findAll returns empty array initially', () => {
    expect(repo.findAll()).toEqual([])
  })

  it('findById returns undefined for unknown id', () => {
    expect(repo.findById('x')).toBeUndefined()
  })

  it('insert then findById returns the entry', () => {
    const entry = makeEntry()

    repo.insert(entry)

    expect(repo.findById(entry.id)).toEqual(entry)
  })

  it('findAll returns all inserted entries', () => {
    repo.insert(makeEntry())
    repo.insert(makeEntry())

    expect(repo.findAll()).toHaveLength(2)
  })

  it('findByBucket filters by bucket', () => {
    repo.insert(makeEntry({ bucket: 0 }))
    repo.insert(makeEntry({ bucket: 1 }))

    expect(repo.findByBucket(0)).toHaveLength(1)
    expect(repo.findByBucket(1)).toHaveLength(1)
    expect(repo.findByBucket(2)).toHaveLength(0)
  })

  it('update replaces the stored entry', () => {
    const entry = makeEntry({ bucket: 0 })

    repo.insert(entry)
    repo.update({ ...entry, bucket: 3 })

    expect(repo.findById(entry.id)?.bucket).toBe(3)
  })

  it('delete removes the entry', () => {
    const entry = makeEntry()

    repo.insert(entry)
    repo.delete(entry.id)

    expect(repo.findById(entry.id)).toBeUndefined()
  })

  it('delete is a no-op for unknown ids', () => {
    expect(() => { repo.delete('x') }).not.toThrow()
  })

  it('returned entries are copies — mutating them does not affect the store', () => {
    const entry = makeEntry()

    repo.insert(entry)

    const found = repo.findById(entry.id)
    if (found === undefined) { throw new Error('entry not found') }

    found.bucket = 99

    expect(repo.findById(entry.id)?.bucket).toBe(0)
  })
})
