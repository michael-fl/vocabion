// @vitest-environment node

/**
 * Integration tests for the session router.
 *
 * Uses a real SessionService backed by FakeSessionRepository + FakeVocabRepository
 * — no SQLite. Tests HTTP behaviour: status codes, response shapes, validation errors.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import supertest from 'supertest'

import { createSessionRouter } from './sessionRouter.ts'
import { SessionService } from './sessionService.ts'
import { StressSessionService } from './stressSessionService.ts'
import { VeteranSessionService } from './veteranSessionService.ts'
import { BreakthroughSessionService } from './breakthroughSessionService.ts'
import { SecondChanceSessionService } from './secondChanceSessionService.ts'
import { FakeSessionRepository } from '../../test-utils/FakeSessionRepository.ts'
import { FakeVocabRepository } from '../../test-utils/FakeVocabRepository.ts'
import { FakeCreditsRepository } from '../../test-utils/FakeCreditsRepository.ts'
import { errorHandler } from '../../middleware/errorHandler.ts'
import type { VocabEntry } from '../../../shared/types/VocabEntry.ts'
import type { Session } from '../../../shared/types/Session.ts'
import type { AnswerResult } from './sessionService.ts'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTestApp() {
  const sessionRepo = new FakeSessionRepository()
  const vocabRepo = new FakeVocabRepository()
  const creditsRepo = new FakeCreditsRepository()
  const service = new SessionService(sessionRepo, vocabRepo, creditsRepo, new StressSessionService(creditsRepo), new VeteranSessionService(creditsRepo), new BreakthroughSessionService(creditsRepo), new SecondChanceSessionService(creditsRepo))
  const app = express()

  app.use(express.json())
  app.use('/', createSessionRouter(service))
  app.use(errorHandler)

  return { app, sessionRepo, vocabRepo, service }
}

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

beforeEach(() => {
  idCounter = 0
})

// ── GET /open ─────────────────────────────────────────────────────────────────

describe('GET /open', () => {
  it('returns 200 with session: null when no session is open', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app).get('/open')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ session: null })
  })

  it('returns the open session', async () => {
    const { app, sessionRepo } = makeTestApp()
    const session = makeSession()

    sessionRepo.insert(session)

    const res = await supertest(app).get('/open')

    expect(res.status).toBe(200)
    expect((res.body as { session: Session }).session.id).toBe(session.id)
  })
})

// ── POST / ────────────────────────────────────────────────────────────────────

describe('POST /', () => {
  it('returns 201 with the created session', async () => {
    const { app, vocabRepo } = makeTestApp()

    vocabRepo.insert(makeEntry())

    const res = await supertest(app)
      .post('/')
      .send({ direction: 'SOURCE_TO_TARGET', size: 1 })

    const body = res.body as Session

    expect(res.status).toBe(201)
    expect(body.direction).toBe('SOURCE_TO_TARGET')
    expect(body.status).toBe('open')
  })

  it('uses defaults when body is empty', async () => {
    const { app, vocabRepo } = makeTestApp()

    vocabRepo.insert(makeEntry())

    const res = await supertest(app).post('/').send({})

    expect(res.status).toBe(201)
    expect((res.body as Session).direction).toBe('SOURCE_TO_TARGET')
  })

  it('returns 409 when a session is already open', async () => {
    const { app, sessionRepo } = makeTestApp()

    sessionRepo.insert(makeSession())

    const res = await supertest(app).post('/').send({ direction: 'SOURCE_TO_TARGET', size: 10 })

    expect(res.status).toBe(409)
  })

  it('returns 400 for an invalid direction', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/')
      .send({ direction: 'FR_TO_EN', size: 10 })

    expect(res.status).toBe(400)
  })

  it('returns 400 when size is 0', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app).post('/').send({ direction: 'SOURCE_TO_TARGET', size: 0 })

    expect(res.status).toBe(400)
  })
})

// ── POST /:id/answer ──────────────────────────────────────────────────────────

describe('POST /:id/answer', () => {
  it('returns 200 with an answer result on a correct answer', async () => {
    const { app, sessionRepo, vocabRepo } = makeTestApp()
    const entry = makeEntry({ target: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const res = await supertest(app)
      .post(`/${session.id}/answer`)
      .send({ vocabId: entry.id, answers: ['word'] })

    const body = res.body as AnswerResult

    expect(res.status).toBe(200)
    expect(body.correct).toBe(true)
    expect(body.outcome).toBe('correct')
    expect(typeof body.sessionCompleted).toBe('boolean')
  })

  it('returns 200 with correct: false for a wrong answer', async () => {
    const { app, sessionRepo, vocabRepo } = makeTestApp()
    const entry = makeEntry({ target: ['word'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const res = await supertest(app)
      .post(`/${session.id}/answer`)
      .send({ vocabId: entry.id, answers: ['wrong'] })

    expect(res.status).toBe(200)
    expect((res.body as AnswerResult).correct).toBe(false)
  })

  it('returns 404 for an unknown session id', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/no-such-session/answer')
      .send({ vocabId: 'w1', answers: ['word'] })

    expect(res.status).toBe(404)
  })

  it('returns 400 when answers is missing', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/session-1/answer')
      .send({ vocabId: 'w1' })

    expect(res.status).toBe(400)
  })

  it('returns 400 when vocabId is missing', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/session-1/answer')
      .send({ answers: ['word'] })

    expect(res.status).toBe(400)
  })
})

// ── POST /:id/words/:vocabId/correct ─────────────────────────────────────────

describe('POST /:id/words/:vocabId/correct', () => {
  it('returns 200 with the updated session on success', async () => {
    const { app, sessionRepo, vocabRepo } = makeTestApp()

    const entry = makeEntry({ target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'incorrect' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const res = await supertest(app)
      .post(`/${session.id}/words/${entry.id}/correct`)

    expect(res.status).toBe(200)
    expect((res.body as Session).words[0].status).toBe('correct')
  })

  it('returns 404 when session does not exist', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/no-such-session/words/any-vocab/correct')

    expect(res.status).toBe(404)
  })

  it('returns 400 when word is not in incorrect status', async () => {
    const { app, sessionRepo, vocabRepo } = makeTestApp()

    const entry = makeEntry({ target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'correct' }] })

    vocabRepo.insert(entry)
    sessionRepo.insert(session)

    const res = await supertest(app)
      .post(`/${session.id}/words/${entry.id}/correct`)

    expect(res.status).toBe(400)
  })
})
