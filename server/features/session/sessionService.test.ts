// @vitest-environment node

/**
 * Unit tests for SessionService using fake repositories.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { SessionService, DISCOVERY_POOL_THRESHOLD, DISCOVERY_PUSHBACK_BUDGET } from './sessionService.ts'
import { FakeSessionRepository } from '../../test-utils/FakeSessionRepository.ts'
import { FakeVocabRepository } from '../../test-utils/FakeVocabRepository.ts'
import { FakeCreditsRepository } from '../../test-utils/FakeCreditsRepository.ts'
import { ApiError } from '../../errors/ApiError.ts'
import { isDue } from './srsSelection.ts'
import type { VocabEntry } from '../../../shared/types/VocabEntry.ts'
import type { Session } from '../../../shared/types/Session.ts'

function expectApiError(fn: () => unknown, status: number): void {
  let caught: unknown
  try { fn() } catch (e) { caught = e }
  expect(caught).toBeInstanceOf(ApiError)
  expect((caught as ApiError).status).toBe(status)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let idCounter = 0

function makeEntry(overrides: Partial<VocabEntry> = {}): VocabEntry {
  idCounter++
  return {
    id: `entry-${idCounter}`,
    de: 'Wort',
    en: ['word'],
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

function makeSession(overrides: Partial<Session> = {}): Session {
  idCounter++
  return {
    id: `session-${idCounter}`,
    direction: 'DE_TO_EN',
    type: 'normal',
    words: [],
    status: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let sessionRepo: FakeSessionRepository
let vocabRepo: FakeVocabRepository
let creditsRepo: FakeCreditsRepository
let service: SessionService

beforeEach(() => {
  idCounter = 0
  sessionRepo = new FakeSessionRepository()
  vocabRepo = new FakeVocabRepository()
  creditsRepo = new FakeCreditsRepository()
  service = new SessionService(sessionRepo, vocabRepo, creditsRepo)
})

// ── getOpenSession ────────────────────────────────────────────────────────────

describe('getOpenSession', () => {
  it('returns undefined when no session exists', () => {
    expect(service.getOpenSession()).toBeUndefined()
  })

  it('returns the open session', () => {
    const session = makeSession()

    sessionRepo.insert(session)

    expect(service.getOpenSession()?.id).toBe(session.id)
  })
})

// ── createSession ─────────────────────────────────────────────────────────────

describe('createSession', () => {
  it('creates a session with the chosen direction', () => {
    vocabRepo.insert(makeEntry())

    const session = service.createSession({ direction: 'EN_TO_DE', size: 1 })

    expect(session.direction).toBe('EN_TO_DE')
  })

  it('creates a session with status "open"', () => {
    vocabRepo.insert(makeEntry())

    const session = service.createSession({ direction: 'DE_TO_EN', size: 1 })

    expect(session.status).toBe('open')
  })

  it('populates words from available vocab entries', () => {
    vocabRepo.insert(makeEntry({ bucket: 0 }))
    vocabRepo.insert(makeEntry({ bucket: 0 }))

    const session = service.createSession({ direction: 'DE_TO_EN', size: 2 })

    expect(session.words.length).toBeGreaterThan(0)
    expect(session.words.every((w) => w.status === 'pending')).toBe(true)
  })

  it('persists the session so getOpenSession returns it', () => {
    vocabRepo.insert(makeEntry())

    const session = service.createSession({ direction: 'DE_TO_EN', size: 1 })

    expect(service.getOpenSession()?.id).toBe(session.id)
  })

  it('throws ApiError 409 when a session is already open', () => {
    sessionRepo.insert(makeSession({ status: 'open' }))

    expectApiError(() => service.createSession({ direction: 'DE_TO_EN', size: 10 }), 409)
  })

  it('throws ApiError 400 when no vocabulary entries are available', () => {
    expectApiError(() => service.createSession({ direction: 'DE_TO_EN', size: 10 }), 400)
  })

  it('clears manuallyAdded flag on selected words after session creation', () => {
    const entry = makeEntry({ bucket: 0, manuallyAdded: true })

    vocabRepo.insert(entry)
    service.createSession({ direction: 'DE_TO_EN', size: 1 })

    expect(vocabRepo.findById(entry.id)?.manuallyAdded).toBe(false)
  })

  it('does not clear manuallyAdded on words not selected for the session', () => {
    const selected = makeEntry({ bucket: 0, manuallyAdded: true })
    const notSelected = makeEntry({ bucket: 0, manuallyAdded: true })

    vocabRepo.insert(selected)
    vocabRepo.insert(notSelected)

    // Session size 1 — only 1 word gets picked; the other stays untouched
    const session = service.createSession({ direction: 'DE_TO_EN', size: 1 })
    const sessionVocabIds = new Set(session.words.map((w) => w.vocabId))
    const untouchedId = [selected.id, notSelected.id].find((id) => !sessionVocabIds.has(id))

    if (untouchedId !== undefined) {
      expect(vocabRepo.findById(untouchedId)?.manuallyAdded).toBe(true)
    }
  })
})

// ── submitAnswer — error cases ────────────────────────────────────────────────

describe('submitAnswer — error cases', () => {
  it('throws ApiError 404 when the session does not exist', () => {
    expectApiError(() => service.submitAnswer('no-session', 'word-1', ['table']), 404)
  })

  it('throws ApiError 400 when the session is already completed', () => {
    const entry = makeEntry()
    const session = makeSession({
      words: [{ vocabId: entry.id, status: 'correct' }],
      status: 'completed',
    })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    expectApiError(() => service.submitAnswer(session.id, entry.id, ['word']), 400)
  })

  it('throws ApiError 400 when the word is not pending in the session', () => {
    const entry = makeEntry()
    const session = makeSession({
      words: [{ vocabId: entry.id, status: 'correct' }],
    })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    expectApiError(() => service.submitAnswer(session.id, entry.id, ['word']), 400)
  })
})

// ── submitAnswer — correct answer on frequency bucket ────────────────────────

describe('submitAnswer — correct on frequency bucket', () => {
  it('returns outcome "correct" and newBucket = bucket + 1', () => {
    const entry = makeEntry({ bucket: 0, en: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(result.correct).toBe(true)
    expect(result.outcome).toBe('correct')
    expect(result.newBucket).toBe(1)
  })

  it('promotes the word to bucket + 1', () => {
    const entry = makeEntry({ bucket: 2, en: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(vocabRepo.findById(entry.id)?.bucket).toBe(3)
  })

  it('completes the session when all words are answered', () => {
    const entry = makeEntry({ en: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(result.sessionCompleted).toBe(true)
    expect(result.session.status).toBe('completed')
  })

  it('updates lastAskedAt on the vocab entry', () => {
    const entry = makeEntry({ bucket: 0, en: ['word'], lastAskedAt: null })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(vocabRepo.findById(entry.id)?.lastAskedAt).not.toBeNull()
  })

  it('updates maxBucket and earns 1 credit when promoted into bucket 4 for the first time', () => {
    const entry = makeEntry({ bucket: 3, maxBucket: 3, en: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(vocabRepo.findById(entry.id)?.maxBucket).toBe(4)
    expect(result.creditsEarned).toBe(1)
  })

  it('earns 1 credit when promoted into bucket 1 for the first time', () => {
    const entry = makeEntry({ bucket: 0, maxBucket: 0, en: ['word'] })
    const other = makeEntry()
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }, { vocabId: other.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    vocabRepo.insert(other)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(result.creditsEarned).toBe(1)
  })

  it('does not decrease maxBucket or add credits when the new bucket is lower than maxBucket', () => {
    const entry = makeEntry({ bucket: 2, maxBucket: 5, en: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(vocabRepo.findById(entry.id)?.maxBucket).toBe(5)
    expect(result.creditsEarned).toBe(0)
  })
})

// ── submitAnswer — wrong answer on frequency bucket ───────────────────────────

describe('submitAnswer — wrong on frequency bucket', () => {
  it('returns outcome "incorrect" and newBucket = 1', () => {
    const entry = makeEntry({ bucket: 2, en: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['wrong'])

    expect(result.correct).toBe(false)
    expect(result.outcome).toBe('incorrect')
    expect(result.newBucket).toBe(1)
  })

  it('resets the word to bucket 1', () => {
    const entry = makeEntry({ bucket: 3, en: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['wrong'])

    expect(vocabRepo.findById(entry.id)?.bucket).toBe(1)
  })
})

// ── submitAnswer — partially correct answer ───────────────────────────────────

describe('submitAnswer — partial (one of two required answers correct)', () => {
  it('returns outcome "partial", correct=false, and newBucket = current bucket (unchanged)', () => {
    const entry = makeEntry({ bucket: 2, en: ['bicycle', 'bike'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['bicycle', 'wrong'])

    expect(result.correct).toBe(false)
    expect(result.outcome).toBe('partial')
    expect(result.newBucket).toBe(2)
  })

  it('keeps the word in its current bucket (does not demote)', () => {
    const entry = makeEntry({ bucket: 3, en: ['bicycle', 'bike'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['bicycle', 'wrong'])

    expect(vocabRepo.findById(entry.id)?.bucket).toBe(3)
  })

  it('promotes bucket 0 words to bucket 1 even on a partial answer', () => {
    const entry = makeEntry({ bucket: 0, en: ['bicycle', 'bike'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['bicycle', 'wrong'])

    expect(result.outcome).toBe('partial')
    expect(vocabRepo.findById(entry.id)?.bucket).toBe(1)
  })

  it('does not apply partial logic when only one answer is required (single translation)', () => {
    const entry = makeEntry({ bucket: 2, en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['wrong'])

    expect(result.outcome).toBe('incorrect')
    expect(vocabRepo.findById(entry.id)?.bucket).toBe(1)
  })

  it('applies partial logic for time-based buckets (bucket ≥ 4) too', () => {
    const entry = makeEntry({ bucket: 4, en: ['bicycle', 'bike'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['bicycle', 'wrong'])

    expect(result.outcome).toBe('partial')
    expect(vocabRepo.findById(entry.id)?.bucket).toBe(4)
  })
})

// ── submitAnswer — correct answer on time bucket ─────────────────────────────

describe('submitAnswer — correct on time bucket (bucket ≥ 4)', () => {
  it('returns outcome "correct"', () => {
    const entry = makeEntry({ bucket: 4, en: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(result.correct).toBe(true)
    expect(result.outcome).toBe('correct')
  })

  it('promotes the word to bucket + 1', () => {
    const entry = makeEntry({ bucket: 4, en: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(vocabRepo.findById(entry.id)?.bucket).toBe(5)
  })

  it('updates lastAskedAt on the vocab entry', () => {
    const entry = makeEntry({ bucket: 4, en: ['word'], lastAskedAt: null })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(vocabRepo.findById(entry.id)?.lastAskedAt).not.toBeNull()
  })

  it('does not promote a non-due time-based word when answered correctly', () => {
    // lastAskedAt = just now → word is not due yet (needs 22 h for bucket 4)
    const entry = makeEntry({ bucket: 4, en: ['word'], lastAskedAt: new Date().toISOString() })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(vocabRepo.findById(entry.id)?.bucket).toBe(4)
  })

  it('still updates lastAskedAt for a non-due time-based word answered correctly', () => {
    // Use a timestamp 1 hour ago so the new lastAskedAt will be strictly later
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const entry = makeEntry({ bucket: 4, en: ['word'], lastAskedAt: oneHourAgo })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    const updated = vocabRepo.findById(entry.id)

    expect(updated?.lastAskedAt).not.toBeNull()
    expect(updated?.lastAskedAt).not.toBe(oneHourAgo)
  })

  it('still promotes a due time-based word when answered correctly', () => {
    // lastAskedAt = 2 days ago → definitely due for bucket 4 (22 h interval)
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    const entry = makeEntry({ bucket: 4, en: ['word'], lastAskedAt: twoDaysAgo })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(vocabRepo.findById(entry.id)?.bucket).toBe(5)
  })
})

// ── submitAnswer — time-based bucket second-chance flow ───────────────────────

describe('submitAnswer — wrong on time bucket (second-chance)', () => {
  it('returns outcome "second_chance" and newBucket = W1\'s current bucket (unchanged)', () => {
    const w1 = makeEntry({ bucket: 4, en: ['word'] })
    const w2 = makeEntry({ bucket: 4, en: ['other'] })
    const session = makeSession({ words: [{ vocabId: w1.id, status: 'pending' }] })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, w1.id, ['wrong'])

    expect(result.outcome).toBe('second_chance')
    expect(result.newBucket).toBe(4)
    expect(result.w1NewBucket).toBeUndefined()
  })

  it('adds a second-chance word to the session', () => {
    const w1 = makeEntry({ bucket: 4, en: ['word'] })
    const w2 = makeEntry({ bucket: 4, en: ['other'] })
    const session = makeSession({ words: [{ vocabId: w1.id, status: 'pending' }] })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, w1.id, ['wrong'])

    const secondChanceWord = result.session.words.find((w) => w.secondChanceFor === w1.id)

    expect(secondChanceWord).toBeDefined()
    expect(secondChanceWord?.status).toBe('pending')
  })

  it('does not change W1 bucket immediately — waits for second chance', () => {
    const w1 = makeEntry({ bucket: 4, en: ['word'] })
    const w2 = makeEntry({ bucket: 4, en: ['other'] })
    const session = makeSession({ words: [{ vocabId: w1.id, status: 'pending' }] })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, w1.id, ['wrong'])

    // W1's bucket should not change yet
    expect(vocabRepo.findById(w1.id)?.bucket).toBe(4)
  })

  it('returns "incorrect" (not second_chance) when no second word is available', () => {
    const w1 = makeEntry({ bucket: 4, en: ['word'] })
    const session = makeSession({ words: [{ vocabId: w1.id, status: 'pending' }] })

    vocabRepo.insert(w1)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, w1.id, ['wrong'])

    expect(result.outcome).toBe('incorrect')
    expect(vocabRepo.findById(w1.id)?.bucket).toBe(1)
  })
})

// ── submitAnswer — second-chance word correct ─────────────────────────────────

describe('submitAnswer — second-chance word correct', () => {
  it('returns outcome "second_chance_correct", newBucket = W2 bucket (unchanged), w1NewBucket = W1 bucket-1', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 4, en: ['word'] })
    const w2 = makeEntry({ id: 'w2', bucket: 4, en: ['other'] })
    const session = makeSession({
      words: [
        { vocabId: w1.id, status: 'incorrect' },
        { vocabId: w2.id, status: 'pending', secondChanceFor: w1.id },
      ],
    })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, w2.id, ['other'])

    expect(result.outcome).toBe('second_chance_correct')
    expect(result.newBucket).toBe(4)
    expect(result.w1NewBucket).toBe(3)
  })

  it('keeps W2 in its current bucket', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 4, en: ['word'] })
    const w2 = makeEntry({ id: 'w2', bucket: 4, en: ['other'] })
    const session = makeSession({
      words: [
        { vocabId: w1.id, status: 'incorrect' },
        { vocabId: w2.id, status: 'pending', secondChanceFor: w1.id },
      ],
    })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, w2.id, ['other'])

    expect(vocabRepo.findById(w2.id)?.bucket).toBe(4)
  })

  it('demotes W1 to bucket - 1', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 4, en: ['word'] })
    const w2 = makeEntry({ id: 'w2', bucket: 4, en: ['other'] })
    const session = makeSession({
      words: [
        { vocabId: w1.id, status: 'incorrect' },
        { vocabId: w2.id, status: 'pending', secondChanceFor: w1.id },
      ],
    })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, w2.id, ['other'])

    expect(vocabRepo.findById(w1.id)?.bucket).toBe(3)
  })

  it('sets W1 lastAskedAt so it is not due immediately but is due after 24 h (new bucket is time-based)', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 5, en: ['word'] })
    const w2 = makeEntry({ id: 'w2', bucket: 5, en: ['other'] })
    const session = makeSession({
      words: [
        { vocabId: w1.id, status: 'incorrect' },
        { vocabId: w2.id, status: 'pending', secondChanceFor: w1.id },
      ],
    })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, w2.id, ['other'])

    const w1Updated = vocabRepo.findById(w1.id)

    expect(w1Updated?.bucket).toBe(4)

    const DAY_MS = 24 * 60 * 60 * 1000

    if (w1Updated === undefined) { throw new Error('w1 not found') }

    // Not due right now
    expect(isDue(w1Updated, new Date())).toBe(false)
    // Due after 24 h
    expect(isDue(w1Updated, new Date(Date.now() + DAY_MS))).toBe(true)
  })

  it('uses lastAskedAt = now for W1 when new bucket is a frequency bucket (< 4)', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 4, en: ['word'] })
    const w2 = makeEntry({ id: 'w2', bucket: 4, en: ['other'] })
    const session = makeSession({
      words: [
        { vocabId: w1.id, status: 'incorrect' },
        { vocabId: w2.id, status: 'pending', secondChanceFor: w1.id },
      ],
    })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    const before = Date.now()

    service.submitAnswer(session.id, w2.id, ['other'])

    const after = Date.now()
    const w1Updated = vocabRepo.findById(w1.id)

    expect(w1Updated?.bucket).toBe(3)

    const lastAskedAt = new Date(w1Updated?.lastAskedAt ?? '').getTime()

    expect(lastAskedAt).toBeGreaterThanOrEqual(before)
    expect(lastAskedAt).toBeLessThanOrEqual(after)
  })
})

// ── submitAnswer — second-chance word wrong ───────────────────────────────────

describe('submitAnswer — second-chance word wrong', () => {
  it('returns outcome "second_chance_incorrect", newBucket = W2 bucket (unchanged), w1NewBucket = 1', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 4, en: ['word'] })
    const w2 = makeEntry({ id: 'w2', bucket: 4, en: ['other'] })
    const session = makeSession({
      words: [
        { vocabId: w1.id, status: 'incorrect' },
        { vocabId: w2.id, status: 'pending', secondChanceFor: w1.id },
      ],
    })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, w2.id, ['wrong'])

    expect(result.outcome).toBe('second_chance_incorrect')
    expect(result.newBucket).toBe(4)
    expect(result.w1NewBucket).toBe(1)
  })

  it('resets W1 to bucket 1 and keeps W2 in its current bucket', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 4, en: ['word'] })
    const w2 = makeEntry({ id: 'w2', bucket: 5, en: ['other'] })
    const session = makeSession({
      words: [
        { vocabId: w1.id, status: 'incorrect' },
        { vocabId: w2.id, status: 'pending', secondChanceFor: w1.id },
      ],
    })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, w2.id, ['wrong'])

    expect(vocabRepo.findById(w1.id)?.bucket).toBe(1)
    expect(vocabRepo.findById(w2.id)?.bucket).toBe(5)
  })
})

// ── submitAnswer — second-chance word partially correct ───────────────────────

describe('submitAnswer — second-chance word partial', () => {
  it('returns outcome "second_chance_partial", newBucket = W2 bucket (unchanged), w1NewBucket = 1', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 5, en: ['word'] })
    const w2 = makeEntry({ id: 'w2', bucket: 4, en: ['other', 'another'] })
    const session = makeSession({
      words: [
        { vocabId: w1.id, status: 'incorrect' },
        { vocabId: w2.id, status: 'pending', secondChanceFor: w1.id },
      ],
    })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, w2.id, ['other', 'wrong'])

    expect(result.outcome).toBe('second_chance_partial')
    expect(result.newBucket).toBe(4)
    expect(result.w1NewBucket).toBe(1)
  })

  it('resets W1 to bucket 1 and keeps W2 in its current bucket', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 5, en: ['word'] })
    const w2 = makeEntry({ id: 'w2', bucket: 4, en: ['other', 'another'] })
    const session = makeSession({
      words: [
        { vocabId: w1.id, status: 'incorrect' },
        { vocabId: w2.id, status: 'pending', secondChanceFor: w1.id },
      ],
    })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, w2.id, ['other', 'wrong'])

    expect(vocabRepo.findById(w1.id)?.bucket).toBe(1)
    expect(vocabRepo.findById(w2.id)?.bucket).toBe(4)
  })
})

// ── submitAnswer — typo answers ───────────────────────────────────────────────

describe('submitAnswer — typo (close but not exact answer)', () => {
  it('returns outcome "correct_typo" when the answer is within the typo threshold', () => {
    // 'machone' vs 'machine': distance 1, ratio 1/7 ≈ 0.14 ≤ 0.15
    const entry = makeEntry({ bucket: 0, en: ['machine'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['machone'])

    expect(result.correct).toBe(true)
    expect(result.outcome).toBe('correct_typo')
  })

  it('promotes the word to bucket + 1 on a typo answer (same as correct)', () => {
    const entry = makeEntry({ bucket: 2, en: ['machine'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['machone'])

    expect(vocabRepo.findById(entry.id)?.bucket).toBe(3)
  })

  it('includes typo details in the result', () => {
    const entry = makeEntry({ bucket: 0, en: ['machine'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['machone'])

    expect(result.typos).toHaveLength(1)
    expect(result.typos?.[0]).toEqual({ typed: 'machone', correct: 'machine' })
  })

  it('returns outcome "second_chance_correct_typo" when the second-chance word is answered with a typo', () => {
    const w1 = makeEntry({ bucket: 4, en: ['word'] })
    const w2 = makeEntry({ bucket: 4, en: ['machine'] })
    const session = makeSession({
      words: [
        { vocabId: w1.id, status: 'incorrect' },
        { vocabId: w2.id, status: 'pending', secondChanceFor: w1.id },
      ],
    })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, w2.id, ['machone'])

    expect(result.correct).toBe(true)
    expect(result.outcome).toBe('second_chance_correct_typo')
    expect(result.typos).toHaveLength(1)
  })

  it('returns outcome "partial_typo" when one answer is a typo and the other is wrong', () => {
    // 'machine' (7 chars): 'machone' is distance 1 → typo match
    // 'apparatus': 'wrong' is too far → no match
    const entry = makeEntry({ bucket: 2, en: ['machine', 'apparatus'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['machone', 'wrong'])

    expect(result.correct).toBe(false)
    expect(result.outcome).toBe('partial_typo')
    expect(result.typos).toHaveLength(1)
    expect(result.typos?.[0]).toEqual({ typed: 'machone', correct: 'machine' })
  })

  it('keeps word in its current bucket on a partial_typo outcome', () => {
    const entry = makeEntry({ bucket: 2, en: ['machine', 'apparatus'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['machone', 'wrong'])

    expect(vocabRepo.findById(entry.id)?.bucket).toBe(2)
  })

  it('does not return typos for an exact correct answer', () => {
    const entry = makeEntry({ bucket: 0, en: ['machine'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['machine'])

    expect(result.outcome).toBe('correct')
    expect(result.typos).toBeUndefined()
  })
})

// ── createSession — session type alternation ──────────────────────────────────

describe('createSession — session type alternation', () => {
  const DAY_MS = 24 * 60 * 60 * 1000

  function makeDueTimeEntry(overrides: Partial<VocabEntry> = {}): VocabEntry {
    return makeEntry({
      bucket: 4,
      lastAskedAt: new Date(Date.now() - 2 * DAY_MS).toISOString(),
      ...overrides,
    })
  }

  it('creates a "normal" session when there is no previous session', () => {
    vocabRepo.insert(makeEntry({ bucket: 0 }))

    const session = service.createSession({ direction: 'DE_TO_EN', size: 1 })

    expect(session.type).toBe('normal')
  })

  it('creates a "repetition" session after a completed normal session (enough due words)', () => {
    // Insert 12 due time-based words
    for (let i = 0; i < 12; i++) {
      vocabRepo.insert(makeDueTimeEntry())
    }

    const prevSession = makeSession({ status: 'completed', type: 'normal' })

    sessionRepo.insert(prevSession)

    const session = service.createSession({ direction: 'DE_TO_EN', size: 12, repetitionSize: 12 })

    expect(session.type).toBe('repetition')
  })

  it('repetition session contains only due time-based words', () => {
    for (let i = 0; i < 12; i++) {
      vocabRepo.insert(makeDueTimeEntry())
    }

    // Also add some frequency words that should NOT appear
    vocabRepo.insert(makeEntry({ bucket: 0 }))

    const prevSession = makeSession({ status: 'completed', type: 'normal' })

    sessionRepo.insert(prevSession)

    const session = service.createSession({ direction: 'DE_TO_EN', size: 12, repetitionSize: 12 })

    expect(session.type).toBe('repetition')
    expect(session.words.every((w) => {
      const entry = vocabRepo.findById(w.vocabId)
      return entry !== undefined && entry.bucket >= 4
    })).toBe(true)
  })

  it('falls back to "normal" and skips repetition when fewer than sessionSize due time-based words exist', () => {
    // Only 3 due time-based words — not enough for sessionSize=12
    for (let i = 0; i < 3; i++) {
      vocabRepo.insert(makeDueTimeEntry())
    }

    for (let i = 0; i < 12; i++) {
      vocabRepo.insert(makeEntry({ bucket: 0 }))
    }

    const prevSession = makeSession({ status: 'completed', type: 'normal' })

    sessionRepo.insert(prevSession)

    const session = service.createSession({ direction: 'DE_TO_EN', size: 12 })

    expect(session.type).toBe('normal')
  })

  it('tries repetition again after a skipped repetition (fallback normal session)', () => {
    // First: simulate a skipped repetition — last session was 'normal' (fallback)
    // So the NEXT session should also try repetition

    // Now provide enough due words
    for (let i = 0; i < 12; i++) {
      vocabRepo.insert(makeDueTimeEntry())
    }

    const fallbackNormal = makeSession({ status: 'completed', type: 'normal' })

    sessionRepo.insert(fallbackNormal)

    const session = service.createSession({ direction: 'DE_TO_EN', size: 12, repetitionSize: 12 })

    expect(session.type).toBe('repetition')
  })

  it('creates a "normal" session after a completed repetition session', () => {
    vocabRepo.insert(makeEntry({ bucket: 0 }))

    const prevSession = makeSession({ status: 'completed', type: 'repetition' })

    sessionRepo.insert(prevSession)

    const session = service.createSession({ direction: 'DE_TO_EN', size: 1 })

    expect(session.type).toBe('normal')
  })
})

// ── submitAnswer — session cost ───────────────────────────────────────────────

describe('submitAnswer — answer cost', () => {
  it('returns answerCost = 0 for a correct answer', () => {
    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.addBalance(10)

    const result = service.submitAnswer(session.id, entry.id, ['table'])

    expect(result.answerCost).toBe(0)
    // Balance: 10 initial + 1 bucket credit (bucket 0→1) + 10 perfect bonus; no streak credit (first-ever session)
    expect(creditsRepo.getBalance()).toBe(21)
  })

  it('deducts 1 credit immediately for a wrong answer and returns answerCost = 1', () => {
    const e1 = makeEntry({ en: ['table'] })
    const e2 = makeEntry({ en: ['chair'] })
    const session = makeSession({ words: [{ vocabId: e1.id, status: 'pending' }, { vocabId: e2.id, status: 'pending' }] })

    vocabRepo.insert(e1)
    vocabRepo.insert(e2)
    sessionRepo.insert(session)
    creditsRepo.addBalance(10)

    const result = service.submitAnswer(session.id, e1.id, ['wrong'])

    expect(result.sessionCompleted).toBe(false)
    expect(result.answerCost).toBe(1)
    expect(creditsRepo.getBalance()).toBe(9)
  })

  it('returns answerCost = 0 and does not go negative when balance is 0', () => {
    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.addBalance(0)

    const result = service.submitAnswer(session.id, entry.id, ['wrong'])

    expect(result.answerCost).toBe(0)
    // Session completes → no streak credit (first-ever session, streak = 1)
    expect(creditsRepo.getBalance()).toBe(0)
  })

  it('deducts across multiple wrong answers, stopping at 0 balance', () => {
    const e1 = makeEntry({ en: ['table'] })
    const e2 = makeEntry({ en: ['chair'] })
    const session = makeSession({ words: [{ vocabId: e1.id, status: 'pending' }, { vocabId: e2.id, status: 'pending' }] })

    vocabRepo.insert(e1)
    vocabRepo.insert(e2)
    sessionRepo.insert(session)
    creditsRepo.addBalance(1)

    const r1 = service.submitAnswer(session.id, e1.id, ['wrong'])
    const r2 = service.submitAnswer(session.id, e2.id, ['wrong'])

    expect(r1.answerCost).toBe(1)
    expect(r2.answerCost).toBe(0)
    // Session completes → no streak credit (first-ever session, streak = 1)
    expect(creditsRepo.getBalance()).toBe(0)
  })
})

// ── perfect session bonus ─────────────────────────────────────────────────────

describe('submitAnswer — perfect session bonus', () => {
  it('awards 10 credits for a perfect normal session', () => {
    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['table'])

    expect(result.perfectBonus).toBe(10)
    expect(result.sessionCompleted).toBe(true)
  })

  it('does not award a bonus when any word is answered incorrectly', () => {
    const e1 = makeEntry({ en: ['table'] })
    const e2 = makeEntry({ en: ['chair'] })
    const session = makeSession({ words: [{ vocabId: e1.id, status: 'pending' }, { vocabId: e2.id, status: 'pending' }] })

    vocabRepo.insert(e1)
    vocabRepo.insert(e2)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, e1.id, ['wrong'])
    const result = service.submitAnswer(session.id, e2.id, ['chair'])

    expect(result.perfectBonus).toBe(0)
  })

  it('does not award a bonus when a second-chance word was used', () => {
    const w1 = makeEntry({ bucket: 4, en: ['table'], lastAskedAt: null })
    const w2 = makeEntry({ bucket: 4, en: ['chair'], lastAskedAt: null })
    const session = makeSession({ words: [{ vocabId: w1.id, status: 'pending' }] })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    // First answer wrong on a time-based bucket → triggers second-chance
    service.submitAnswer(session.id, w1.id, ['wrong'])

    // Answer the second-chance word correctly to complete the session
    const updatedSession = sessionRepo.findById(session.id)
    if (updatedSession === undefined) { throw new Error('session not found') }
    const scWord = updatedSession.words.find((w) => w.secondChanceFor !== undefined)
    if (scWord === undefined) { throw new Error('second-chance word not found') }

    const result = service.submitAnswer(session.id, scWord.vocabId, ['chair'])

    expect(result.perfectBonus).toBe(0)
  })

  it('returns perfectBonus = 0 for non-final answers', () => {
    const e1 = makeEntry({ en: ['table'] })
    const e2 = makeEntry({ en: ['chair'] })
    const session = makeSession({ words: [{ vocabId: e1.id, status: 'pending' }, { vocabId: e2.id, status: 'pending' }] })

    vocabRepo.insert(e1)
    vocabRepo.insert(e2)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, e1.id, ['table'])

    expect(result.perfectBonus).toBe(0)
    expect(result.sessionCompleted).toBe(false)
  })

  it('adds the bonus to the credit balance', () => {
    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.addBalance(5)

    service.submitAnswer(session.id, entry.id, ['table'])

    // Perfect bonus (+10) + bucket credit (+1, bucket 0→1) on top of initial 5; no streak credit (first-ever session, streak = 1)
    expect(creditsRepo.getBalance()).toBe(16)
  })

  it('does not award a bonus when hints were used', () => {
    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['table'], true)

    expect(result.perfectBonus).toBe(0)
  })

  it('awards 100 credits for a perfect discovery session (all correct, no push-backs)', () => {
    const entry = makeEntry({ bucket: 0, en: ['dog'] })
    const session = makeSession({
      type: 'discovery',
      words: [{ vocabId: entry.id, status: 'pending' }],
    })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['dog'])

    expect(result.perfectBonus).toBe(100)
    expect(result.sessionCompleted).toBe(true)
  })

  it('does not award 100 credits when a discovery session has a pushed-back word', () => {
    const e1 = makeEntry({ bucket: 0, en: ['dog'] })
    const e2 = makeEntry({ bucket: 0, en: ['cat'] })
    const session: Session = {
      ...makeSession({ type: 'discovery' }),
      words: [
        { vocabId: e1.id, status: 'pushed_back' },
        { vocabId: e2.id, status: 'pending' },
      ],
    }

    vocabRepo.insert(e1)
    vocabRepo.insert(e2)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, e2.id, ['cat'])

    expect(result.perfectBonus).toBe(0)
  })
})

// ── markWordCorrect ───────────────────────────────────────────────────────────

describe('markWordCorrect', () => {
  it('changes the word status from incorrect to correct', () => {
    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'incorrect' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const updated = service.markWordCorrect(session.id, entry.id)

    expect(updated.words[0]?.status).toBe('correct')
  })

  it('persists the updated status in the repository', () => {
    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'incorrect' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.markWordCorrect(session.id, entry.id)

    expect(sessionRepo.findById(session.id)?.words[0]?.status).toBe('correct')
  })

  it('only changes the target word, leaving others unchanged', () => {
    const e1 = makeEntry({ id: 'e1', en: ['table'] })
    const e2 = makeEntry({ id: 'e2', en: ['chair'] })
    const session = makeSession({
      words: [
        { vocabId: e1.id, status: 'incorrect' },
        { vocabId: e2.id, status: 'incorrect' },
      ],
    })

    vocabRepo.insert(e1)
    vocabRepo.insert(e2)
    sessionRepo.insert(session)

    const updated = service.markWordCorrect(session.id, e1.id)

    expect(updated.words[0]?.status).toBe('correct')
    expect(updated.words[1]?.status).toBe('incorrect')
  })

  it('throws ApiError 404 when session is not found', () => {
    expectApiError(() => service.markWordCorrect('no-such-session', 'any-vocab'), 404)
  })

  it('throws ApiError 400 when the word is not in incorrect status', () => {
    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'correct' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    expectApiError(() => service.markWordCorrect(session.id, entry.id), 400)
  })
})

// ── bucket milestone bonus ─────────────────────────────────────────────────────

describe('submitAnswer — bucket milestone bonus', () => {
  it('awards 100 credits when a word is first promoted into bucket 6', () => {
    const entry = makeEntry({ en: ['word'], bucket: 5, maxBucket: 5 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(result.bucketMilestoneBonus).toBe(100)
    expect(creditsRepo.getBalance()).toBeGreaterThanOrEqual(100)
    expect(creditsRepo.getMaxBucketEver()).toBe(6)
  })

  it('awards 200 credits when bucket 7 is created for the first time', () => {
    creditsRepo.setMaxBucketEver(6)
    const entry = makeEntry({ en: ['word'], bucket: 6, maxBucket: 6 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(result.bucketMilestoneBonus).toBe(200)
    expect(creditsRepo.getMaxBucketEver()).toBe(7)
  })

  it('does not award a bonus when bucket 5 is created for the first time (threshold is 6)', () => {
    const entry = makeEntry({ en: ['word'], bucket: 4, maxBucket: 4 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(result.bucketMilestoneBonus).toBe(0)
  })

  it('does not award a second bonus when bucket 6 already existed', () => {
    creditsRepo.setMaxBucketEver(6)
    const entry = makeEntry({ en: ['word'], bucket: 5, maxBucket: 5 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(result.bucketMilestoneBonus).toBe(0)
  })

  it('returns bucketMilestoneBonus = 0 for a wrong answer', () => {
    const entry = makeEntry({ en: ['word'], bucket: 5, maxBucket: 5 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['wrong'])

    expect(result.bucketMilestoneBonus).toBe(0)
  })
})

// ── submitAnswer — streak credit ───────────────────────────────────────────────

describe('submitAnswer — streak credit', () => {
  it('returns streakCredit = 0 for the first-ever session (streak starts at 1, not yet ≥ 2)', () => {
    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    // lastSessionDate is null → newStreak = 1

    const result = service.submitAnswer(session.id, entry.id, ['table'])

    expect(result.streakCredit).toBe(0)
  })

  it('returns streakCredit = 1 when the streak reaches 2 or more (practiced yesterday)', () => {
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(today + 'T00:00:00Z')

    yesterday.setUTCDate(yesterday.getUTCDate() - 1)

    const yesterdayStr = yesterday.toISOString().slice(0, 10)
    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.updateStreak(1, yesterdayStr)  // streak was 1, last session yesterday → becomes 2

    const result = service.submitAnswer(session.id, entry.id, ['table'])

    expect(result.streakCredit).toBe(1)
  })

  it('returns streakCredit = 0 when streak resets to 1 (gap in practice)', () => {
    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.updateStreak(5, '2020-01-01')  // last session was days ago → newStreak = 1

    const result = service.submitAnswer(session.id, entry.id, ['table'])

    expect(result.streakCredit).toBe(0)
  })

  it('returns streakCredit = 0 when the session does not complete', () => {
    const e1 = makeEntry({ en: ['table'] })
    const e2 = makeEntry({ en: ['chair'] })
    const session = makeSession({ words: [{ vocabId: e1.id, status: 'pending' }, { vocabId: e2.id, status: 'pending' }] })

    vocabRepo.insert(e1)
    vocabRepo.insert(e2)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, e1.id, ['table'])

    expect(result.streakCredit).toBe(0)
    expect(result.sessionCompleted).toBe(false)
  })

  it('returns streakCredit = 0 for a second session completed on the same day', () => {
    const today = new Date().toISOString().slice(0, 10)
    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    // Simulate: first session was already completed today
    creditsRepo.updateStreak(1, today)

    const result = service.submitAnswer(session.id, entry.id, ['table'])

    expect(result.streakCredit).toBe(0)
  })

  it('increments the streak count when last session was yesterday', () => {
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(today + 'T00:00:00Z')
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const yesterdayStr = yesterday.toISOString().slice(0, 10)

    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.updateStreak(5, yesterdayStr)

    service.submitAnswer(session.id, entry.id, ['table'])

    expect(creditsRepo.getStreakCount()).toBe(6)
  })

  it('resets the streak count to 1 when last session was more than a day ago', () => {
    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    // Last session was 5 days ago → streak broken
    creditsRepo.updateStreak(10, '2020-01-01')

    service.submitAnswer(session.id, entry.id, ['table'])

    expect(creditsRepo.getStreakCount()).toBe(1)
  })

  it('adds +1 to the balance when streak is 2 or more, even on a wrong answer', () => {
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(today + 'T00:00:00Z')

    yesterday.setUTCDate(yesterday.getUTCDate() - 1)

    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.updateStreak(1, yesterday.toISOString().slice(0, 10))

    const balanceBefore = creditsRepo.getBalance()

    service.submitAnswer(session.id, entry.id, ['wrong'])

    expect(creditsRepo.getBalance()).toBe(balanceBefore + 1)
  })
})

// ── submitAnswer — streak milestones ─────────────────────────────────────────

describe('submitAnswer — streak milestones', () => {
  function makeYesterdayStr(): string {
    const today = new Date().toISOString().slice(0, 10)
    const d = new Date(today + 'T00:00:00Z')

    d.setUTCDate(d.getUTCDate() - 1)

    return d.toISOString().slice(0, 10)
  }

  it('awards week 1 milestone credits and sets milestoneLabel when streak reaches 7', () => {
    const yesterdayStr = makeYesterdayStr()
    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.updateStreak(6, yesterdayStr)  // streak will become 7

    const result = service.submitAnswer(session.id, entry.id, ['table'])

    expect(result.streakCredit).toBe(10)
    expect(result.milestoneLabel).toBe('Week 1')
    expect(creditsRepo.getStreakWeeksAwarded()).toBe(1)
  })

  it('awards week 2 milestone credits when streak reaches 14', () => {
    const yesterdayStr = makeYesterdayStr()
    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.updateStreak(13, yesterdayStr)
    creditsRepo.setStreakWeeksAwarded(1)

    const result = service.submitAnswer(session.id, entry.id, ['table'])

    expect(result.streakCredit).toBe(20)
    expect(result.milestoneLabel).toBe('2 Weeks')
    expect(creditsRepo.getStreakWeeksAwarded()).toBe(2)
  })

  it('returns milestoneLabel = undefined and streakCredit = 1 when no milestone is reached', () => {
    const yesterdayStr = makeYesterdayStr()
    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.updateStreak(5, yesterdayStr)  // streak becomes 6, no milestone

    const result = service.submitAnswer(session.id, entry.id, ['table'])

    expect(result.streakCredit).toBe(1)
    expect(result.milestoneLabel).toBeUndefined()
  })

  it('resets weeksAwarded and monthsAwarded to 0 when the streak restarts', () => {
    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.updateStreak(10, '2020-01-01')  // old streak (gap > 1 day)
    creditsRepo.setStreakWeeksAwarded(2)
    creditsRepo.setStreakMonthsAwarded(3)

    service.submitAnswer(session.id, entry.id, ['table'])

    // newStreak = 1 → counters reset
    expect(creditsRepo.getStreakWeeksAwarded()).toBe(0)
    expect(creditsRepo.getStreakMonthsAwarded()).toBe(0)
  })
})

// ── submitAnswer — streak save ────────────────────────────────────────────────

describe('submitAnswer — streak save bridging', () => {
  it('bridges the streak gap when streak_save_pending is set and this is the first answer', () => {
    const today = new Date().toISOString().slice(0, 10)
    const twoDaysAgo = new Date(today + 'T00:00:00Z')
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2)
    const twoDaysAgoStr = twoDaysAgo.toISOString().slice(0, 10)

    const entry = makeEntry({ en: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.updateStreak(5, twoDaysAgoStr)
    creditsRepo.setStreakSavePending(true)

    service.submitAnswer(session.id, entry.id, ['table'])

    // After bridging: last_session_date = yesterday, streak incremented to 6
    expect(creditsRepo.getStreakCount()).toBe(6)
    expect(creditsRepo.isStreakSavePending()).toBe(false)
  })

  it('clears streak_save_pending after the first answer', () => {
    const e1 = makeEntry({ en: ['table'] })
    const e2 = makeEntry({ en: ['chair'] })
    const session = makeSession({ words: [{ vocabId: e1.id, status: 'pending' }, { vocabId: e2.id, status: 'pending' }] })

    vocabRepo.insert(e1)
    vocabRepo.insert(e2)
    sessionRepo.insert(session)
    creditsRepo.setStreakSavePending(true)

    service.submitAnswer(session.id, e1.id, ['table'])

    expect(creditsRepo.isStreakSavePending()).toBe(false)
  })
})

// ── createSession — focus session ─────────────────────────────────────────────

describe('createSession — focus session', () => {
  function makeHighScoreEntry(overrides: Partial<VocabEntry> = {}): VocabEntry {
    return makeEntry({ bucket: 1, score: 2, ...overrides })
  }

  it('creates a "focus" session when 5+ words with score >= 2 and bucket > 0 exist', () => {
    for (let i = 0; i < 5; i++) {
      vocabRepo.insert(makeHighScoreEntry())
    }

    const session = service.createSession({ direction: 'DE_TO_EN', size: 10 })

    expect(session.type).toBe('focus')
  })

  it('does not create a "focus" session when fewer than 5 qualifying words exist', () => {
    for (let i = 0; i < 4; i++) {
      vocabRepo.insert(makeHighScoreEntry())
    }

    for (let i = 0; i < 10; i++) {
      vocabRepo.insert(makeEntry({ bucket: 0 }))
    }

    const session = service.createSession({ direction: 'DE_TO_EN', size: 10 })

    expect(session.type).toBe('normal')
  })

  it('does not create a focus session when one was already completed today', () => {
    for (let i = 0; i < 10; i++) {
      vocabRepo.insert(makeHighScoreEntry())
    }

    const today = new Date().toISOString().slice(0, 10)

    creditsRepo.setLastFocusSessionDate(today)

    const session = service.createSession({ direction: 'DE_TO_EN', size: 10 })

    expect(session.type).not.toBe('focus')
  })

  it('records last_focus_session_date when focus session completes', () => {
    const entry = makeEntry({ bucket: 1, score: 2, de: 'Tisch', en: ['table'] })

    vocabRepo.insert(entry)

    // Seed enough for focus selection (need 5; use 1-word session for simplicity)
    for (let i = 0; i < 4; i++) {
      vocabRepo.insert(makeHighScoreEntry())
    }

    const session = service.createSession({ direction: 'DE_TO_EN', size: 5 })

    expect(session.type).toBe('focus')

    // Complete the session by answering all words correctly
    for (const word of session.words) {
      const e = vocabRepo.findById(word.vocabId)
      if (e !== undefined) {
        service.submitAnswer(session.id, word.vocabId, e.en)
      }
    }

    const today = new Date().toISOString().slice(0, 10)

    expect(creditsRepo.getLastFocusSessionDate()).toBe(today)
  })

  it('does not record focus date while session is still open', () => {
    for (let i = 0; i < 5; i++) {
      vocabRepo.insert(makeHighScoreEntry({ de: 'Wort', en: ['word'] }))
    }

    const session = service.createSession({ direction: 'DE_TO_EN', size: 5 })

    expect(session.type).toBe('focus')

    // Answer only the first word
    const firstWord = session.words[0]

    service.submitAnswer(session.id, firstWord.vocabId, ['word'])

    expect(creditsRepo.getLastFocusSessionDate()).toBeNull()
  })

  it('focus session takes priority over normal/repetition alternation', () => {
    // Previous session was 'normal', so alternation would pick 'repetition'
    // But focus conditions are met, so 'focus' wins
    const prevSession = makeSession({ status: 'completed', type: 'normal' })

    sessionRepo.insert(prevSession)

    for (let i = 0; i < 5; i++) {
      vocabRepo.insert(makeHighScoreEntry())
    }

    const session = service.createSession({ direction: 'DE_TO_EN', size: 10 })

    expect(session.type).toBe('focus')
  })

  it('resumes normal/repetition alternation after focus session (no previous non-focus session → normal)', () => {
    for (let i = 0; i < 5; i++) {
      vocabRepo.insert(makeHighScoreEntry())
    }

    for (let i = 0; i < 10; i++) {
      vocabRepo.insert(makeEntry({ bucket: 0 }))
    }

    // Simulate focus already done today
    const today = new Date().toISOString().slice(0, 10)

    creditsRepo.setLastFocusSessionDate(today)

    // No previous non-focus session → alternation picks 'normal'
    const session = service.createSession({ direction: 'DE_TO_EN', size: 10 })

    expect(session.type).toBe('normal')
  })

  it('picks repetition after normal → focus sequence (focus does not break alternation)', () => {
    const DAY_MS = 24 * 60 * 60 * 1000

    // Enough due time-based words for a repetition session
    for (let i = 0; i < 24; i++) {
      vocabRepo.insert(makeEntry({
        bucket: 4,
        lastAskedAt: new Date(Date.now() - 2 * DAY_MS).toISOString(),
      }))
    }

    // Last non-focus completed session was 'normal' → alternation should pick 'repetition'
    sessionRepo.insert(makeSession({ status: 'completed', type: 'normal' }))

    // A focus session was also completed (most recent overall) but should be ignored for alternation
    sessionRepo.insert(makeSession({ status: 'completed', type: 'focus', createdAt: '2026-06-01T10:00:00Z' }))

    // Focus already done today → skip focus check
    const today = new Date().toISOString().slice(0, 10)

    creditsRepo.setLastFocusSessionDate(today)

    const session = service.createSession({ direction: 'DE_TO_EN', size: 12, repetitionSize: 24 })

    expect(session.type).toBe('repetition')
  })
})

// ── createSession — discovery session ─────────────────────────────────────────

describe('createSession — discovery session', () => {
  const DISC_SIZE = 24

  function insertActivePoolWords(count: number): void {
    for (let i = 0; i < count; i++) {
      vocabRepo.insert(makeEntry({ bucket: 1 }))
    }
  }

  function insertBucket0Words(count: number): void {
    for (let i = 0; i < count; i++) {
      vocabRepo.insert(makeEntry({ bucket: 0 }))
    }
  }

  it('creates a discovery session when active pool < threshold and enough bucket-0 words exist', () => {
    insertActivePoolWords(DISCOVERY_POOL_THRESHOLD - 1)
    insertBucket0Words(DISC_SIZE)

    const session = service.createSession({ direction: 'DE_TO_EN', size: 12, discoverySize: DISC_SIZE })

    expect(session.type).toBe('discovery')
    expect(session.words).toHaveLength(DISC_SIZE)
  })

  it('does not create a discovery session when active pool >= threshold', () => {
    insertActivePoolWords(DISCOVERY_POOL_THRESHOLD)
    insertBucket0Words(DISC_SIZE)

    const session = service.createSession({ direction: 'DE_TO_EN', size: 12, discoverySize: DISC_SIZE })

    expect(session.type).not.toBe('discovery')
  })

  it('does not create a discovery session when fewer than discoverySize bucket-0 words exist', () => {
    insertActivePoolWords(DISCOVERY_POOL_THRESHOLD - 1)
    insertBucket0Words(DISC_SIZE - 1)

    const session = service.createSession({ direction: 'DE_TO_EN', size: DISC_SIZE - 1 })

    expect(session.type).not.toBe('discovery')
  })

  it('discovery session takes priority over focus', () => {
    // Use 5 high-score bucket-1 entries as the entire active pool (well below threshold)
    for (let i = 0; i < 5; i++) {
      vocabRepo.insert(makeEntry({ bucket: 1, score: 2 }))
    }

    insertBucket0Words(DISC_SIZE)

    const session = service.createSession({ direction: 'DE_TO_EN', size: 12, discoverySize: DISC_SIZE })

    expect(session.type).toBe('discovery')
  })

  it('discovery session takes priority over normal/repetition alternation', () => {
    insertActivePoolWords(DISCOVERY_POOL_THRESHOLD - 1)
    insertBucket0Words(DISC_SIZE)

    sessionRepo.insert(makeSession({ status: 'completed', type: 'normal' }))

    const session = service.createSession({ direction: 'DE_TO_EN', size: 12, discoverySize: DISC_SIZE })

    expect(session.type).toBe('discovery')
  })

  it('discovery session only contains bucket-0 words', () => {
    insertActivePoolWords(DISCOVERY_POOL_THRESHOLD - 1)
    insertBucket0Words(DISC_SIZE)

    const session = service.createSession({ direction: 'DE_TO_EN', size: 12, discoverySize: DISC_SIZE })

    expect(session.type).toBe('discovery')

    for (const word of session.words) {
      const entry = vocabRepo.findById(word.vocabId)
      expect(entry?.bucket).toBe(0)
    }
  })

  it('falls through to focus when discovery conditions are not met', () => {
    // Active pool below threshold but not enough bucket-0 words
    insertActivePoolWords(DISCOVERY_POOL_THRESHOLD - 1)

    for (let i = 0; i < 5; i++) {
      vocabRepo.insert(makeEntry({ bucket: 1, score: 2 }))
    }

    const session = service.createSession({ direction: 'DE_TO_EN', size: 12, discoverySize: DISC_SIZE })

    expect(session.type).toBe('focus')
  })

  it('does not create a discovery session when one was already completed today', () => {
    insertActivePoolWords(DISCOVERY_POOL_THRESHOLD - 1)
    insertBucket0Words(DISC_SIZE)

    const today = new Date().toISOString().slice(0, 10)

    creditsRepo.setLastDiscoverySessionDate(today)

    const session = service.createSession({ direction: 'DE_TO_EN', size: 12, discoverySize: DISC_SIZE })

    expect(session.type).not.toBe('discovery')
  })

  it('records last_discovery_session_date when a discovery session completes via submitAnswer', () => {
    insertActivePoolWords(DISCOVERY_POOL_THRESHOLD - 1)
    insertBucket0Words(DISC_SIZE)

    const session = service.createSession({ direction: 'DE_TO_EN', size: 12, discoverySize: DISC_SIZE })

    expect(session.type).toBe('discovery')

    // Answer all words correctly to complete the session
    for (const word of session.words) {
      const entry = vocabRepo.findById(word.vocabId)
      if (!entry) { continue }
      const answer = entry.en[0] ?? ''
      service.submitAnswer(session.id, word.vocabId, answer)
    }

    const today = new Date().toISOString().slice(0, 10)

    expect(creditsRepo.getLastDiscoverySessionDate()).toBe(today)
  })

  it('records last_discovery_session_date when a discovery session completes via pushBackWord', () => {
    insertActivePoolWords(DISCOVERY_POOL_THRESHOLD - 1)

    const entry = makeEntry({ bucket: 0 })

    vocabRepo.insert(entry)

    const session = makeSession({
      type: 'discovery',
      status: 'open',
      words: [{ vocabId: entry.id, status: 'pending' }],
    })

    sessionRepo.insert(session)

    service.pushBackWord(session.id, entry.id)

    const today = new Date().toISOString().slice(0, 10)

    expect(creditsRepo.getLastDiscoverySessionDate()).toBe(today)
  })
})

// ── pushBackWord ───────────────────────────────────────────────────────────────

describe('pushBackWord', () => {
  function makeDiscoverySession(wordIds: string[]): Session {
    return makeSession({
      type: 'discovery',
      status: 'open',
      words: wordIds.map((id) => ({ vocabId: id, status: 'pending' })),
    })
  }

  it('marks the word as pushed_back', () => {
    const entry = makeEntry({ bucket: 0 })
    vocabRepo.insert(entry)
    const session = makeDiscoverySession([entry.id])
    sessionRepo.insert(session)

    const updated = service.pushBackWord(session.id, entry.id)

    expect(updated.words[0].status).toBe('pushed_back')
  })

  it('does not change the vocab entry bucket (stays at 0)', () => {
    const entry = makeEntry({ bucket: 0 })
    vocabRepo.insert(entry)
    const session = makeDiscoverySession([entry.id])
    sessionRepo.insert(session)

    service.pushBackWord(session.id, entry.id)

    expect(vocabRepo.findById(entry.id)?.bucket).toBe(0)
  })

  it('advances to the next pending word (session stays open)', () => {
    const e1 = makeEntry({ bucket: 0 })
    const e2 = makeEntry({ bucket: 0 })
    vocabRepo.insert(e1)
    vocabRepo.insert(e2)
    const session = makeDiscoverySession([e1.id, e2.id])
    sessionRepo.insert(session)

    const updated = service.pushBackWord(session.id, e1.id)

    expect(updated.status).toBe('open')
    expect(updated.words.find((w) => w.vocabId === e2.id)?.status).toBe('pending')
  })

  it('completes the session when the last pending word is pushed back', () => {
    const entry = makeEntry({ bucket: 0 })
    vocabRepo.insert(entry)
    const session = makeDiscoverySession([entry.id])
    sessionRepo.insert(session)

    const updated = service.pushBackWord(session.id, entry.id)

    expect(updated.status).toBe('completed')
  })

  it('throws 400 when the pushback budget is exhausted', () => {
    const entries = Array.from({ length: DISCOVERY_PUSHBACK_BUDGET + 1 }, () => makeEntry({ bucket: 0 }))
    entries.forEach((e) => { vocabRepo.insert(e) })
    const session: Session = {
      ...makeDiscoverySession(entries.map((e) => e.id)),
      words: entries.map((e, i) => ({
        vocabId: e.id,
        status: i < DISCOVERY_PUSHBACK_BUDGET ? 'pushed_back' : 'pending',
      })),
    }
    sessionRepo.insert(session)

    expectApiError(() => service.pushBackWord(session.id, entries[DISCOVERY_PUSHBACK_BUDGET].id), 400)
  })

  it('throws 400 when used on a non-discovery session', () => {
    const entry = makeEntry({ bucket: 0 })
    vocabRepo.insert(entry)
    const session = makeSession({ type: 'normal', words: [{ vocabId: entry.id, status: 'pending' }] })
    sessionRepo.insert(session)

    expectApiError(() => service.pushBackWord(session.id, entry.id), 400)
  })

  it('throws 400 when the word is not pending', () => {
    const entry = makeEntry({ bucket: 0 })
    vocabRepo.insert(entry)
    const session: Session = {
      ...makeDiscoverySession([entry.id]),
      words: [{ vocabId: entry.id, status: 'correct' }],
    }
    sessionRepo.insert(session)

    expectApiError(() => service.pushBackWord(session.id, entry.id), 400)
  })

  it('throws 404 when session does not exist', () => {
    expectApiError(() => service.pushBackWord('no-such-id', 'any'), 404)
  })
})

// ── submitAnswer — discovery session is free ───────────────────────────────────

describe('submitAnswer — discovery session is free', () => {
  it('does not charge credits for a wrong answer in a discovery session', () => {
    const entry = makeEntry({ bucket: 0, de: 'Hund', en: ['dog'] })

    vocabRepo.insert(entry)

    const session = makeSession({
      type: 'discovery',
      words: [{ vocabId: entry.id, status: 'pending' }],
    })

    sessionRepo.insert(session)
    creditsRepo.addBalance(50)

    service.submitAnswer(session.id, entry.id, ['wrong answer'])

    expect(creditsRepo.getBalance()).toBe(50)
  })
})

// ── getStarredSessionAvailable ────────────────────────────────────────────────

describe('getStarredSessionAvailable', () => {
  it('returns available=false and markedCount=0 when no words are marked', () => {
    vocabRepo.insert(makeEntry({ marked: false }))

    const result = service.getStarredSessionAvailable()

    expect(result.available).toBe(false)
    expect(result.markedCount).toBe(0)
    expect(result.alreadyDoneToday).toBe(false)
  })

  it('returns available=true when at least 5 marked words exist and none done today', () => {
    for (let i = 0; i < 5; i++) { vocabRepo.insert(makeEntry({ marked: true })) }

    const result = service.getStarredSessionAvailable()

    expect(result.available).toBe(true)
    expect(result.markedCount).toBe(5)
  })

  it('returns available=false when fewer than 5 words are marked', () => {
    for (let i = 0; i < 4; i++) { vocabRepo.insert(makeEntry({ marked: true })) }

    const result = service.getStarredSessionAvailable()

    expect(result.available).toBe(false)
    expect(result.markedCount).toBe(4)
  })

  it('returns available=false and alreadyDoneToday=true when session completed today', () => {
    vocabRepo.insert(makeEntry({ marked: true }))
    creditsRepo.setLastStarredSessionDate(new Date().toISOString().slice(0, 10))

    const result = service.getStarredSessionAvailable()

    expect(result.available).toBe(false)
    expect(result.alreadyDoneToday).toBe(true)
  })

  it('returns available=false when the game is paused', () => {
    vocabRepo.insert(makeEntry({ marked: true }))
    creditsRepo.setPauseActive('2026-01-01')

    const result = service.getStarredSessionAvailable()

    expect(result.available).toBe(false)
  })

  it('returns available=false when a session is in progress (has answered words)', () => {
    vocabRepo.insert(makeEntry({ marked: true }))
    sessionRepo.insert(makeSession({
      status: 'open',
      words: [{ vocabId: 'x', status: 'correct' }, { vocabId: 'y', status: 'pending' }],
    }))

    const result = service.getStarredSessionAvailable()

    expect(result.available).toBe(false)
  })

  it('returns available=true when the only open session is unstarted (0 answered words)', () => {
    for (let i = 0; i < 5; i++) { vocabRepo.insert(makeEntry({ marked: true })) }
    sessionRepo.insert(makeSession({
      status: 'open',
      words: [{ vocabId: 'x', status: 'pending' }],
    }))

    const result = service.getStarredSessionAvailable()

    expect(result.available).toBe(true)
  })
})

// ── createStarredSession ──────────────────────────────────────────────────────

describe('createStarredSession', () => {
  it('creates a session of type "starred" from marked words', () => {
    for (let i = 0; i < 5; i++) { vocabRepo.insert(makeEntry({ marked: true })) }
    vocabRepo.insert(makeEntry({ marked: false }))

    const session = service.createStarredSession('DE_TO_EN')

    expect(session.type).toBe('starred')
    expect(session.words).toHaveLength(5)
  })

  it('throws 400 when no words are marked', () => {
    vocabRepo.insert(makeEntry({ marked: false }))

    expectApiError(() => service.createStarredSession('DE_TO_EN'), 400)
  })

  it('throws 400 when fewer than 5 words are marked', () => {
    for (let i = 0; i < 4; i++) { vocabRepo.insert(makeEntry({ marked: true })) }

    expectApiError(() => service.createStarredSession('DE_TO_EN'), 400)
  })

  it('throws 409 when a session is in progress (has answered words)', () => {
    vocabRepo.insert(makeEntry({ marked: true }))
    sessionRepo.insert(makeSession({
      status: 'open',
      words: [{ vocabId: 'x', status: 'correct' }, { vocabId: 'y', status: 'pending' }],
    }))

    expectApiError(() => service.createStarredSession('DE_TO_EN'), 409)
  })

  it('discards an unstarted open session and creates the starred session', () => {
    const entry = makeEntry({ marked: true })

    vocabRepo.insert(entry)
    for (let i = 0; i < 4; i++) { vocabRepo.insert(makeEntry({ marked: true })) }

    const unstarted = makeSession({ status: 'open', words: [{ vocabId: entry.id, status: 'pending' }] })

    sessionRepo.insert(unstarted)

    const session = service.createStarredSession('DE_TO_EN')

    expect(session.type).toBe('starred')
    expect(sessionRepo.findById(unstarted.id)).toBeUndefined()
  })

  it('throws 409 when a starred session was already completed today', () => {
    vocabRepo.insert(makeEntry({ marked: true }))
    creditsRepo.setLastStarredSessionDate(new Date().toISOString().slice(0, 10))

    expectApiError(() => service.createStarredSession('DE_TO_EN'), 409)
  })

  it('throws 423 when the game is paused', () => {
    vocabRepo.insert(makeEntry({ marked: true }))
    creditsRepo.setPauseActive('2026-01-01')

    expectApiError(() => service.createStarredSession('DE_TO_EN'), 423)
  })

  it('caps the session at 100 words', () => {
    for (let i = 0; i < 120; i++) {
      vocabRepo.insert(makeEntry({ marked: true }))
    }

    const session = service.createStarredSession('DE_TO_EN')

    expect(session.words).toHaveLength(100)
  })

  it('records the last starred session date when session completes', () => {
    const entries = Array.from({ length: 5 }, () => makeEntry({ marked: true }))

    for (const e of entries) { vocabRepo.insert(e) }

    const session = service.createStarredSession('DE_TO_EN')

    for (const e of entries) { service.submitAnswer(session.id, e.id, ['word']) }

    const today = new Date().toISOString().slice(0, 10)

    expect(creditsRepo.getLastStarredSessionDate()).toBe(today)
  })

  it('does not disrupt the normal/repetition alternation cycle', () => {
    // After a normal session, the next non-special session should be repetition.
    // If we complete a starred session in between, it should not affect this.
    const entry = makeEntry({ marked: true, de: 'Hund', en: ['dog'] })

    vocabRepo.insert(entry)
    for (let i = 0; i < 4; i++) { vocabRepo.insert(makeEntry({ marked: true })) }
    sessionRepo.insert(makeSession({ type: 'normal', status: 'completed' }))

    const starredSess = service.createStarredSession('DE_TO_EN')

    service.submitAnswer(starredSess.id, entry.id, ['dog'])

    // findLastCompletedNonFocus should still return the normal session
    const last = sessionRepo.findLastCompletedNonFocus()

    expect(last?.type).toBe('normal')
  })
})
