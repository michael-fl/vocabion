// @vitest-environment node

/**
 * Tests for SqliteVocabRepository.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

import { openDatabase } from './database.ts'
import { SqliteVocabRepository } from './SqliteVocabRepository.ts'
import type { VocabEntry } from '../../shared/types/VocabEntry.ts'

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations')

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
    manuallyAdded: false,
    marked: false,
    score: 0,
    ...overrides,
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let db: Database.Database
let repo: SqliteVocabRepository

beforeEach(() => {
  db = openDatabase(':memory:', MIGRATIONS_DIR)
  repo = new SqliteVocabRepository(db)
})

afterEach(() => {
  db.close()
})

// ── findAll ───────────────────────────────────────────────────────────────────

describe('findAll', () => {
  it('returns an empty array when no entries exist', () => {
    expect(repo.findAll()).toEqual([])
  })

  it('returns all inserted entries', () => {
    repo.insert(makeEntry())
    repo.insert(makeEntry())

    expect(repo.findAll()).toHaveLength(2)
  })
})

// ── findById ──────────────────────────────────────────────────────────────────

describe('findById', () => {
  it('returns the entry for a known id', () => {
    const entry = makeEntry()

    repo.insert(entry)

    expect(repo.findById(entry.id)).toEqual(entry)
  })

  it('returns undefined for an unknown id', () => {
    expect(repo.findById('no-such-id')).toBeUndefined()
  })
})

// ── findByBucket ──────────────────────────────────────────────────────────────

describe('findByBucket', () => {
  it('returns only entries in the specified bucket', () => {
    repo.insert(makeEntry({ bucket: 0 }))
    repo.insert(makeEntry({ bucket: 1 }))
    repo.insert(makeEntry({ bucket: 0 }))

    expect(repo.findByBucket(0)).toHaveLength(2)
    expect(repo.findByBucket(1)).toHaveLength(1)
  })

  it('returns an empty array when no entries are in the bucket', () => {
    expect(repo.findByBucket(99)).toEqual([])
  })
})

// ── insert / round-trip ───────────────────────────────────────────────────────

describe('insert', () => {
  it('round-trips all fields when lastAskedAt is null', () => {
    const entry = makeEntry({
      source: 'Fahrrad',
      target: ['bicycle', 'bike'],
      bucket: 3,
      lastAskedAt: null,
    })

    repo.insert(entry)

    expect(repo.findById(entry.id)).toEqual(entry)
  })

  it('round-trips a non-null lastAskedAt timestamp', () => {
    const entry = makeEntry({ lastAskedAt: '2026-06-01T12:00:00Z' })

    repo.insert(entry)

    expect(repo.findById(entry.id)?.lastAskedAt).toBe('2026-06-01T12:00:00Z')
  })

  it('preserves source as a plain string and target as a proper array', () => {
    const entry = makeEntry({ source: 'Hund', target: ['dog', 'hound'] })

    repo.insert(entry)

    const found = repo.findById(entry.id)

    expect(typeof found?.source).toBe('string')
    expect(found?.source).toBe('Hund')
    expect(found?.target).toEqual(['dog', 'hound'])
  })
})

// ── update ────────────────────────────────────────────────────────────────────

describe('update', () => {
  it('updates bucket and lastAskedAt', () => {
    const entry = makeEntry({ bucket: 0, lastAskedAt: null })

    repo.insert(entry)
    repo.update({ ...entry, bucket: 2, lastAskedAt: '2026-06-01T12:00:00Z' })

    const updated = repo.findById(entry.id)

    expect(updated?.bucket).toBe(2)
    expect(updated?.lastAskedAt).toBe('2026-06-01T12:00:00Z')
  })

  it('persists maxBucket', () => {
    const entry = makeEntry({ bucket: 4, maxBucket: 4 })

    repo.insert(entry)
    repo.update({ ...entry, bucket: 5, maxBucket: 5 })

    expect(repo.findById(entry.id)?.maxBucket).toBe(5)
  })

  it('updates source and target translations', () => {
    const entry = makeEntry()

    repo.insert(entry)
    repo.update({ ...entry, source: 'Stuhl', target: ['chair'] })

    const updated = repo.findById(entry.id)

    expect(updated?.source).toBe('Stuhl')
    expect(updated?.target).toEqual(['chair'])
  })

  it('leaves other entries unchanged', () => {
    const a = makeEntry()
    const b = makeEntry()

    repo.insert(a)
    repo.insert(b)
    repo.update({ ...a, bucket: 5 })

    expect(repo.findById(b.id)?.bucket).toBe(b.bucket)
  })
})

// ── delete ────────────────────────────────────────────────────────────────────

describe('delete', () => {
  it('removes the entry so findById returns undefined', () => {
    const entry = makeEntry()

    repo.insert(entry)
    repo.delete(entry.id)

    expect(repo.findById(entry.id)).toBeUndefined()
  })

  it('does not affect other entries', () => {
    const a = makeEntry()
    const b = makeEntry()

    repo.insert(a)
    repo.insert(b)
    repo.delete(a.id)

    expect(repo.findById(b.id)).toEqual(b)
  })

  it('is a no-op for an unknown id', () => {
    expect(() => { repo.delete('no-such-id') }).not.toThrow()
  })
})
