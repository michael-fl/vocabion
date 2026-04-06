// @vitest-environment node

/**
 * Unit tests for SessionService using fake repositories.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { SessionService, DISCOVERY_POOL_THRESHOLD, DISCOVERY_PUSHBACK_BUDGET, RECOVERY_MIN_WORDS, FOCUS_QUIZ_SESSION_SIZE, FOCUS_QUIZ_MIN_WORDS } from './sessionService.ts'
import { StressSessionService } from './stressSessionService.ts'
import { VeteranSessionService, VETERAN_MIN_BUCKET6_WORDS } from './veteranSessionService.ts'
import { BreakthroughSessionService } from './breakthroughSessionService.ts'
import { SecondChanceSessionService } from './secondChanceSessionService.ts'
import { MIN_SESSION_SIZE, NORMAL_SESSION_MAX_SIZE } from './sessionConstants.ts'
import { FakeSessionRepository } from '../../test-utils/FakeSessionRepository.ts'
import { FakeVocabRepository } from '../../test-utils/FakeVocabRepository.ts'
import { FakeCreditsRepository } from '../../test-utils/FakeCreditsRepository.ts'
import { ApiError } from '../../errors/ApiError.ts'
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
    source: 'Wort',
    target: ['word'],
    bucket: 0,
    lastAskedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    secondChanceDueAt: null,
    maxBucket: 0,
    maxScore: 0,
    difficulty: 0,
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
    direction: 'SOURCE_TO_TARGET',
    type: 'normal',
    words: [],
    status: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    firstAnsweredAt: null,
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
  // Use identity shuffle so the sequence is always [stress, discovery, focus, focus_quiz, veteran, breakthrough, recovery, repetition, normal].
  // This makes type-selection tests deterministic without relying on alternation state.
  service = new SessionService(sessionRepo, vocabRepo, creditsRepo, new StressSessionService(creditsRepo), new VeteranSessionService(creditsRepo), new BreakthroughSessionService(creditsRepo), new SecondChanceSessionService(creditsRepo), (types) => [...types])
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

    const session = service.createSession({ direction: 'TARGET_TO_SOURCE', size: 1 })

    expect(session.direction).toBe('TARGET_TO_SOURCE')
  })

  it('creates a session with status "open"', () => {
    vocabRepo.insert(makeEntry())

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 1 })

    expect(session.status).toBe('open')
  })

  it('populates words from available vocab entries', () => {
    vocabRepo.insert(makeEntry({ bucket: 0 }))
    vocabRepo.insert(makeEntry({ bucket: 0 }))

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 2 })

    expect(session.words.length).toBeGreaterThan(0)
    expect(session.words.every((w) => w.status === 'pending')).toBe(true)
  })

  it('persists the session so getOpenSession returns it', () => {
    vocabRepo.insert(makeEntry())

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 1 })

    expect(service.getOpenSession()?.id).toBe(session.id)
  })

  it('throws ApiError 409 when a session is already open', () => {
    sessionRepo.insert(makeSession({ status: 'open' }))

    expectApiError(() => service.createSession({ direction: 'SOURCE_TO_TARGET', size: 10 }), 409)
  })

  it('throws ApiError 400 when no vocabulary entries are available', () => {
    expectApiError(() => service.createSession({ direction: 'SOURCE_TO_TARGET', size: 10 }), 400)
  })

  it('clears manuallyAdded flag on selected words after session creation', () => {
    const entry = makeEntry({ bucket: 0, manuallyAdded: true })

    vocabRepo.insert(entry)
    service.createSession({ direction: 'SOURCE_TO_TARGET', size: 1 })

    expect(vocabRepo.findById(entry.id)?.manuallyAdded).toBe(false)
  })

  it('does not clear manuallyAdded on words not selected for the session', () => {
    const selected = makeEntry({ bucket: 0, manuallyAdded: true })
    const notSelected = makeEntry({ bucket: 0, manuallyAdded: true })

    vocabRepo.insert(selected)
    vocabRepo.insert(notSelected)

    // Session size 1 — only 1 word gets picked; the other stays untouched
    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 1 })
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
    const entry = makeEntry({ bucket: 0, target: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(result.correct).toBe(true)
    expect(result.outcome).toBe('correct')
    expect(result.newBucket).toBe(1)
  })

  it('promotes the word to bucket + 1', () => {
    const entry = makeEntry({ bucket: 2, target: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(vocabRepo.findById(entry.id)?.bucket).toBe(3)
  })

  it('completes the session when all words are answered', () => {
    const entry = makeEntry({ target: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(result.sessionCompleted).toBe(true)
    expect(result.session.status).toBe('completed')
  })

  it('updates lastAskedAt on the vocab entry', () => {
    const entry = makeEntry({ bucket: 0, target: ['word'], lastAskedAt: null })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(vocabRepo.findById(entry.id)?.lastAskedAt).not.toBeNull()
  })

  it('updates maxBucket and earns 5 credits when promoted into bucket 4 for the first time', () => {
    const entry = makeEntry({ bucket: 3, maxBucket: 3, target: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(vocabRepo.findById(entry.id)?.maxBucket).toBe(4)
    expect(result.creditsEarned).toBe(5)
  })

  it('earns 5 credits when promoted into bucket 1 for the first time', () => {
    const entry = makeEntry({ bucket: 0, maxBucket: 0, target: ['word'] })
    const other = makeEntry()
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }, { vocabId: other.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    vocabRepo.insert(other)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(result.creditsEarned).toBe(5)
  })

  it('does not decrease maxBucket or add credits when the new bucket is lower than maxBucket', () => {
    const entry = makeEntry({ bucket: 2, maxBucket: 5, target: ['word'] })
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
    const entry = makeEntry({ bucket: 2, target: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['wrong'])

    expect(result.correct).toBe(false)
    expect(result.outcome).toBe('incorrect')
    expect(result.newBucket).toBe(1)
  })

  it('resets the word to bucket 1', () => {
    const entry = makeEntry({ bucket: 3, target: ['word'] })
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
    const entry = makeEntry({ bucket: 2, target: ['bicycle', 'bike'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['bicycle', 'wrong'])

    expect(result.correct).toBe(false)
    expect(result.outcome).toBe('partial')
    expect(result.newBucket).toBe(2)
  })

  it('keeps the word in its current bucket (does not demote)', () => {
    const entry = makeEntry({ bucket: 3, target: ['bicycle', 'bike'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['bicycle', 'wrong'])

    expect(vocabRepo.findById(entry.id)?.bucket).toBe(3)
  })

  it('promotes bucket 0 words to bucket 1 even on a partial answer', () => {
    const entry = makeEntry({ bucket: 0, target: ['bicycle', 'bike'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['bicycle', 'wrong'])

    expect(result.outcome).toBe('partial')
    expect(vocabRepo.findById(entry.id)?.bucket).toBe(1)
  })

  it('does not apply partial logic when only one answer is required (single translation)', () => {
    const entry = makeEntry({ bucket: 2, target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['wrong'])

    expect(result.outcome).toBe('incorrect')
    expect(vocabRepo.findById(entry.id)?.bucket).toBe(1)
  })

  it('applies partial logic for time-based buckets (bucket ≥ 4) too', () => {
    const entry = makeEntry({ bucket: 4, target: ['bicycle', 'bike'] })
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
    const entry = makeEntry({ bucket: 4, target: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(result.correct).toBe(true)
    expect(result.outcome).toBe('correct')
  })

  it('promotes the word to bucket + 1', () => {
    const entry = makeEntry({ bucket: 4, target: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(vocabRepo.findById(entry.id)?.bucket).toBe(5)
  })

  it('updates lastAskedAt on the vocab entry', () => {
    const entry = makeEntry({ bucket: 4, target: ['word'], lastAskedAt: null })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(vocabRepo.findById(entry.id)?.lastAskedAt).not.toBeNull()
  })

  it('does not promote a non-due time-based word when answered correctly', () => {
    // lastAskedAt = just now → word is not due yet (needs 22 h for bucket 4)
    const entry = makeEntry({ bucket: 4, target: ['word'], lastAskedAt: new Date().toISOString() })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(vocabRepo.findById(entry.id)?.bucket).toBe(4)
  })

  it('does not update lastAskedAt for a non-due time-based word answered correctly', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const entry = makeEntry({ bucket: 4, target: ['word'], lastAskedAt: oneHourAgo })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(vocabRepo.findById(entry.id)?.lastAskedAt).toBe(oneHourAgo)
  })

  it('still promotes a due time-based word when answered correctly', () => {
    // lastAskedAt = 2 days ago → definitely due for bucket 4 (22 h interval)
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    const entry = makeEntry({ bucket: 4, target: ['word'], lastAskedAt: twoDaysAgo })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(vocabRepo.findById(entry.id)?.bucket).toBe(5)
  })

  it('does not update lastAskedAt for a non-due time-based word answered partially', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    // Two-target word so a single correct answer counts as partial
    const entry = makeEntry({ bucket: 4, target: ['word1', 'word2'], lastAskedAt: oneHourAgo })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word1'])

    expect(vocabRepo.findById(entry.id)?.lastAskedAt).toBe(oneHourAgo)
  })

  it('still updates lastAskedAt for a due time-based word answered partially', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()

    // Two-target word so a single correct answer counts as partial
    const entry = makeEntry({ bucket: 4, target: ['word1', 'word2'], lastAskedAt: twoDaysAgo })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word1'])

    expect(vocabRepo.findById(entry.id)?.lastAskedAt).not.toBe(twoDaysAgo)
  })
})

// ── submitAnswer — time-based bucket second-chance flow ───────────────────────

describe('submitAnswer — wrong on time bucket (second-chance)', () => {
  it('returns outcome "second_chance" and newBucket = W1\'s current bucket (unchanged)', () => {
    const w1 = makeEntry({ bucket: 4, target: ['word'] })
    const w2 = makeEntry({ bucket: 4, target: ['other'] })
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
    const w1 = makeEntry({ bucket: 4, target: ['word'] })
    const w2 = makeEntry({ bucket: 4, target: ['other'] })
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
    const w1 = makeEntry({ bucket: 4, target: ['word'] })
    const w2 = makeEntry({ bucket: 4, target: ['other'] })
    const session = makeSession({ words: [{ vocabId: w1.id, status: 'pending' }] })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, w1.id, ['wrong'])

    // W1's bucket should not change yet
    expect(vocabRepo.findById(w1.id)?.bucket).toBe(4)
  })

  it('returns "incorrect" (not second_chance) when no second word is available', () => {
    const w1 = makeEntry({ bucket: 4, target: ['word'] })
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
  it('returns outcome "second_chance_correct", newBucket = W2 bucket (unchanged), w1NewBucket = W1 bucket (preserved)', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 4, target: ['word'] })
    const w2 = makeEntry({ id: 'w2', bucket: 4, target: ['other'] })
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
    expect(result.w1NewBucket).toBe(4)
  })

  it('keeps W2 in its current bucket', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 4, target: ['word'] })
    const w2 = makeEntry({ id: 'w2', bucket: 4, target: ['other'] })
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

  it('places W1 in second chance bucket: bucket preserved, secondChanceDueAt set', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 4, target: ['word'] })
    const w2 = makeEntry({ id: 'w2', bucket: 4, target: ['other'] })
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

    const w1Updated = vocabRepo.findById(w1.id)

    expect(w1Updated?.bucket).toBe(4)
    expect(w1Updated?.secondChanceDueAt).not.toBeNull()

    const dueAt = new Date(w1Updated?.secondChanceDueAt ?? '').getTime()

    // dueAt must be at least now + 12 h
    expect(dueAt).toBeGreaterThanOrEqual(before + 12 * 60 * 60 * 1000)
  })

  it('preserves W1 original bucket and sets secondChanceDueAt at least 12 h from now', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 5, target: ['word'] })
    const w2 = makeEntry({ id: 'w2', bucket: 5, target: ['other'] })
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

    const w1Updated = vocabRepo.findById(w1.id)

    expect(w1Updated?.bucket).toBe(5)

    const dueAt = new Date(w1Updated?.secondChanceDueAt ?? '').getTime()

    expect(dueAt).toBeGreaterThanOrEqual(before + 12 * 60 * 60 * 1000)
  })

  it('sets W1 lastAskedAt to now when entering second chance bucket', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 4, target: ['word'] })
    const w2 = makeEntry({ id: 'w2', bucket: 4, target: ['other'] })
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

    expect(w1Updated?.bucket).toBe(4)

    const lastAskedAt = new Date(w1Updated?.lastAskedAt ?? '').getTime()

    expect(lastAskedAt).toBeGreaterThanOrEqual(before)
    expect(lastAskedAt).toBeLessThanOrEqual(after)
  })
})

// ── submitAnswer — second-chance word wrong ───────────────────────────────────

describe('submitAnswer — second-chance word wrong', () => {
  it('returns outcome "second_chance_incorrect", newBucket = W2 bucket (unchanged), w1NewBucket = 1', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 4, target: ['word'] })
    const w2 = makeEntry({ id: 'w2', bucket: 4, target: ['other'] })
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
    const w1 = makeEntry({ id: 'w1', bucket: 4, target: ['word'] })
    const w2 = makeEntry({ id: 'w2', bucket: 5, target: ['other'] })
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

describe('submitAnswer — second-chance word with multiple translations', () => {
  it('counts as correct when only one of two translations is given (W2 requires only 1 answer)', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 5, target: ['word'] })
    const w2 = makeEntry({ id: 'w2', bucket: 4, target: ['other', 'another'] })
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

    expect(result.outcome).toBe('second_chance_correct')
    expect(result.correct).toBe(true)
  })
})

// ── submitAnswer — typo answers ───────────────────────────────────────────────

describe('submitAnswer — typo (close but not exact answer)', () => {
  it('returns outcome "correct_typo" when the answer is within the typo threshold', () => {
    // 'machone' vs 'machine': distance 1, ratio 1/7 ≈ 0.14 ≤ 0.15
    const entry = makeEntry({ bucket: 0, target: ['machine'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['machone'])

    expect(result.correct).toBe(true)
    expect(result.outcome).toBe('correct_typo')
  })

  it('promotes the word to bucket + 1 on a typo answer (same as correct)', () => {
    const entry = makeEntry({ bucket: 2, target: ['machine'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['machone'])

    expect(vocabRepo.findById(entry.id)?.bucket).toBe(3)
  })

  it('includes typo details in the result', () => {
    const entry = makeEntry({ bucket: 0, target: ['machine'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['machone'])

    expect(result.typos).toHaveLength(1)
    expect(result.typos?.[0]).toEqual({ typed: 'machone', correct: 'machine' })
  })

  it('returns outcome "second_chance_correct_typo" when the second-chance word is answered with a typo', () => {
    const w1 = makeEntry({ bucket: 4, target: ['word'] })
    const w2 = makeEntry({ bucket: 4, target: ['machine'] })
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
    const entry = makeEntry({ bucket: 2, target: ['machine', 'apparatus'] })
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
    const entry = makeEntry({ bucket: 2, target: ['machine', 'apparatus'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['machone', 'wrong'])

    expect(vocabRepo.findById(entry.id)?.bucket).toBe(2)
  })

  it('does not return typos for an exact correct answer', () => {
    const entry = makeEntry({ bucket: 0, target: ['machine'] })
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

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 1 })

    expect(session.type).toBe('normal')
  })

  it('creates a "repetition" session after a completed normal session (enough due words)', () => {
    // Insert MIN_SESSION_SIZE due time-based words
    for (let i = 0; i < MIN_SESSION_SIZE; i++) {
      vocabRepo.insert(makeDueTimeEntry())
    }

    // Prevent stress and breakthrough from firing (bucket-4 entries qualify for both)
    creditsRepo.setStressSessionDueAt('9999-12-31')
    creditsRepo.setBreakthroughSessionDueAt('9999-12-31')

    const prevSession = makeSession({ status: 'completed', type: 'normal' })

    sessionRepo.insert(prevSession)

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12, repetitionSize: 12 })

    expect(session.type).toBe('repetition')
  })

  it('repetition session contains only due time-based words', () => {
    for (let i = 0; i < MIN_SESSION_SIZE; i++) {
      vocabRepo.insert(makeDueTimeEntry())
    }

    // Also add some frequency words that should NOT appear
    vocabRepo.insert(makeEntry({ bucket: 0 }))

    // Prevent stress and breakthrough from firing
    creditsRepo.setStressSessionDueAt('9999-12-31')
    creditsRepo.setBreakthroughSessionDueAt('9999-12-31')

    const prevSession = makeSession({ status: 'completed', type: 'normal' })

    sessionRepo.insert(prevSession)

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12, repetitionSize: 12 })

    expect(session.type).toBe('repetition')
    expect(session.words.every((w) => {
      const entry = vocabRepo.findById(w.vocabId)
      return entry !== undefined && entry.bucket >= 4
    })).toBe(true)
  })

  it('falls back to "normal" and skips repetition when fewer than REPETITION_MIN_WORDS due time-based words exist', () => {
    // Only 3 due time-based words — not enough for REPETITION_MIN_WORDS
    for (let i = 0; i < 3; i++) {
      vocabRepo.insert(makeDueTimeEntry())
    }

    // Use bucket-1 words (active pool) so discovery does not fire
    for (let i = 0; i < MIN_SESSION_SIZE; i++) {
      vocabRepo.insert(makeEntry({ bucket: 1 }))
    }

    const prevSession = makeSession({ status: 'completed', type: 'normal' })

    sessionRepo.insert(prevSession)

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12 })

    expect(session.type).toBe('normal')
  })

  it('tries repetition again after a skipped repetition (fallback normal session)', () => {
    // First: simulate a skipped repetition — last session was 'normal' (fallback)
    // So the NEXT session should also try repetition

    // Now provide enough due words
    for (let i = 0; i < MIN_SESSION_SIZE; i++) {
      vocabRepo.insert(makeDueTimeEntry())
    }

    // Prevent stress and breakthrough from firing
    creditsRepo.setStressSessionDueAt('9999-12-31')
    creditsRepo.setBreakthroughSessionDueAt('9999-12-31')

    const fallbackNormal = makeSession({ status: 'completed', type: 'normal' })

    sessionRepo.insert(fallbackNormal)

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12, repetitionSize: 12 })

    expect(session.type).toBe('repetition')
  })

  it('creates a "normal" session after a completed repetition session', () => {
    vocabRepo.insert(makeEntry({ bucket: 0 }))

    const prevSession = makeSession({ status: 'completed', type: 'repetition' })

    sessionRepo.insert(prevSession)

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 1 })

    expect(session.type).toBe('normal')
  })

  it('normal session word count never exceeds NORMAL_SESSION_MAX_SIZE', () => {
    // Fill the active pool to suppress discovery (threshold = 80)
    for (let i = 0; i < 80; i++) {
      vocabRepo.insert(makeEntry({ bucket: 1 }))
    }

    // 11 due time-based words each in a distinct bucket (11 < REPETITION_MIN_WORDS so
    // repetition does not fire, but `selectTimeBasedWords` adds all 11 on top of the
    // 12 frequency words → 23 total, safely under the 24 cap)
    for (let i = 0; i < 11; i++) {
      vocabRepo.insert(makeEntry({ bucket: 4 + i, lastAskedAt: null }))
    }

    // Prevent all other timed session types from firing
    creditsRepo.setStressSessionDueAt('9999-12-31')
    creditsRepo.setBreakthroughSessionDueAt('9999-12-31')
    creditsRepo.setVeteranSessionDueAt('9999-12-31')

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12 })

    expect(session.type).toBe('normal')
    expect(session.words.length).toBeLessThanOrEqual(NORMAL_SESSION_MAX_SIZE)
  })
})

// ── submitAnswer — session cost ───────────────────────────────────────────────

describe('submitAnswer — answer cost', () => {
  it('returns answerCost = 0 for a correct answer', () => {
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.addBalance(10)

    const result = service.submitAnswer(session.id, entry.id, ['table'])

    expect(result.answerCost).toBe(0)
    // Balance: 10 initial + 5 bucket credit (bucket 0→1); no perfect bonus (session size < 5); no streak credit (first-ever session)
    expect(creditsRepo.getBalance()).toBe(15)
  })

  it('deducts 1 credit immediately for a wrong answer and returns answerCost = 1', () => {
    const e1 = makeEntry({ bucket: 2, maxBucket: 2, target: ['table'] })
    const e2 = makeEntry({ bucket: 2, maxBucket: 2, target: ['chair'] })
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
    const entry = makeEntry({ bucket: 2, maxBucket: 2, target: ['table'] })
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
    const e1 = makeEntry({ bucket: 2, maxBucket: 2, target: ['table'] })
    const e2 = makeEntry({ bucket: 2, maxBucket: 2, target: ['chair'] })
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

  it('does not deduct credits for a virgin word in bucket 0 answered wrongly', () => {
    const entry = makeEntry({ bucket: 0, maxBucket: 0, target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.addBalance(10)

    const result = service.submitAnswer(session.id, entry.id, ['wrong'])

    expect(result.answerCost).toBe(0)
    expect(creditsRepo.getBalance()).toBe(10)
  })

  it('does not deduct credits for a word in bucket 1 that has never been higher', () => {
    const entry = makeEntry({ bucket: 1, maxBucket: 1, target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.addBalance(10)

    const result = service.submitAnswer(session.id, entry.id, ['wrong'])

    expect(result.answerCost).toBe(0)
    expect(creditsRepo.getBalance()).toBe(10)
  })

  it('deducts 1 credit for a word that fell back to bucket 1 but previously reached a higher bucket', () => {
    const entry = makeEntry({ bucket: 1, maxBucket: 4, target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.addBalance(10)

    const result = service.submitAnswer(session.id, entry.id, ['wrong'])

    expect(result.answerCost).toBe(1)
    expect(creditsRepo.getBalance()).toBe(9)
  })
})

// ── perfect session bonus ─────────────────────────────────────────────────────

describe('submitAnswer — perfect session bonus', () => {
  it('awards 20 credits for a perfect normal session (≥ 5 words)', () => {
    const entries = Array.from({ length: 5 }, () => makeEntry({ target: ['table'] }))
    const session = makeSession({ words: entries.map((e) => ({ vocabId: e.id, status: 'pending' })) })

    for (const e of entries) { vocabRepo.insert(e) }
    sessionRepo.insert(session)

    for (let i = 0; i < 4; i++) { service.submitAnswer(session.id, entries[i].id, ['table']) }
    const result = service.submitAnswer(session.id, entries[4].id, ['table'])

    expect(result.perfectBonus).toBe(20)
    expect(result.sessionCompleted).toBe(true)
  })

  it('does not award a bonus when session has fewer than 5 words', () => {
    const entries = Array.from({ length: 4 }, () => makeEntry({ target: ['table'] }))
    const session = makeSession({ words: entries.map((e) => ({ vocabId: e.id, status: 'pending' })) })

    for (const e of entries) { vocabRepo.insert(e) }
    sessionRepo.insert(session)

    for (let i = 0; i < 3; i++) { service.submitAnswer(session.id, entries[i].id, ['table']) }
    const result = service.submitAnswer(session.id, entries[3].id, ['table'])

    expect(result.perfectBonus).toBe(0)
  })

  it('does not award a bonus when any word is answered incorrectly', () => {
    const e1 = makeEntry({ target: ['table'] })
    const e2 = makeEntry({ target: ['chair'] })
    const session = makeSession({ words: [{ vocabId: e1.id, status: 'pending' }, { vocabId: e2.id, status: 'pending' }] })

    vocabRepo.insert(e1)
    vocabRepo.insert(e2)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, e1.id, ['wrong'])
    const result = service.submitAnswer(session.id, e2.id, ['chair'])

    expect(result.perfectBonus).toBe(0)
  })

  it('does not award a bonus when a second-chance word was used', () => {
    const w1 = makeEntry({ bucket: 4, target: ['table'], lastAskedAt: null })
    const w2 = makeEntry({ bucket: 4, target: ['chair'], lastAskedAt: null })
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
    const e1 = makeEntry({ target: ['table'] })
    const e2 = makeEntry({ target: ['chair'] })
    const session = makeSession({ words: [{ vocabId: e1.id, status: 'pending' }, { vocabId: e2.id, status: 'pending' }] })

    vocabRepo.insert(e1)
    vocabRepo.insert(e2)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, e1.id, ['table'])

    expect(result.perfectBonus).toBe(0)
    expect(result.sessionCompleted).toBe(false)
  })

  it('adds the bonus to the credit balance', () => {
    const entries = Array.from({ length: 5 }, () => makeEntry({ target: ['table'] }))
    const session = makeSession({ words: entries.map((e) => ({ vocabId: e.id, status: 'pending' })) })

    for (const e of entries) { vocabRepo.insert(e) }
    sessionRepo.insert(session)
    creditsRepo.addBalance(5)

    for (let i = 0; i < 4; i++) { service.submitAnswer(session.id, entries[i].id, ['table']) }
    service.submitAnswer(session.id, entries[4].id, ['table'])

    // Perfect bonus (+20) + 5 bucket credits (bucket 0→1 per word) on top of initial 5; no streak credit (first-ever session, streak = 1)
    expect(creditsRepo.getBalance()).toBe(50)
  })

  it('does not award a bonus when hints were used', () => {
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['table'], true)

    expect(result.perfectBonus).toBe(0)
  })

  it('awards 20 credits for a perfect discovery session (all correct, no push-backs, ≥ 5 words)', () => {
    const entries = Array.from({ length: 5 }, () => makeEntry({ bucket: 0, target: ['dog'] }))
    const session = makeSession({
      type: 'discovery',
      words: entries.map((e) => ({ vocabId: e.id, status: 'pending' })),
    })

    for (const e of entries) { vocabRepo.insert(e) }
    sessionRepo.insert(session)

    for (let i = 0; i < 4; i++) { service.submitAnswer(session.id, entries[i].id, ['dog']) }
    const result = service.submitAnswer(session.id, entries[4].id, ['dog'])

    expect(result.perfectBonus).toBe(20)
    expect(result.sessionCompleted).toBe(true)
  })

  it('does not award 100 credits when a discovery session has a pushed-back word', () => {
    const e1 = makeEntry({ bucket: 0, target: ['dog'] })
    const e2 = makeEntry({ bucket: 0, target: ['cat'] })
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
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'incorrect' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const updated = service.markWordCorrect(session.id, entry.id)

    expect(updated.words[0]?.status).toBe('correct')
  })

  it('persists the updated status in the repository', () => {
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'incorrect' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.markWordCorrect(session.id, entry.id)

    expect(sessionRepo.findById(session.id)?.words[0]?.status).toBe('correct')
  })

  it('only changes the target word, leaving others unchanged', () => {
    const e1 = makeEntry({ id: 'e1', target: ['table'] })
    const e2 = makeEntry({ id: 'e2', target: ['chair'] })
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

  it('removes a pending W2 word whose secondChanceFor references the corrected word', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 5, target: ['table'] })
    const w2 = makeEntry({ id: 'w2', target: ['chair'] })
    const session = makeSession({
      words: [
        { vocabId: w1.id, status: 'incorrect' },
        { vocabId: w2.id, status: 'pending', secondChanceFor: w1.id },
      ],
    })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    const updated = service.markWordCorrect(session.id, w1.id)

    expect(updated.words).toHaveLength(1)
    expect(updated.words[0]?.vocabId).toBe(w1.id)
    expect(updated.words[0]?.status).toBe('correct')
  })

  it('marks session as completed when removing W2 leaves no pending words', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 5, target: ['table'] })
    const w2 = makeEntry({ id: 'w2', target: ['chair'] })
    const session = makeSession({
      words: [
        { vocabId: w1.id, status: 'incorrect' },
        { vocabId: w2.id, status: 'pending', secondChanceFor: w1.id },
      ],
    })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    const updated = service.markWordCorrect(session.id, w1.id)

    expect(updated.status).toBe('completed')
  })

  it('does not remove a non-pending W2 (e.g. already answered)', () => {
    const w1 = makeEntry({ id: 'w1', bucket: 5, target: ['table'] })
    const w2 = makeEntry({ id: 'w2', target: ['chair'] })
    const session = makeSession({
      words: [
        { vocabId: w1.id, status: 'incorrect' },
        { vocabId: w2.id, status: 'correct', secondChanceFor: w1.id },
      ],
    })

    vocabRepo.insert(w1)
    vocabRepo.insert(w2)
    sessionRepo.insert(session)

    const updated = service.markWordCorrect(session.id, w1.id)

    expect(updated.words).toHaveLength(2)
  })

  it('throws ApiError 404 when session is not found', () => {
    expectApiError(() => service.markWordCorrect('no-such-session', 'any-vocab'), 404)
  })

  it('throws ApiError 400 when the word is not in incorrect status', () => {
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'correct' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    expectApiError(() => service.markWordCorrect(session.id, entry.id), 400)
  })
})

// ── earned stars ──────────────────────────────────────────────────────────────

describe('submitAnswer — earned stars', () => {
  it('awards +1 star when first entering Established (bucket 4)', () => {
    const entry = makeEntry({ target: ['word'], bucket: 3, maxBucket: 3 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(creditsRepo.getEarnedStars()).toBe(1)
    expect(creditsRepo.getMaxBucketEver()).toBe(4)
  })

  it('does not award a star for bucket 5 (within Established, not a group boundary)', () => {
    creditsRepo.setMaxBucketEver(4)
    const entry = makeEntry({ target: ['word'], bucket: 4, maxBucket: 4 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(creditsRepo.getEarnedStars()).toBe(0)
    expect(creditsRepo.getMaxBucketEver()).toBe(5)
  })

  it('awards +1 star when first entering Veteran (bucket 6)', () => {
    creditsRepo.setMaxBucketEver(5)
    const entry = makeEntry({ target: ['word'], bucket: 5, maxBucket: 5 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(creditsRepo.getEarnedStars()).toBe(1)
    expect(creditsRepo.getMaxBucketEver()).toBe(6)
  })

  it('does not award a star for buckets 7–9 (within Veteran)', () => {
    creditsRepo.setMaxBucketEver(6)
    const entry = makeEntry({ target: ['word'], bucket: 6, maxBucket: 6 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(creditsRepo.getEarnedStars()).toBe(0)
    expect(creditsRepo.getMaxBucketEver()).toBe(7)
  })

  it('awards +1 star when first entering Master (bucket 10)', () => {
    creditsRepo.setMaxBucketEver(9)
    const entry = makeEntry({ target: ['word'], bucket: 9, maxBucket: 9 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(creditsRepo.getEarnedStars()).toBe(1)
    expect(creditsRepo.getMaxBucketEver()).toBe(10)
  })

  it('awards +1 star when first entering Legend (bucket 14)', () => {
    creditsRepo.setMaxBucketEver(13)
    const entry = makeEntry({ target: ['word'], bucket: 13, maxBucket: 13 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(creditsRepo.getEarnedStars()).toBe(1)
    expect(creditsRepo.getMaxBucketEver()).toBe(14)
  })

  it('does not award a star when the bucket already existed globally', () => {
    creditsRepo.setMaxBucketEver(4)
    const entry = makeEntry({ target: ['word'], bucket: 3, maxBucket: 3 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(creditsRepo.getEarnedStars()).toBe(0)
  })

  it('does not award a star for buckets 1–3', () => {
    const entry = makeEntry({ target: ['word'], bucket: 0, maxBucket: 0 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(creditsRepo.getEarnedStars()).toBe(0)
  })

  it('awards a star in a stress session when a new group bucket is reached', () => {
    const entry = makeEntry({ target: ['word'], bucket: 3, maxBucket: 3 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }], type: 'stress' })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    expect(creditsRepo.getEarnedStars()).toBe(1)
  })
})

// ── bucket milestone bonus ─────────────────────────────────────────────────────

describe('submitAnswer — bucket milestone bonus', () => {
  it('awards 100 credits when a word is first promoted into bucket 6', () => {
    const entry = makeEntry({ target: ['word'], bucket: 5, maxBucket: 5 })
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
    const entry = makeEntry({ target: ['word'], bucket: 6, maxBucket: 6 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(result.bucketMilestoneBonus).toBe(200)
    expect(creditsRepo.getMaxBucketEver()).toBe(7)
  })

  it('does not award a bonus when bucket 5 is created for the first time (threshold is 6)', () => {
    const entry = makeEntry({ target: ['word'], bucket: 4, maxBucket: 4 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(result.bucketMilestoneBonus).toBe(0)
  })

  it('does not award a second bonus when bucket 6 already existed', () => {
    creditsRepo.setMaxBucketEver(6)
    const entry = makeEntry({ target: ['word'], bucket: 5, maxBucket: 5 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(result.bucketMilestoneBonus).toBe(0)
  })

  it('awards 500 credits when bucket 10 (Master) is reached for the first time (cap)', () => {
    creditsRepo.setMaxBucketEver(9)
    const entry = makeEntry({ target: ['word'], bucket: 9, maxBucket: 9 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(result.bucketMilestoneBonus).toBe(500)
    expect(creditsRepo.getMaxBucketEver()).toBe(10)
  })

  it('awards 500 credits (cap) when bucket 11 is reached for the first time', () => {
    creditsRepo.setMaxBucketEver(10)
    const entry = makeEntry({ target: ['word'], bucket: 10, maxBucket: 10 })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['word'])

    expect(result.bucketMilestoneBonus).toBe(500)
    expect(creditsRepo.getMaxBucketEver()).toBe(11)
  })

  it('returns bucketMilestoneBonus = 0 for a wrong answer', () => {
    const entry = makeEntry({ target: ['word'], bucket: 5, maxBucket: 5 })
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
    const entry = makeEntry({ target: ['table'] })
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
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.updateStreak(1, yesterdayStr)  // streak was 1, last session yesterday → becomes 2

    const result = service.submitAnswer(session.id, entry.id, ['table'])

    expect(result.streakCredit).toBe(1)
  })

  it('returns streakCredit = 0 when streak resets to 1 (gap in practice)', () => {
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.updateStreak(5, '2020-01-01')  // last session was days ago → newStreak = 1

    const result = service.submitAnswer(session.id, entry.id, ['table'])

    expect(result.streakCredit).toBe(0)
  })

  it('returns streakCredit = 0 when the session does not complete', () => {
    const e1 = makeEntry({ target: ['table'] })
    const e2 = makeEntry({ target: ['chair'] })
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
    const entry = makeEntry({ target: ['table'] })
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

    const entry = makeEntry({ target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.updateStreak(5, yesterdayStr)

    service.submitAnswer(session.id, entry.id, ['table'])

    expect(creditsRepo.getStreakCount()).toBe(6)
  })

  it('resets the streak count to 1 when last session was more than a day ago', () => {
    const entry = makeEntry({ target: ['table'] })
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

    const entry = makeEntry({ target: ['table'] })
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
    const entry = makeEntry({ target: ['table'] })
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
    const entry = makeEntry({ target: ['table'] })
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
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.updateStreak(5, yesterdayStr)  // streak becomes 6, no milestone

    const result = service.submitAnswer(session.id, entry.id, ['table'])

    expect(result.streakCredit).toBe(1)
    expect(result.milestoneLabel).toBeUndefined()
  })

  it('uses firstAnsweredAt date to continue a streak when session was started yesterday and completed today', () => {
    const today = new Date().toISOString().slice(0, 10)
    const dYesterday = new Date(today + 'T00:00:00Z')
    dYesterday.setUTCDate(dYesterday.getUTCDate() - 1)
    const yesterdayStr = dYesterday.toISOString().slice(0, 10)
    const dTwoDaysAgo = new Date(today + 'T00:00:00Z')
    dTwoDaysAgo.setUTCDate(dTwoDaysAgo.getUTCDate() - 2)
    const twoDaysAgoStr = dTwoDaysAgo.toISOString().slice(0, 10)

    const entry = makeEntry({ target: ['table'] })
    // Session was started yesterday at 23:50 but is being completed today
    const session = makeSession({
      words: [{ vocabId: entry.id, status: 'pending' }],
      firstAnsweredAt: yesterdayStr + 'T23:50:00Z',
    })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    // Last completed session was 2 days ago
    creditsRepo.updateStreak(5, twoDaysAgoStr)

    service.submitAnswer(session.id, entry.id, ['table'])

    // effectiveDate = yesterday; lastDate = 2 days ago; yesterday = twoDaysAgo + 1 → streak continues
    expect(creditsRepo.getStreakCount()).toBe(6)
    expect(creditsRepo.getLastSessionDate()).toBe(yesterdayStr)
  })

  it('resets streak to 1 and uses completionDate when session spanned more than 2 calendar days', () => {
    const today = new Date().toISOString().slice(0, 10)
    const threeDaysAgo = new Date(today + 'T00:00:00Z')
    threeDaysAgo.setUTCDate(threeDaysAgo.getUTCDate() - 3)
    const threeDaysAgoStr = threeDaysAgo.toISOString().slice(0, 10)

    const entry = makeEntry({ target: ['table'] })
    const session = makeSession({
      words: [{ vocabId: entry.id, status: 'pending' }],
      firstAnsweredAt: threeDaysAgoStr + 'T10:00:00Z',
    })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)
    creditsRepo.updateStreak(10, threeDaysAgoStr)

    service.submitAnswer(session.id, entry.id, ['table'])

    // Streak resets to 1, effective date is today (completion date)
    expect(creditsRepo.getStreakCount()).toBe(1)
    expect(creditsRepo.getLastSessionDate()).toBe(today)
  })

  it('resets weeksAwarded and monthsAwarded to 0 when the streak restarts', () => {
    const entry = makeEntry({ target: ['table'] })
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

    const entry = makeEntry({ target: ['table'] })
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
    const e1 = makeEntry({ target: ['table'] })
    const e2 = makeEntry({ target: ['chair'] })
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

  it(`creates a "focus" session when ${MIN_SESSION_SIZE}+ words with score >= 2 and bucket > 0 exist`, () => {
    for (let i = 0; i < MIN_SESSION_SIZE; i++) {
      vocabRepo.insert(makeHighScoreEntry())
    }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 10 })

    expect(session.type).toBe('focus')
  })

  it(`does not create a "focus" session when fewer than ${MIN_SESSION_SIZE} qualifying words exist`, () => {
    for (let i = 0; i < MIN_SESSION_SIZE - 1; i++) {
      vocabRepo.insert(makeHighScoreEntry())
    }

    // Use bucket-1 words so discovery does not fire
    for (let i = 0; i < 10; i++) {
      vocabRepo.insert(makeEntry({ bucket: 1 }))
    }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 10 })

    expect(session.type).not.toBe('focus')
  })

  it('focus session takes priority over normal/repetition alternation', () => {
    // Previous session was 'normal', so alternation would pick 'repetition'
    // But focus conditions are met, so 'focus' wins
    const prevSession = makeSession({ status: 'completed', type: 'normal' })

    sessionRepo.insert(prevSession)

    for (let i = 0; i < MIN_SESSION_SIZE; i++) {
      vocabRepo.insert(makeHighScoreEntry())
    }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 10 })

    expect(session.type).toBe('focus')
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

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12, discoverySize: DISC_SIZE })

    expect(session.type).toBe('discovery')
    expect(session.words).toHaveLength(DISC_SIZE)
  })

  it('does not create a discovery session when active pool >= threshold', () => {
    insertActivePoolWords(DISCOVERY_POOL_THRESHOLD)
    insertBucket0Words(DISC_SIZE)

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12, discoverySize: DISC_SIZE })

    expect(session.type).not.toBe('discovery')
  })

  it('does not create a discovery session when fewer than DISCOVERY_MIN_WORDS bucket-0 words exist', () => {
    insertActivePoolWords(DISCOVERY_POOL_THRESHOLD - 1)
    insertBucket0Words(9)

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12 })

    expect(session.type).not.toBe('discovery')
  })

  it('discovery session takes priority over focus', () => {
    // Use 5 high-score bucket-1 entries as the entire active pool (well below threshold)
    for (let i = 0; i < 5; i++) {
      vocabRepo.insert(makeEntry({ bucket: 1, score: 2 }))
    }

    insertBucket0Words(DISC_SIZE)

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12, discoverySize: DISC_SIZE })

    expect(session.type).toBe('discovery')
  })

  it('discovery session takes priority over normal/repetition alternation', () => {
    insertActivePoolWords(DISCOVERY_POOL_THRESHOLD - 1)
    insertBucket0Words(DISC_SIZE)

    sessionRepo.insert(makeSession({ status: 'completed', type: 'normal' }))

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12, discoverySize: DISC_SIZE })

    expect(session.type).toBe('discovery')
  })

  it('discovery session only contains bucket-0 words', () => {
    insertActivePoolWords(DISCOVERY_POOL_THRESHOLD - 1)
    insertBucket0Words(DISC_SIZE)

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12, discoverySize: DISC_SIZE })

    expect(session.type).toBe('discovery')

    for (const word of session.words) {
      const entry = vocabRepo.findById(word.vocabId)
      expect(entry?.bucket).toBe(0)
    }
  })

  it('falls through to focus when discovery conditions are not met', () => {
    // Active pool below threshold but not enough bucket-0 words
    insertActivePoolWords(DISCOVERY_POOL_THRESHOLD - 1)

    for (let i = 0; i < MIN_SESSION_SIZE; i++) {
      vocabRepo.insert(makeEntry({ bucket: 1, score: 2 }))
    }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12, discoverySize: DISC_SIZE })

    expect(session.type).toBe('focus')
  })

  it('does not create a discovery session when one was already completed today', () => {
    insertActivePoolWords(DISCOVERY_POOL_THRESHOLD - 1)
    insertBucket0Words(DISC_SIZE)

    const today = new Date().toISOString().slice(0, 10)

    creditsRepo.setLastDiscoverySessionDate(today)

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12, discoverySize: DISC_SIZE })

    expect(session.type).not.toBe('discovery')
  })

  it('records last_discovery_session_date when a discovery session completes via submitAnswer', () => {
    insertActivePoolWords(DISCOVERY_POOL_THRESHOLD - 1)
    insertBucket0Words(DISC_SIZE)

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12, discoverySize: DISC_SIZE })

    expect(session.type).toBe('discovery')

    // Answer all words correctly to complete the session
    for (const word of session.words) {
      const entry = vocabRepo.findById(word.vocabId)
      if (!entry) { continue }
      const answer = entry.target[0] ?? ''
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
    const entry = makeEntry({ bucket: 0, source: 'Hund', target: ['dog'] })

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

  it(`returns available=true when at least ${MIN_SESSION_SIZE} marked words exist and none done today`, () => {
    for (let i = 0; i < MIN_SESSION_SIZE; i++) { vocabRepo.insert(makeEntry({ marked: true })) }

    const result = service.getStarredSessionAvailable()

    expect(result.available).toBe(true)
    expect(result.markedCount).toBe(MIN_SESSION_SIZE)
  })

  it(`returns available=false when fewer than ${MIN_SESSION_SIZE} words are marked`, () => {
    for (let i = 0; i < MIN_SESSION_SIZE - 1; i++) { vocabRepo.insert(makeEntry({ marked: true })) }

    const result = service.getStarredSessionAvailable()

    expect(result.available).toBe(false)
    expect(result.markedCount).toBe(MIN_SESSION_SIZE - 1)
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
    for (let i = 0; i < MIN_SESSION_SIZE; i++) { vocabRepo.insert(makeEntry({ marked: true })) }
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
    for (let i = 0; i < MIN_SESSION_SIZE; i++) { vocabRepo.insert(makeEntry({ marked: true })) }
    vocabRepo.insert(makeEntry({ marked: false }))

    const session = service.createStarredSession('SOURCE_TO_TARGET')

    expect(session.type).toBe('starred')
    expect(session.words).toHaveLength(MIN_SESSION_SIZE)
  })

  it('throws 400 when no words are marked', () => {
    vocabRepo.insert(makeEntry({ marked: false }))

    expectApiError(() => service.createStarredSession('SOURCE_TO_TARGET'), 400)
  })

  it(`throws 400 when fewer than ${MIN_SESSION_SIZE} words are marked`, () => {
    for (let i = 0; i < MIN_SESSION_SIZE - 1; i++) { vocabRepo.insert(makeEntry({ marked: true })) }

    expectApiError(() => service.createStarredSession('SOURCE_TO_TARGET'), 400)
  })

  it('throws 409 when a session is in progress (has answered words)', () => {
    vocabRepo.insert(makeEntry({ marked: true }))
    sessionRepo.insert(makeSession({
      status: 'open',
      words: [{ vocabId: 'x', status: 'correct' }, { vocabId: 'y', status: 'pending' }],
    }))

    expectApiError(() => service.createStarredSession('SOURCE_TO_TARGET'), 409)
  })

  it('discards an unstarted open session and creates the starred session', () => {
    const entry = makeEntry({ marked: true })

    vocabRepo.insert(entry)
    for (let i = 0; i < MIN_SESSION_SIZE - 1; i++) { vocabRepo.insert(makeEntry({ marked: true })) }

    const unstarted = makeSession({ status: 'open', words: [{ vocabId: entry.id, status: 'pending' }] })

    sessionRepo.insert(unstarted)

    const session = service.createStarredSession('SOURCE_TO_TARGET')

    expect(session.type).toBe('starred')
    expect(sessionRepo.findById(unstarted.id)).toBeUndefined()
  })

  it('throws 409 when a starred session was already completed today', () => {
    vocabRepo.insert(makeEntry({ marked: true }))
    creditsRepo.setLastStarredSessionDate(new Date().toISOString().slice(0, 10))

    expectApiError(() => service.createStarredSession('SOURCE_TO_TARGET'), 409)
  })

  it('throws 423 when the game is paused', () => {
    vocabRepo.insert(makeEntry({ marked: true }))
    creditsRepo.setPauseActive('2026-01-01')

    expectApiError(() => service.createStarredSession('SOURCE_TO_TARGET'), 423)
  })

  it('caps the session at 100 words', () => {
    for (let i = 0; i < 120; i++) {
      vocabRepo.insert(makeEntry({ marked: true }))
    }

    const session = service.createStarredSession('SOURCE_TO_TARGET')

    expect(session.words).toHaveLength(100)
  })

  it('records the last starred session date when session completes', () => {
    const entries = Array.from({ length: MIN_SESSION_SIZE }, () => makeEntry({ marked: true }))

    for (const e of entries) { vocabRepo.insert(e) }

    const session = service.createStarredSession('SOURCE_TO_TARGET')

    for (const e of entries) { service.submitAnswer(session.id, e.id, ['word']) }

    const today = new Date().toISOString().slice(0, 10)

    expect(creditsRepo.getLastStarredSessionDate()).toBe(today)
  })

})

// ── Stress Session ─────────────────────────────────────────────────────────────

describe('stress session — createSession', () => {
  function makeQualifyingEntries(count: number, bucket = 3): VocabEntry[] {
    const entries: VocabEntry[] = []

    for (let i = 0; i < count; i++) {
      entries.push(makeEntry({ bucket, source: `word${i}`, target: [`t${i}`] }))
    }

    return entries
  }

  it('creates a stress session when all conditions are met', () => {
    creditsRepo.setStressSessionDueAt('2026-01-01')

    const entries = makeQualifyingEntries(MIN_SESSION_SIZE)

    for (const e of entries) { vocabRepo.insert(e) }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 10 })

    expect(session.type).toBe('stress')
  })

  it('creates stress session even with 0 credits (no balance requirement)', () => {
    creditsRepo.setStressSessionDueAt('2026-01-01')

    const entries = makeQualifyingEntries(MIN_SESSION_SIZE)

    for (const e of entries) { vocabRepo.insert(e) }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 10 })

    expect(session.type).toBe('stress')
    expect(session.stressHighStakes).toBe(false)
  })

  it('sets stressHighStakes=true when balance >= 500 at session start', () => {
    creditsRepo.addBalance(500)
    creditsRepo.setStressSessionDueAt('2026-01-01')

    const entries = makeQualifyingEntries(MIN_SESSION_SIZE)

    for (const e of entries) { vocabRepo.insert(e) }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 10 })

    expect(session.type).toBe('stress')
    expect(session.stressHighStakes).toBe(true)
  })

  it('schedules the first stress session when qualifying words first reach minimum', () => {
    const entries = makeQualifyingEntries(MIN_SESSION_SIZE)

    for (const e of entries) { vocabRepo.insert(e) }

    service.createSession({ direction: 'SOURCE_TO_TARGET', size: 10 })

    expect(creditsRepo.getStressSessionDueAt()).not.toBeNull()
  })

  it('does not create stress session when due date is in the future', () => {
    creditsRepo.setStressSessionDueAt('9999-12-31')

    const entries = makeQualifyingEntries(MIN_SESSION_SIZE)

    for (const e of entries) { vocabRepo.insert(e) }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 10 })

    expect(session.type).not.toBe('stress')
  })

  it('stress session only draws words from bucket 2+ (never bucket 0 or 1)', () => {
    creditsRepo.setStressSessionDueAt('2026-01-01')

    for (let i = 0; i < 5; i++) { vocabRepo.insert(makeEntry({ bucket: 0 })) }
    for (let i = 0; i < 5; i++) { vocabRepo.insert(makeEntry({ bucket: 1 })) }

    const qualifying = makeQualifyingEntries(MIN_SESSION_SIZE, 2)

    for (const e of qualifying) { vocabRepo.insert(e) }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 10 })

    expect(session.type).toBe('stress')
    expect(session.words.length).toBeGreaterThan(0)

    // Only bucket 2+ words should appear — bucket 0/1 words must be excluded
    const buckets = session.words.map((w) => vocabRepo.findById(w.vocabId)?.bucket ?? -1)

    expect(buckets.every((b) => b >= 2)).toBe(true)
  })

  it('stress session takes priority over discovery', () => {
    creditsRepo.setStressSessionDueAt('2026-01-01')

    // Active pool < threshold to trigger discovery
    for (let i = 0; i < 30; i++) { vocabRepo.insert(makeEntry({ bucket: 0 })) }
    for (let i = 0; i < MIN_SESSION_SIZE; i++) { vocabRepo.insert(makeEntry({ bucket: 3 })) }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 10 })

    expect(session.type).toBe('stress')
  })
})

describe('stress session — answer scoring', () => {
  function makeStressSession(words: VocabEntry[], highStakes = true): Session {
    return makeSession({
      type: 'stress',
      words: words.map((e) => ({ vocabId: e.id, status: 'pending' })),
      status: 'open',
      stressHighStakes: highStakes,
    })
  }

  it('deducts fee credits for a wrong answer in high-stakes mode', () => {
    const entry = makeEntry({ bucket: 3, source: 'Hund', target: ['dog'] })

    vocabRepo.insert(entry)
    creditsRepo.addBalance(500)

    const sess = makeStressSession([entry], true)

    sessionRepo.insert(sess)

    const result = service.submitAnswer(sess.id, entry.id, ['wrong'])

    // fee = floor(500 / 1) = 500, rounded to even = 500
    expect(result.answerCost).toBe(500)
    expect(creditsRepo.getBalance()).toBe(0)
  })

  it('deducts half fee for a partial answer in high-stakes mode', () => {
    const entry = makeEntry({ bucket: 3, source: 'Hund', target: ['dog', 'hound'] })

    vocabRepo.insert(entry)
    creditsRepo.addBalance(500)

    const sess = makeStressSession([entry], true)

    sessionRepo.insert(sess)

    const result = service.submitAnswer(sess.id, entry.id, ['dog'])

    // fee = 500, partial = 250
    expect(result.answerCost).toBe(250)
    expect(result.outcome).toBe('partial')
  })

  it('deducts 1 credit for a wrong answer in standard mode (balance < 500)', () => {
    const entry = makeEntry({ bucket: 3, source: 'Hund', target: ['dog'], maxBucket: 3 })

    vocabRepo.insert(entry)
    creditsRepo.addBalance(10)

    const sess = makeStressSession([entry], false)

    sessionRepo.insert(sess)

    const result = service.submitAnswer(sess.id, entry.id, ['wrong'])

    expect(result.answerCost).toBe(1)
    expect(creditsRepo.getBalance()).toBe(9)
  })

  it('resets frequency-bucket word to bucket 1 on wrong answer', () => {
    const entry = makeEntry({ bucket: 3, source: 'Hund', target: ['dog'] })

    vocabRepo.insert(entry)
    creditsRepo.addBalance(500)

    const sess = makeStressSession([entry])

    sessionRepo.insert(sess)

    service.submitAnswer(sess.id, entry.id, ['wrong'])

    const updated = vocabRepo.findById(entry.id)

    expect(updated?.bucket).toBe(1)
  })

  it('triggers second-chance flow for wrong answer on time-based words', () => {
    const entry = makeEntry({ bucket: 4, source: 'Hund', target: ['dog'], lastAskedAt: null })
    const other = makeEntry({ bucket: 4, source: 'Katze', target: ['cat'], lastAskedAt: null })

    vocabRepo.insert(entry)
    vocabRepo.insert(other)
    creditsRepo.addBalance(500)

    const sess = makeStressSession([entry])

    sessionRepo.insert(sess)

    const result = service.submitAnswer(sess.id, entry.id, ['wrong'])

    expect(result.outcome).toBe('second_chance')
    expect(result.session.words).toHaveLength(2)
  })

  it('correct answer earns +5 credits when word reaches new personal bucket record', () => {
    const entry = makeEntry({ bucket: 3, source: 'Hund', target: ['dog'], maxBucket: 2 })

    vocabRepo.insert(entry)
    creditsRepo.addBalance(500)

    const sess = makeStressSession([entry])

    sessionRepo.insert(sess)

    const result = service.submitAnswer(sess.id, entry.id, ['dog'])

    expect(result.creditsEarned).toBe(5)
  })

  it('correct answer earns no credits when not a new bucket record', () => {
    const entry = makeEntry({ bucket: 3, source: 'Hund', target: ['dog'], maxBucket: 5 })

    vocabRepo.insert(entry)
    creditsRepo.addBalance(500)

    const sess = makeStressSession([entry])

    sessionRepo.insert(sess)

    const result = service.submitAnswer(sess.id, entry.id, ['dog'])

    expect(result.creditsEarned).toBe(0)
    expect(result.bucketMilestoneBonus).toBe(0)
  })

  it('awards +100 perfect bonus for perfect stress session (≥ 5 words)', () => {
    const entries = Array.from({ length: 5 }, () => makeEntry({ bucket: 3, source: 'Hund', target: ['dog'], maxBucket: 5 }))

    for (const e of entries) { vocabRepo.insert(e) }
    creditsRepo.addBalance(500)

    const sess = makeStressSession(entries)

    sessionRepo.insert(sess)

    for (let i = 0; i < 4; i++) { service.submitAnswer(sess.id, entries[i].id, ['dog']) }
    const result = service.submitAnswer(sess.id, entries[4].id, ['dog'])

    expect(result.perfectBonus).toBe(100)
  })

  it('schedules next stress session at least 6 days after completion', () => {
    const entry = makeEntry({ bucket: 3, source: 'Hund', target: ['dog'] })

    vocabRepo.insert(entry)
    creditsRepo.setStressSessionDueAt('2026-01-01')

    const sess = makeStressSession([entry])

    sessionRepo.insert(sess)

    service.submitAnswer(sess.id, entry.id, ['dog'])

    const newDueAt = creditsRepo.getStressSessionDueAt()

    expect(newDueAt).not.toBeNull()

    if (newDueAt !== null) {
      // Next due at is at least 6 days from today (2026-03-27)
      expect(newDueAt >= '2026-04-02').toBe(true)
    }
  })
})

// ── Veteran Session ────────────────────────────────────────────────────────────

describe('veteran session — createSession', () => {
  function makeBucket6Entries(count: number): VocabEntry[] {
    const entries: VocabEntry[] = []

    for (let i = 0; i < count; i++) {
      entries.push(makeEntry({ bucket: 6, difficulty: 2, source: `Wort${i}`, target: [`word${i}`] }))
    }

    return entries
  }

  it('creates a veteran session when all conditions are met', () => {
    creditsRepo.setVeteranSessionDueAt('2026-01-01')
    creditsRepo.setStressSessionDueAt('9999-12-31')

    const entries = makeBucket6Entries(VETERAN_MIN_BUCKET6_WORDS)

    for (const e of entries) {
      vocabRepo.insert(e)
    }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12 })

    expect(session.type).toBe('veteran')
  })

  it('does not create a veteran session when bucket-6+ count is below minimum', () => {
    creditsRepo.setVeteranSessionDueAt('2026-01-01')

    const entries = makeBucket6Entries(VETERAN_MIN_BUCKET6_WORDS - 1)

    for (const e of entries) {
      vocabRepo.insert(e)
    }

    // Add enough bucket-0 words for a normal session
    for (let i = 0; i < 20; i++) {
      vocabRepo.insert(makeEntry({ bucket: 0 }))
    }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12 })

    expect(session.type).not.toBe('veteran')
  })

  it('does not create a veteran session when due date is in the future', () => {
    creditsRepo.setVeteranSessionDueAt('9999-12-31')

    const entries = makeBucket6Entries(VETERAN_MIN_BUCKET6_WORDS)

    for (const e of entries) {
      vocabRepo.insert(e)
    }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12 })

    expect(session.type).not.toBe('veteran')
  })

  it('schedules the first veteran session when bucket-6+ count first reaches minimum', () => {
    const entries = makeBucket6Entries(VETERAN_MIN_BUCKET6_WORDS)

    for (const e of entries) {
      vocabRepo.insert(e)
    }

    service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12 })

    expect(creditsRepo.getVeteranSessionDueAt()).not.toBeNull()
  })

  it('veteran session takes priority over normal/repetition', () => {
    creditsRepo.setVeteranSessionDueAt('2026-01-01')
    creditsRepo.setStressSessionDueAt('9999-12-31')
    sessionRepo.insert(makeSession({ status: 'completed', type: 'normal' }))

    const entries = makeBucket6Entries(VETERAN_MIN_BUCKET6_WORDS)

    for (const e of entries) {
      vocabRepo.insert(e)
    }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12 })

    expect(session.type).toBe('veteran')
  })

  it('focus session takes priority over veteran session', () => {
    creditsRepo.setVeteranSessionDueAt('2026-01-01')
    creditsRepo.setStressSessionDueAt('9999-12-31')

    const bucket6Entries = makeBucket6Entries(VETERAN_MIN_BUCKET6_WORDS)

    for (const e of bucket6Entries) {
      vocabRepo.insert(e)
    }

    // Add MIN_SESSION_SIZE high-score entries in buckets 1–5 to trigger focus
    for (let i = 0; i < MIN_SESSION_SIZE; i++) {
      vocabRepo.insert(makeEntry({ bucket: 2, score: 2 }))
    }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12 })

    expect(session.type).toBe('focus')
  })
})

describe('veteran session — answer scoring', () => {
  function makeVeteranSession(words: VocabEntry[]): Session {
    return makeSession({
      type: 'veteran',
      words: words.map((e) => ({ vocabId: e.id, status: 'pending' as const })),
    })
  }

  it('schedules next veteran session after completion', () => {
    const entry = makeEntry({ bucket: 6, difficulty: 2, source: 'Hund', target: ['dog'] })

    vocabRepo.insert(entry)
    creditsRepo.setVeteranSessionDueAt('2026-01-01')

    const sess = makeVeteranSession([entry])

    sessionRepo.insert(sess)

    service.submitAnswer(sess.id, entry.id, ['dog'])

    const newDueAt = creditsRepo.getVeteranSessionDueAt()

    expect(newDueAt).not.toBeNull()

    if (newDueAt !== null) {
      // Next due at is at least 6 days after today
      expect(newDueAt > '2026-03-27').toBe(true)
    }
  })
})

// ── breakthrough session ──────────────────────────────────────────────────────

describe('breakthrough session — createSession', () => {
  function makeBreakthroughPool(): VocabEntry[] {
    return Array.from({ length: MIN_SESSION_SIZE }, (_, i) =>
      makeEntry({ bucket: 3, source: `Wort${i}`, target: [`word${i}`] }),
    )
  }

  it('creates a breakthrough session when all conditions are met', () => {
    creditsRepo.setBreakthroughSessionDueAt('2026-01-01')
    creditsRepo.setStressSessionDueAt('9999-12-31')

    for (const e of makeBreakthroughPool()) {
      vocabRepo.insert(e)
    }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12 })

    expect(session.type).toBe('breakthrough')
  })

  it('does not create a breakthrough session when due date is in the future', () => {
    creditsRepo.setBreakthroughSessionDueAt('9999-12-31')

    for (const e of makeBreakthroughPool()) {
      vocabRepo.insert(e)
    }

    // Add normal words so createSession doesn't throw
    for (let i = 0; i < 10; i++) {
      vocabRepo.insert(makeEntry({ bucket: 0 }))
    }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12 })

    expect(session.type).not.toBe('breakthrough')
  })

  it('does not create a breakthrough session when pool is below minimum', () => {
    creditsRepo.setBreakthroughSessionDueAt('2026-01-01')

    // Only 4 qualifying words — below BREAKTHROUGH_MIN_WORDS (MIN_SESSION_SIZE)
    for (let i = 0; i < 4; i++) {
      vocabRepo.insert(makeEntry({ bucket: 3, source: `Wort${i}`, target: [`word${i}`] }))
    }

    for (let i = 0; i < 10; i++) {
      vocabRepo.insert(makeEntry({ bucket: 0 }))
    }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12 })

    expect(session.type).not.toBe('breakthrough')
  })

  it('schedules the first breakthrough session when qualifying words first reach minimum', () => {
    for (const e of makeBreakthroughPool()) {
      vocabRepo.insert(e)
    }

    service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12 })

    expect(creditsRepo.getBreakthroughSessionDueAt()).not.toBeNull()
  })

  it('does not overwrite an already-scheduled breakthrough due date on createSession', () => {
    creditsRepo.setBreakthroughSessionDueAt('2026-05-01')

    for (const e of makeBreakthroughPool()) {
      vocabRepo.insert(e)
    }

    service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12 })

    expect(creditsRepo.getBreakthroughSessionDueAt()).toBe('2026-05-01')
  })
})

describe('breakthrough session — answer scoring', () => {
  function makeBreakthroughSession(words: VocabEntry[]): Session {
    return makeSession({
      type: 'breakthrough',
      words: words.map((e) => ({ vocabId: e.id, status: 'pending' as const })),
    })
  }

  it('schedules next breakthrough session after completion', () => {
    const entry = makeEntry({ bucket: 3, source: 'Hund', target: ['dog'] })

    vocabRepo.insert(entry)
    creditsRepo.setBreakthroughSessionDueAt('2026-01-01')

    const sess = makeBreakthroughSession([entry])

    sessionRepo.insert(sess)

    service.submitAnswer(sess.id, entry.id, ['dog'])

    const newDueAt = creditsRepo.getBreakthroughSessionDueAt()

    expect(newDueAt).not.toBeNull()

    if (newDueAt !== null) {
      // Next due at is at least 6 days after today
      expect(newDueAt > '2026-03-27').toBe(true)
    }
  })
})

// ── createReplaySession ───────────────────────────────────────────────────────

describe('createReplaySession', () => {
  it('throws ApiError 404 when the original session is not found', () => {
    expectApiError(() => service.createReplaySession('nonexistent'), 404)
  })

  it('throws ApiError 400 when the original session is not a replayable type', () => {
    const session = makeSession({ type: 'normal', status: 'completed' })

    sessionRepo.insert(session)

    expectApiError(() => service.createReplaySession(session.id), 400)
  })

  it('throws ApiError 409 when a session is already open', () => {
    const original = makeSession({ type: 'focus', status: 'completed' })
    const open = makeSession({ type: 'normal', status: 'open' })

    sessionRepo.insert(original)
    sessionRepo.insert(open)

    expectApiError(() => service.createReplaySession(original.id), 409)
  })

  it('creates a new focus session with status open', () => {
    const entry = makeEntry()
    const original = makeSession({
      type: 'focus',
      status: 'completed',
      words: [{ vocabId: entry.id, status: 'incorrect' }],
    })

    vocabRepo.insert(entry)
    sessionRepo.insert(original)

    const replay = service.createReplaySession(original.id)

    expect(replay.type).toBe('focus')
    expect(replay.status).toBe('open')
  })

  it('contains the same vocab IDs as the original (original words only)', () => {
    const e1 = makeEntry()
    const e2 = makeEntry()
    const e3 = makeEntry()
    const original = makeSession({
      type: 'focus',
      status: 'completed',
      words: [
        { vocabId: e1.id, status: 'incorrect' },
        { vocabId: e2.id, status: 'correct' },
        // second-chance word — must be excluded
        { vocabId: e3.id, status: 'correct', secondChanceFor: e2.id },
      ],
    })

    sessionRepo.insert(original)

    const replay = service.createReplaySession(original.id)

    const replayIds = replay.words.map((w) => w.vocabId)

    expect(replayIds).toHaveLength(2)
    expect(replayIds).toContain(e1.id)
    expect(replayIds).toContain(e2.id)
    expect(replayIds).not.toContain(e3.id)
  })

  it('all words in the replay session start as pending', () => {
    const entry = makeEntry()
    const original = makeSession({
      type: 'focus',
      status: 'completed',
      words: [{ vocabId: entry.id, status: 'incorrect' }],
    })

    sessionRepo.insert(original)

    const replay = service.createReplaySession(original.id)

    expect(replay.words.every((w) => w.status === 'pending')).toBe(true)
  })

  it('preserves the direction from the original session', () => {
    const entry = makeEntry()
    const original = makeSession({
      type: 'focus',
      status: 'completed',
      direction: 'TARGET_TO_SOURCE',
      words: [{ vocabId: entry.id, status: 'correct' }],
    })

    sessionRepo.insert(original)

    const replay = service.createReplaySession(original.id)

    expect(replay.direction).toBe('TARGET_TO_SOURCE')
  })

  it('assigns a new unique id to the replay session', () => {
    const entry = makeEntry()
    const original = makeSession({
      type: 'focus',
      status: 'completed',
      words: [{ vocabId: entry.id, status: 'correct' }],
    })

    sessionRepo.insert(original)

    const replay = service.createReplaySession(original.id)

    expect(replay.id).not.toBe(original.id)
  })

  it('persists the replay session so getOpenSession returns it', () => {
    const entry = makeEntry()
    const original = makeSession({
      type: 'focus',
      status: 'completed',
      words: [{ vocabId: entry.id, status: 'correct' }],
    })

    sessionRepo.insert(original)
    service.createReplaySession(original.id)

    expect(service.getOpenSession()).toBeDefined()
  })

  it('creates a starred replay with type "starred"', () => {
    const entry = makeEntry()
    const original = makeSession({
      type: 'starred',
      status: 'completed',
      words: [{ vocabId: entry.id, status: 'incorrect' }],
    })

    sessionRepo.insert(original)

    const replay = service.createReplaySession(original.id)

    expect(replay.type).toBe('starred')
    expect(replay.status).toBe('open')
  })

  it('starred replay contains the same vocab IDs (second-chance words excluded)', () => {
    const e1 = makeEntry()
    const e2 = makeEntry()
    const e3 = makeEntry()
    const original = makeSession({
      type: 'starred',
      status: 'completed',
      words: [
        { vocabId: e1.id, status: 'incorrect' },
        { vocabId: e2.id, status: 'correct' },
        { vocabId: e3.id, status: 'correct', secondChanceFor: e2.id },
      ],
    })

    sessionRepo.insert(original)

    const replay = service.createReplaySession(original.id)
    const replayIds = replay.words.map((w) => w.vocabId)

    expect(replayIds).toHaveLength(2)
    expect(replayIds).toContain(e1.id)
    expect(replayIds).toContain(e2.id)
    expect(replayIds).not.toContain(e3.id)
  })
})

// ── createSession — second_chance_session ─────────────────────────────────────

describe('createSession — second_chance_session', () => {
  const PAST = '2020-01-01T00:00:00.000Z'

  it('creates a second_chance_session when due words exist and no session played today', () => {
    vocabRepo.insert(makeEntry({ bucket: 5, secondChanceDueAt: PAST }))

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 24 })

    expect(session.type).toBe('second_chance_session')
  })

  it('does not create a second_chance_session when no words are due', () => {
    // Only regular words, no secondChanceDueAt
    for (let i = 0; i < 5; i++) {
      vocabRepo.insert(makeEntry({ bucket: 0 }))
    }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 1 })

    expect(session.type).not.toBe('second_chance_session')
  })

  it('does not create a second_chance_session if one was already played today', () => {
    const today = new Date().toISOString().slice(0, 10)

    creditsRepo.setLastSecondChanceSessionDate(today)
    vocabRepo.insert(makeEntry({ bucket: 5, secondChanceDueAt: PAST }))
    // Also add regular vocab so a normal session is possible
    for (let i = 0; i < 5; i++) {
      vocabRepo.insert(makeEntry({ bucket: 0 }))
    }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 1 })

    expect(session.type).not.toBe('second_chance_session')
  })

  it('includes only due second-chance words in the session', () => {
    const dueWord = makeEntry({ id: 'due', bucket: 4, secondChanceDueAt: PAST })
    const futureWord = makeEntry({ id: 'future', bucket: 4, secondChanceDueAt: '2099-01-01T00:00:00Z' })

    vocabRepo.insert(dueWord)
    vocabRepo.insert(futureWord)

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 24 })

    expect(session.type).toBe('second_chance_session')
    expect(session.words.map((w) => w.vocabId)).toContain('due')
    expect(session.words.map((w) => w.vocabId)).not.toContain('future')
  })
})

// ── submitAnswer — second_chance_session ──────────────────────────────────────

describe('submitAnswer — second_chance_session', () => {
  const PAST = '2020-01-01T00:00:00.000Z'

  it('correct answer clears secondChanceDueAt and preserves bucket', () => {
    const entry = makeEntry({ id: 'e1', bucket: 6, secondChanceDueAt: PAST, target: ['word'] })
    const session = makeSession({
      type: 'second_chance_session',
      words: [{ vocabId: entry.id, status: 'pending' }],
    })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    const updated = vocabRepo.findById(entry.id)

    expect(updated?.secondChanceDueAt).toBeNull()
    expect(updated?.bucket).toBe(6)
  })

  it('incorrect answer sets bucket = 1 and clears secondChanceDueAt', () => {
    const entry = makeEntry({ id: 'e1', bucket: 6, secondChanceDueAt: PAST, target: ['word'] })
    const session = makeSession({
      type: 'second_chance_session',
      words: [{ vocabId: entry.id, status: 'pending' }],
    })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['wrong'])

    const updated = vocabRepo.findById(entry.id)

    expect(updated?.bucket).toBe(1)
    expect(updated?.secondChanceDueAt).toBeNull()
  })

  it('calls scheduleCompletion when session is completed', () => {
    const entry = makeEntry({ id: 'e1', bucket: 5, secondChanceDueAt: PAST, target: ['word'] })
    const session = makeSession({
      type: 'second_chance_session',
      words: [{ vocabId: entry.id, status: 'pending' }],
    })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    service.submitAnswer(session.id, entry.id, ['word'])

    const today = new Date().toISOString().slice(0, 10)

    expect(creditsRepo.getLastSecondChanceSessionDate()).toBe(today)
  })

  it('does not trigger a second-chance word for wrong answers (no W2 appended)', () => {
    const entry = makeEntry({ id: 'e1', bucket: 6, secondChanceDueAt: PAST, target: ['word'] })
    // Add a second word the service could pick as W2
    const other = makeEntry({ id: 'other', bucket: 6, target: ['other'] })
    const session = makeSession({
      type: 'second_chance_session',
      words: [{ vocabId: entry.id, status: 'pending' }],
    })

    vocabRepo.insert(entry)
    vocabRepo.insert(other)
    sessionRepo.insert(session)

    const result = service.submitAnswer(session.id, entry.id, ['wrong'])

    const hasSecondChanceWord = result.session.words.some((w) => w.secondChanceFor !== undefined)

    expect(hasSecondChanceWord).toBe(false)
  })
})

// ── recovery session ──────────────────────────────────────────────────────────

describe('recovery session — createSession', () => {
  function makeRecoveryPool(count = RECOVERY_MIN_WORDS): VocabEntry[] {
    return Array.from({ length: count }, (_, i) =>
      makeEntry({ bucket: 2, maxBucket: 6, source: `Wort${i}`, target: [`word${i}`] }),
    )
  }

  it('creates a recovery session when qualifying words meet the minimum', () => {
    // Prevent breakthrough from firing (bucket-2 entries qualify as cat3)
    creditsRepo.setBreakthroughSessionDueAt('9999-12-31')

    for (const e of makeRecoveryPool()) {
      vocabRepo.insert(e)
    }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12 })

    expect(session.type).toBe('recovery')
  })

  it('does not create a recovery session when fewer than minWords qualify', () => {
    creditsRepo.setBreakthroughSessionDueAt('9999-12-31')

    // 4 qualifying words — one below RECOVERY_MIN_WORDS
    for (const e of makeRecoveryPool(RECOVERY_MIN_WORDS - 1)) {
      vocabRepo.insert(e)
    }

    // Add normal words to ensure a session can still be created
    for (let i = 0; i < 10; i++) {
      vocabRepo.insert(makeEntry({ bucket: 0 }))
    }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12 })

    expect(session.type).not.toBe('recovery')
  })

  it('does not include words with maxBucket < 6 in a recovery session', () => {
    // Prevent breakthrough from firing
    creditsRepo.setBreakthroughSessionDueAt('9999-12-31')

    // Only words with maxBucket 5 — should not qualify
    for (let i = 0; i < 10; i++) {
      vocabRepo.insert(makeEntry({ bucket: 1, maxBucket: 5 }))
    }

    // Add enough qualifying words to trigger recovery
    for (const e of makeRecoveryPool()) {
      vocabRepo.insert(e)
    }

    const session = service.createSession({ direction: 'SOURCE_TO_TARGET', size: 12 })

    expect(session.type).toBe('recovery')

    const allEntries = vocabRepo.findAll()
    const nonQualifyingIds = new Set(allEntries.filter((e) => e.maxBucket < 6).map((e) => e.id))
    const sessionVocabIds = session.words.map((w) => w.vocabId)

    expect(sessionVocabIds.every((id) => !nonQualifyingIds.has(id))).toBe(true)
  })
})

// ── createSession — focus quiz session ────────────────────────────────────────

describe('createSession — focus quiz session', () => {
  function makeHighScoreEntry(overrides: Partial<VocabEntry> = {}): VocabEntry {
    return makeEntry({ bucket: 1, score: 2, ...overrides })
  }

  /** Creates a service whose shuffle always puts focus_quiz first. */
  function makeFocusQuizFirstService() {
    return new SessionService(
      sessionRepo, vocabRepo, creditsRepo,
      new StressSessionService(creditsRepo),
      new VeteranSessionService(creditsRepo),
      new BreakthroughSessionService(creditsRepo),
      new SecondChanceSessionService(creditsRepo),
      (types) => ['focus_quiz' as const, ...types.filter((t) => t !== 'focus_quiz')],
    )
  }

  it(`creates a "focus_quiz" session when ${FOCUS_QUIZ_MIN_WORDS}+ qualifying words exist`, () => {
    const svc = makeFocusQuizFirstService()

    for (let i = 0; i < FOCUS_QUIZ_MIN_WORDS; i++) {
      vocabRepo.insert(makeHighScoreEntry())
    }

    const session = svc.createSession({ direction: 'SOURCE_TO_TARGET', size: 10 })

    expect(session.type).toBe('focus_quiz')
  })

  it(`does not create a "focus_quiz" session when fewer than ${FOCUS_QUIZ_MIN_WORDS} qualifying words exist`, () => {
    const svc = makeFocusQuizFirstService()

    for (let i = 0; i < FOCUS_QUIZ_MIN_WORDS - 1; i++) {
      vocabRepo.insert(makeHighScoreEntry())
    }

    // Add enough bucket-0 words so normal session can proceed
    for (let i = 0; i < 5; i++) {
      vocabRepo.insert(makeEntry({ bucket: 0 }))
    }

    const session = svc.createSession({ direction: 'SOURCE_TO_TARGET', size: 10 })

    expect(session.type).not.toBe('focus_quiz')
  })

  it(`targets ${FOCUS_QUIZ_SESSION_SIZE} words`, () => {
    const svc = makeFocusQuizFirstService()

    for (let i = 0; i < FOCUS_QUIZ_SESSION_SIZE + 5; i++) {
      vocabRepo.insert(makeHighScoreEntry())
    }

    const session = svc.createSession({ direction: 'SOURCE_TO_TARGET', size: 10 })

    expect(session.type).toBe('focus_quiz')
    expect(session.words).toHaveLength(FOCUS_QUIZ_SESSION_SIZE)
  })

  it('earns +1 credit (not +5) for a word reaching a new highest bucket in a focus_quiz session', () => {
    const svc = makeFocusQuizFirstService()

    for (let i = 0; i < FOCUS_QUIZ_MIN_WORDS; i++) {
      vocabRepo.insert(makeHighScoreEntry())
    }

    const session = svc.createSession({ direction: 'SOURCE_TO_TARGET', size: 10 })

    expect(session.type).toBe('focus_quiz')

    expect(session.words.length).toBeGreaterThan(0)

    const vocabId = session.words[0]?.vocabId ?? ''
    const entry = vocabRepo.findById(vocabId)

    expect(entry).toBeDefined()

    const safeEntry = entry ?? makeHighScoreEntry()

    // Ensure promoting to a new max bucket
    vocabRepo.update({ ...safeEntry, bucket: 3, maxBucket: 3 })

    const result = svc.submitAnswer(session.id, vocabId, safeEntry.target)

    expect(result.creditsEarned).toBe(1)
  })

  it('can be replayed via createReplaySession', () => {
    const entry = makeEntry({ bucket: 1, score: 2 })
    const original = makeSession({
      type: 'focus_quiz',
      status: 'completed',
      words: [{ vocabId: entry.id, status: 'incorrect' }],
    })

    vocabRepo.insert(entry)
    sessionRepo.insert(original)

    const replay = service.createReplaySession(original.id)

    expect(replay.type).toBe('focus_quiz')
    expect(replay.status).toBe('open')
  })
})
