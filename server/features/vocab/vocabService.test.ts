// @vitest-environment node

/**
 * Unit tests for VocabService using FakeVocabRepository.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { VocabService } from './vocabService.ts'
import { FakeVocabRepository } from '../../test-utils/FakeVocabRepository.ts'
import { FakeSessionRepository } from '../../test-utils/FakeSessionRepository.ts'
import { FakeCreditsRepository } from '../../test-utils/FakeCreditsRepository.ts'
import { ApiError } from '../../errors/ApiError.ts'
import type { VocabEntry } from '../../../shared/types/VocabEntry.ts'

function expectApiError(fn: () => unknown, status: number): void {
  let caught: unknown
  try { fn() } catch (e) { caught = e }
  expect(caught).toBeInstanceOf(ApiError)
  expect((caught as ApiError).status).toBe(status)
}

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

let repo: FakeVocabRepository
let sessionRepo: FakeSessionRepository
let creditsRepo: FakeCreditsRepository
let service: VocabService

beforeEach(() => {
  repo = new FakeVocabRepository()
  sessionRepo = new FakeSessionRepository()
  creditsRepo = new FakeCreditsRepository()
  service = new VocabService(repo, sessionRepo, creditsRepo)
})

// ── listAll ───────────────────────────────────────────────────────────────────

describe('listAll', () => {
  it('returns an empty array when no entries exist', () => {
    expect(service.listAll()).toEqual([])
  })

  it('returns all inserted entries', () => {
    repo.insert(makeEntry())
    repo.insert(makeEntry())

    expect(service.listAll()).toHaveLength(2)
  })
})

// ── getById ───────────────────────────────────────────────────────────────────

describe('getById', () => {
  it('returns the entry for a known id', () => {
    const entry = makeEntry()

    repo.insert(entry)

    expect(service.getById(entry.id)).toEqual(entry)
  })

  it('throws ApiError 404 for an unknown id', () => {
    expectApiError(() => service.getById('no-such-id'), 404)
  })

  it('throws with a message containing the id', () => {
    expect(() => service.getById('missing')).toThrow('missing')
  })
})

// ── create ────────────────────────────────────────────────────────────────────

describe('create', () => {
  it('returns a VocabEntry with a generated id', () => {
    const entry = service.create({ source: 'Hund', target: ['dog'] })

    expect(typeof entry.id).toBe('string')
    expect(entry.id.length).toBeGreaterThan(0)
  })

  it('starts with bucket 0 and null lastAskedAt', () => {
    const entry = service.create({ source: 'Hund', target: ['dog'] })

    expect(entry.bucket).toBe(0)
    expect(entry.lastAskedAt).toBeNull()
  })

  it('stores the provided translations', () => {
    const entry = service.create({ source: 'Fahrrad', target: ['bicycle', 'bike'] })

    expect(entry.source).toBe('Fahrrad')
    expect(entry.target).toEqual(['bicycle', 'bike'])
  })

  it('persists the entry so it appears in listAll', () => {
    service.create({ source: 'Hund', target: ['dog'] })

    expect(service.listAll()).toHaveLength(1)
  })

  it('sets createdAt and updatedAt to the same timestamp', () => {
    const entry = service.create({ source: 'Hund', target: ['dog'] })

    expect(entry.createdAt).toBe(entry.updatedAt)
  })

  it('sets manuallyAdded to true', () => {
    const entry = service.create({ source: 'Hund', target: ['dog'] })

    expect(entry.manuallyAdded).toBe(true)
  })
})

// ── update ────────────────────────────────────────────────────────────────────

describe('update', () => {
  it('updates the translations', () => {
    const entry = makeEntry()

    repo.insert(entry)

    const updated = service.update(entry.id, { source: 'Stuhl', target: ['chair'] })

    expect(updated.source).toBe('Stuhl')
    expect(updated.target).toEqual(['chair'])
  })

  it('does not change bucket or lastAskedAt', () => {
    const entry = makeEntry({ bucket: 3, lastAskedAt: '2026-05-01T00:00:00Z' })

    repo.insert(entry)

    const updated = service.update(entry.id, { source: 'Stuhl', target: ['chair'] })

    expect(updated.bucket).toBe(3)
    expect(updated.lastAskedAt).toBe('2026-05-01T00:00:00Z')
  })

  it('throws ApiError 404 for an unknown id', () => {
    expectApiError(() => service.update('no-such-id', { source: 'Stuhl', target: ['chair'] }), 404)
  })
})

// ── delete ────────────────────────────────────────────────────────────────────

describe('delete', () => {
  it('removes the entry', () => {
    const entry = makeEntry()

    repo.insert(entry)
    service.delete(entry.id)

    expect(service.listAll()).toHaveLength(0)
  })

  it('throws ApiError 404 for an unknown id', () => {
    expectApiError(() => { service.delete('no-such-id') }, 404)
  })
})

// ── importEntries ─────────────────────────────────────────────────────────────

describe('importEntries', () => {
  it('returns the count of imported entries and merged count', () => {
    const result = service.importEntries({
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      entries: [
        { source: 'Tisch', target: ['table'], bucket: 0 },
        { source: 'Hund', target: ['dog'], bucket: 2 },
      ],
    })

    expect(result.imported).toBe(2)
    expect(result.merged).toBe(0)
  })

  it('persists all new imported entries', () => {
    service.importEntries({
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      entries: [
        { source: 'Tisch', target: ['table'], bucket: 0 },
        { source: 'Hund', target: ['dog'], bucket: 2 },
      ],
    })

    expect(service.listAll()).toHaveLength(2)
  })

  it('uses the bucket value from the import data', () => {
    service.importEntries({
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      entries: [{ source: 'Tisch', target: ['table'], bucket: 5 }],
    })

    expect(service.listAll()[0].bucket).toBe(5)
  })

  it('defaults bucket to 0 when not specified', () => {
    service.importEntries({
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      entries: [{ source: 'Tisch', target: ['table'] }],
    })

    expect(service.listAll()[0].bucket).toBe(0)
  })

  it('sets lastAskedAt to null for all imported entries', () => {
    service.importEntries({
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      entries: [{ source: 'Tisch', target: ['table'], bucket: 0 }],
    })

    expect(service.listAll()[0].lastAskedAt).toBeNull()
  })

  it('merges target translations into an existing entry when the source word matches', () => {
    const existing = makeEntry({ source: 'Auto', target: ['car'], bucket: 3 })

    repo.insert(existing)

    service.importEntries({
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      entries: [{ source: 'Auto', target: ['car', 'automobile'], bucket: 3 }],
    })

    expect(service.listAll()).toHaveLength(1)

    const entry = service.listAll()[0]

    expect(entry.source).toBe('Auto')
    expect(entry.target).toEqual(['car', 'automobile'])
  })

  it('moves the existing entry to the bucket from the import file on merge', () => {
    const existing = makeEntry({ source: 'Auto', target: ['car'], bucket: 3 })

    repo.insert(existing)

    service.importEntries({
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      entries: [{ source: 'Auto', target: ['car'], bucket: 5 }],
    })

    expect(service.listAll()[0].bucket).toBe(5)
  })

  it('keeps the existing bucket when bucket is not specified in the import file', () => {
    const existing = makeEntry({ source: 'Auto', target: ['car'], bucket: 3 })

    repo.insert(existing)

    service.importEntries({
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      entries: [{ source: 'Auto', target: ['car'] }],
    })

    expect(service.listAll()[0].bucket).toBe(3)
  })

  it('counts merged entries in the returned merged field', () => {
    repo.insert(makeEntry({ source: 'Auto', target: ['car'] }))
    repo.insert(makeEntry({ source: 'Hund', target: ['dog'] }))

    const result = service.importEntries({
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      entries: [
        { source: 'Auto', target: ['car'] },
        { source: 'Katze', target: ['cat'] },
        { source: 'Hund', target: ['dog'] },
      ],
    })

    expect(result.imported).toBe(3)
    expect(result.merged).toBe(2)
  })
})

// ── exportAll ─────────────────────────────────────────────────────────────────

describe('exportAll', () => {
  it('returns version 1 and a non-empty exportedAt', () => {
    const result = service.exportAll()

    expect(result.version).toBe(1)
    expect(typeof result.exportedAt).toBe('string')
  })

  it('includes all entries with source, target, and bucket only', () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], bucket: 3 })

    repo.insert(entry)

    const result = service.exportAll()

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toEqual({ source: 'Tisch', target: ['table'], bucket: 3 })
  })

  it('does not include id, lastAskedAt, or timestamps', () => {
    repo.insert(makeEntry())

    const exported = service.exportAll().entries[0]

    expect(Object.keys(exported)).toEqual(['source', 'target', 'bucket'])
  })
})

// ── addOrMerge ────────────────────────────────────────────────────────────────

describe('addOrMerge', () => {
  it('creates a new entry when no source word matches', () => {
    const results = service.addOrMerge({ source: ['Auto'], target: ['car'] })

    expect(results).toHaveLength(1)
    expect(results[0].merged).toBe(false)
    expect(results[0].entry.source).toBe('Auto')
    expect(results[0].entry.target).toEqual(['car'])
    expect(repo.findAll()).toHaveLength(1)
  })

  it('creates one entry per source word', () => {
    const results = service.addOrMerge({ source: ['Auto', 'Automobil'], target: ['car'] })

    expect(results).toHaveLength(2)
    expect(results[0].entry.source).toBe('Auto')
    expect(results[1].entry.source).toBe('Automobil')
    expect(repo.findAll()).toHaveLength(2)
  })

  it('each created entry carries all target translations', () => {
    const results = service.addOrMerge({ source: ['bessern', 'revidieren'], target: ['amend'] })

    expect(results[0].entry.target).toEqual(['amend'])
    expect(results[1].entry.target).toEqual(['amend'])
  })

  it('merges target translations into an existing entry when the source word matches', () => {
    repo.insert(makeEntry({ source: 'Auto', target: ['car'] }))

    const results = service.addOrMerge({ source: ['Auto'], target: ['car', 'automobile'] })

    expect(results).toHaveLength(1)
    expect(results[0].merged).toBe(true)
    expect(results[0].entry.source).toBe('Auto')
    expect(results[0].entry.target).toContain('car')
    expect(results[0].entry.target).toContain('automobile')
    expect(repo.findAll()).toHaveLength(1)
  })

  it('merges some words and creates others in one call', () => {
    repo.insert(makeEntry({ source: 'Auto', target: ['car'] }))

    const results = service.addOrMerge({ source: ['Auto', 'Automobil'], target: ['car'] })

    expect(results[0].merged).toBe(true)
    expect(results[1].merged).toBe(false)
    expect(repo.findAll()).toHaveLength(2)
  })

  it('matches existing entries case-sensitively (different case → new entry)', () => {
    repo.insert(makeEntry({ source: 'Turnen', target: ['gymnastics'] }))

    const results = service.addOrMerge({ source: ['turnen'], target: ['to do gymnastics'] })

    expect(results[0].merged).toBe(false)
    expect(repo.findAll()).toHaveLength(2)
  })

  it('does not add duplicate EN variants', () => {
    repo.insert(makeEntry({ source: 'Auto', target: ['car'] }))

    const results = service.addOrMerge({ source: ['Auto'], target: ['car', 'vehicle'] })

    expect(results[0].entry.target.filter((w) => w === 'car')).toHaveLength(1)
    expect(results[0].entry.target).toContain('vehicle')
  })

  it('preserves the existing bucket and SRS state when merging', () => {
    repo.insert(makeEntry({ source: 'Auto', target: ['car'], bucket: 5 }))

    const results = service.addOrMerge({ source: ['Auto'], target: ['vehicle'] })

    expect(results[0].entry.bucket).toBe(5)
  })
})

// ── setBucket ─────────────────────────────────────────────────────────────────

describe('setBucket', () => {
  it('updates the bucket of an existing entry', () => {
    const entry = makeEntry({ bucket: 0 })

    repo.insert(entry)
    const updated = service.setBucket(entry.id, { bucket: 3 })

    expect(updated.bucket).toBe(3)
    const stored = repo.findById(entry.id)
    if (stored === undefined) { throw new Error('entry not found') }
    expect(stored.bucket).toBe(3)
  })

  it('preserves all other fields when setting the bucket', () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], bucket: 1 })

    repo.insert(entry)
    const updated = service.setBucket(entry.id, { bucket: 5 })

    expect(updated.source).toBe('Tisch')
    expect(updated.target).toEqual(['table'])
    expect(updated.id).toBe(entry.id)
  })

  it('throws 404 when the entry does not exist', () => {
    expectApiError(() => service.setBucket('no-such-id', { bucket: 1 }), 404)
  })
})

// ── getCredits ─────────────────────────────────────────────────────────────────

describe('getCredits', () => {
  it('returns 0 when the balance is 0', () => {
    expect(service.getCredits()).toBe(0)
  })

  it('returns the current balance from the credits repository', () => {
    creditsRepo.addBalance(5)

    expect(service.getCredits()).toBe(5)
  })
})

// ── importEntries — credits ───────────────────────────────────────────────────

describe('importEntries — credits', () => {
  it('does not add credits for entries imported into frequency buckets (0–3)', () => {
    service.importEntries({
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      entries: [
        { source: 'Tisch', target: ['table'], bucket: 0 },
        { source: 'Hund', target: ['dog'], bucket: 3 },
      ],
    })

    expect(creditsRepo.getBalance()).toBe(0)
  })

  it('adds credits for entries imported into time-based buckets (≥ 4)', () => {
    service.importEntries({
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      entries: [
        { source: 'Tisch', target: ['table'], bucket: 4 }, // 1 credit
        { source: 'Hund', target: ['dog'], bucket: 6 },    // 3 credits
      ],
    })

    expect(creditsRepo.getBalance()).toBe(4)
  })

  it('adds the credit delta when a merge raises maxBucket into a time-based bucket', () => {
    repo.insert(makeEntry({ source: 'Auto', target: ['car'], bucket: 3, maxBucket: 3 }))

    service.importEntries({
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      entries: [{ source: 'Auto', target: ['car'], bucket: 5 }],
    })

    // maxBucket goes from 3 → 5: max(0,5−3) − max(0,3−3) = 2 − 0 = 2 credits
    expect(creditsRepo.getBalance()).toBe(2)
  })

  it('does not add credits when a merge does not raise maxBucket', () => {
    repo.insert(makeEntry({ source: 'Auto', target: ['car'], bucket: 5, maxBucket: 5 }))

    service.importEntries({
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      entries: [{ source: 'Auto', target: ['car'], bucket: 4 }],
    })

    expect(creditsRepo.getBalance()).toBe(0)
  })
})

// ── spendCredits ──────────────────────────────────────────────────────────────

describe('spendCredits', () => {
  it('deducts the amount and returns the new balance', () => {
    creditsRepo.addBalance(20)

    const newBalance = service.spendCredits({ amount: 10 })

    expect(newBalance).toBe(10)
    expect(creditsRepo.getBalance()).toBe(10)
  })

  it('allows spending the exact balance', () => {
    creditsRepo.addBalance(10)

    const newBalance = service.spendCredits({ amount: 10 })

    expect(newBalance).toBe(0)
  })

  it('throws ApiError 402 when balance is insufficient', () => {
    creditsRepo.addBalance(5)

    expectApiError(() => service.spendCredits({ amount: 10 }), 402)
  })

  it('throws ApiError 402 when balance is 0', () => {
    expectApiError(() => service.spendCredits({ amount: 1 }), 402)
  })
})

// ── refundCredits ─────────────────────────────────────────────────────────────

describe('refundCredits', () => {
  it('adds the amount to the balance and returns the new balance', () => {
    creditsRepo.addBalance(5)

    const newBalance = service.refundCredits({ amount: 3 })

    expect(newBalance).toBe(8)
    expect(creditsRepo.getBalance()).toBe(8)
  })

  it('can refund when balance is 0', () => {
    const newBalance = service.refundCredits({ amount: 1 })

    expect(newBalance).toBe(1)
  })
})

// ── setMarked ─────────────────────────────────────────────────────────────────

describe('setMarked', () => {
  it('marks an entry and returns it', () => {
    const entry = makeEntry({ marked: false })

    repo.insert(entry)

    const updated = service.setMarked(entry.id, { marked: true })

    expect(updated.marked).toBe(true)
    expect(repo.findById(entry.id)?.marked).toBe(true)
  })

  it('unmarks an already-marked entry', () => {
    const entry = makeEntry({ marked: true })

    repo.insert(entry)

    const updated = service.setMarked(entry.id, { marked: false })

    expect(updated.marked).toBe(false)
    expect(repo.findById(entry.id)?.marked).toBe(false)
  })

  it('throws ApiError 404 when entry is not found', () => {
    expectApiError(() => service.setMarked('no-such-id', { marked: true }), 404)
  })
})
