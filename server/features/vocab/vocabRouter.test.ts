// @vitest-environment node

/**
 * Integration tests for the vocab router.
 *
 * Uses a real VocabService backed by FakeVocabRepository — no SQLite.
 * Tests HTTP behaviour: status codes, response shapes, validation errors.
 */

import { describe, it, expect } from 'vitest'
import express from 'express'
import supertest from 'supertest'

import { createVocabRouter } from './vocabRouter.ts'
import { VocabService } from './vocabService.ts'
import { FakeVocabRepository } from '../../test-utils/FakeVocabRepository.ts'
import { FakeSessionRepository } from '../../test-utils/FakeSessionRepository.ts'
import { FakeCreditsRepository } from '../../test-utils/FakeCreditsRepository.ts'
import { errorHandler } from '../../middleware/errorHandler.ts'
import type { VocabEntry } from '../../../shared/types/VocabEntry.ts'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTestApp() {
  const repo = new FakeVocabRepository()
  const sessionRepo = new FakeSessionRepository()
  const creditsRepo = new FakeCreditsRepository()
  const service = new VocabService(repo, sessionRepo, creditsRepo)
  const app = express()

  app.use(express.json())
  app.use('/', createVocabRouter(service))
  app.use(errorHandler)

  return { app, repo, sessionRepo, creditsRepo, service }
}

function seedEntry(repo: FakeVocabRepository, overrides: Partial<VocabEntry> = {}): VocabEntry {
  const entry: VocabEntry = {
    id: crypto.randomUUID(),
    de: ['Tisch'],
    en: ['table'],
    bucket: 0,
    maxBucket: 0,
    manuallyAdded: false,
    marked: false,
    score: 0,
    lastAskedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }

  repo.insert(entry)

  return entry
}

// ── GET / ─────────────────────────────────────────────────────────────────────

describe('GET /', () => {
  it('returns 200 with an empty array when no entries exist', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app).get('/')

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns all entries', async () => {
    const { app, repo } = makeTestApp()

    seedEntry(repo)
    seedEntry(repo)

    const res = await supertest(app).get('/')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
  })
})

// ── POST / ────────────────────────────────────────────────────────────────────

describe('POST /', () => {
  it('returns 201 with the created entry', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app).post('/').send({ de: ['Hund'], en: ['dog'] })

    const body = res.body as VocabEntry

    expect(res.status).toBe(201)
    expect(body.de).toEqual(['Hund'])
    expect(body.en).toEqual(['dog'])
    expect(typeof body.id).toBe('string')
  })

  it('returns 400 when de is missing', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app).post('/').send({ en: ['dog'] })

    expect(res.status).toBe(400)
    expect((res.body as { error: string }).error).toBe('Validation failed')
  })

  it('returns 400 when en is an empty array', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app).post('/').send({ de: ['Hund'], en: [] })

    expect(res.status).toBe(400)
  })
})

// ── PUT /:id ──────────────────────────────────────────────────────────────────

describe('PUT /:id', () => {
  it('returns 200 with the updated entry', async () => {
    const { app, repo } = makeTestApp()
    const entry = seedEntry(repo)

    const res = await supertest(app)
      .put(`/${entry.id}`)
      .send({ de: ['Stuhl'], en: ['chair'] })

    const body = res.body as VocabEntry

    expect(res.status).toBe(200)
    expect(body.de).toEqual(['Stuhl'])
    expect(body.en).toEqual(['chair'])
  })

  it('returns 404 for an unknown id', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .put('/no-such-id')
      .send({ de: ['Stuhl'], en: ['chair'] })

    expect(res.status).toBe(404)
  })

  it('returns 400 when body is invalid', async () => {
    const { app, repo } = makeTestApp()
    const entry = seedEntry(repo)

    const res = await supertest(app).put(`/${entry.id}`).send({ de: 'not-an-array' })

    expect(res.status).toBe(400)
  })
})

// ── DELETE /:id ───────────────────────────────────────────────────────────────

describe('DELETE /:id', () => {
  it('returns 204 on success', async () => {
    const { app, repo } = makeTestApp()
    const entry = seedEntry(repo)

    const res = await supertest(app).delete(`/${entry.id}`)

    expect(res.status).toBe(204)
  })

  it('returns 404 for an unknown id', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app).delete('/no-such-id')

    expect(res.status).toBe(404)
  })
})

// ── GET /export ───────────────────────────────────────────────────────────────

describe('GET /export', () => {
  it('returns 200 with export format', async () => {
    const { app, repo } = makeTestApp()

    seedEntry(repo, { bucket: 2 })

    const res = await supertest(app).get('/export')

    const body = res.body as { version: number; exportedAt: string; entries: { de: string[]; en: string[]; bucket: number }[] }

    expect(res.status).toBe(200)
    expect(body.version).toBe(1)
    expect(typeof body.exportedAt).toBe('string')
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0]).toEqual({ de: ['Tisch'], en: ['table'], bucket: 2 })
  })
})

// ── POST /import ──────────────────────────────────────────────────────────────

describe('POST /import', () => {
  it('returns 200 with the count of imported entries', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/import')
      .send({
        version: 1,
        exportedAt: '2026-01-01T00:00:00Z',
        entries: [
          { de: ['Tisch'], en: ['table'], bucket: 0 },
          { de: ['Hund'], en: ['dog'], bucket: 1 },
        ],
      })

    expect(res.status).toBe(200)
    expect((res.body as { imported: number }).imported).toBe(2)
  })

  it('returns 400 when version is wrong', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/import')
      .send({ version: 2, exportedAt: '2026-01-01T00:00:00Z', entries: [] })

    expect(res.status).toBe(400)
  })

  it('returns 400 when entries is missing', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/import')
      .send({ version: 1, exportedAt: '2026-01-01T00:00:00Z' })

    expect(res.status).toBe(400)
  })
})

// ── POST /add-or-merge ────────────────────────────────────────────────────────

describe('POST /add-or-merge', () => {
  it('returns 200 with merged=false when a new entry is created', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/add-or-merge')
      .send({ de: ['Auto'], en: ['car'] })

    const body = res.body as { merged: boolean; entry: VocabEntry }

    expect(res.status).toBe(200)
    expect(body.merged).toBe(false)
    expect(body.entry.de).toEqual(['Auto'])
    expect(body.entry.en).toEqual(['car'])
  })

  it('returns 200 with merged=true when merged into an existing entry', async () => {
    const { app, repo } = makeTestApp()

    seedEntry(repo, { de: ['Auto'], en: ['car'] })

    const res = await supertest(app)
      .post('/add-or-merge')
      .send({ de: ['Auto', 'Automobil'], en: ['car', 'automobile'] })

    const body = res.body as { merged: boolean; entry: VocabEntry }

    expect(res.status).toBe(200)
    expect(body.merged).toBe(true)
    expect(body.entry.de).toContain('Automobil')
    expect(body.entry.en).toContain('automobile')
  })

  it('returns 400 when de is missing', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/add-or-merge')
      .send({ en: ['car'] })

    expect(res.status).toBe(400)
  })
})

// ── GET /credits ──────────────────────────────────────────────────────────────

describe('GET /credits', () => {
  it('returns 200 with credits=0 when no entries exist', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app).get('/credits')

    expect(res.status).toBe(200)
    expect((res.body as { credits: number }).credits).toBe(0)
  })

  it('returns the current balance from the credits repository', async () => {
    const { app, creditsRepo } = makeTestApp()

    creditsRepo.addBalance(3)

    const res = await supertest(app).get('/credits')

    expect(res.status).toBe(200)
    expect((res.body as { credits: number }).credits).toBe(3)
  })
})

// ── POST /:id/set-bucket ──────────────────────────────────────────────────────

describe('POST /:id/set-bucket', () => {
  it('returns 200 with the updated entry', async () => {
    const { app, repo } = makeTestApp()
    const entry = seedEntry(repo, { bucket: 0 })

    const res = await supertest(app)
      .post(`/${entry.id}/set-bucket`)
      .send({ bucket: 4 })

    const body = res.body as VocabEntry

    expect(res.status).toBe(200)
    expect(body.bucket).toBe(4)
    expect(body.id).toBe(entry.id)
  })

  it('returns 404 when the entry does not exist', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/no-such-id/set-bucket')
      .send({ bucket: 1 })

    expect(res.status).toBe(404)
  })

  it('returns 400 when bucket is missing', async () => {
    const { app, repo } = makeTestApp()
    const entry = seedEntry(repo)

    const res = await supertest(app)
      .post(`/${entry.id}/set-bucket`)
      .send({})

    expect(res.status).toBe(400)
  })

  it('returns 400 when bucket is negative', async () => {
    const { app, repo } = makeTestApp()
    const entry = seedEntry(repo)

    const res = await supertest(app)
      .post(`/${entry.id}/set-bucket`)
      .send({ bucket: -1 })

    expect(res.status).toBe(400)
  })
})

// ── POST /credits/spend ───────────────────────────────────────────────────────

describe('POST /credits/spend', () => {
  it('returns 200 with the new balance after spending', async () => {
    const { app, creditsRepo } = makeTestApp()

    creditsRepo.addBalance(20)

    const res = await supertest(app)
      .post('/credits/spend')
      .send({ amount: 10 })

    expect(res.status).toBe(200)
    expect((res.body as { credits: number }).credits).toBe(10)
  })

  it('returns 402 when balance is insufficient', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/credits/spend')
      .send({ amount: 10 })

    expect(res.status).toBe(402)
  })

  it('returns 400 when amount is missing', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/credits/spend')
      .send({})

    expect(res.status).toBe(400)
  })

  it('returns 400 when amount is zero', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/credits/spend')
      .send({ amount: 0 })

    expect(res.status).toBe(400)
  })

  it('returns 400 when amount is negative', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/credits/spend')
      .send({ amount: -5 })

    expect(res.status).toBe(400)
  })
})

// ── POST /credits/refund ──────────────────────────────────────────────────────

describe('POST /credits/refund', () => {
  it('returns 200 with the new balance after refunding', async () => {
    const { app, creditsRepo } = makeTestApp()

    creditsRepo.addBalance(5)

    const res = await supertest(app)
      .post('/credits/refund')
      .send({ amount: 3 })

    expect(res.status).toBe(200)
    expect((res.body as { credits: number }).credits).toBe(8)
  })

  it('returns 200 when refunding to a zero balance', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/credits/refund')
      .send({ amount: 1 })

    expect(res.status).toBe(200)
    expect((res.body as { credits: number }).credits).toBe(1)
  })

  it('returns 400 when amount is missing', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/credits/refund')
      .send({})

    expect(res.status).toBe(400)
  })

  it('returns 400 when amount is zero', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/credits/refund')
      .send({ amount: 0 })

    expect(res.status).toBe(400)
  })

  it('returns 400 when amount is negative', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/credits/refund')
      .send({ amount: -1 })

    expect(res.status).toBe(400)
  })
})

// ── POST /:id/set-marked ──────────────────────────────────────────────────────

describe('POST /:id/set-marked', () => {
  it('returns 200 with the updated entry when marking', async () => {
    const { app, repo } = makeTestApp()
    const entry = seedEntry(repo, { marked: false })

    const res = await supertest(app)
      .post(`/${entry.id}/set-marked`)
      .send({ marked: true })

    expect(res.status).toBe(200)
    expect((res.body as VocabEntry).marked).toBe(true)
  })

  it('returns 200 with the updated entry when unmarking', async () => {
    const { app, repo } = makeTestApp()
    const entry = seedEntry(repo, { marked: true })

    const res = await supertest(app)
      .post(`/${entry.id}/set-marked`)
      .send({ marked: false })

    expect(res.status).toBe(200)
    expect((res.body as VocabEntry).marked).toBe(false)
  })

  it('returns 404 when entry is not found', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/no-such-id/set-marked')
      .send({ marked: true })

    expect(res.status).toBe(404)
  })

  it('returns 400 when marked field is missing', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/any-id/set-marked')
      .send({})

    expect(res.status).toBe(400)
  })

  it('returns 400 when marked is not a boolean', async () => {
    const { app } = makeTestApp()

    const res = await supertest(app)
      .post('/any-id/set-marked')
      .send({ marked: 'yes' })

    expect(res.status).toBe(400)
  })
})
