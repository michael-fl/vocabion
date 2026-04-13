// @vitest-environment node

/**
 * Integration tests for the streak router.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

import { createApp } from '../../app.ts'
import { FakeVocabRepository } from '../../test-utils/FakeVocabRepository.ts'
import { FakeSessionRepository } from '../../test-utils/FakeSessionRepository.ts'
import { FakeCreditsRepository } from '../../test-utils/FakeCreditsRepository.ts'
import { VocabService } from '../vocab/vocabService.ts'
import { SessionService } from '../session/sessionService.ts'
import { StressSessionService } from '../session/stressSessionService.ts'
import { VeteranSessionService } from '../session/veteranSessionService.ts'
import { BreakthroughSessionService } from '../session/breakthroughSessionService.ts'
import { SecondChanceSessionService } from '../session/secondChanceSessionService.ts'
import { StreakService } from './StreakService.ts'
import type { StreakInfo } from './StreakService.ts'
import type { Session } from '../../../shared/types/Session.ts'

function makeApp() {
  const vocabRepo = new FakeVocabRepository()
  const sessionRepo = new FakeSessionRepository()
  const creditsRepo = new FakeCreditsRepository()
  const vocabService = new VocabService(vocabRepo, sessionRepo, creditsRepo)
  const sessionService = new SessionService(sessionRepo, vocabRepo, creditsRepo, new StressSessionService(creditsRepo), new VeteranSessionService(creditsRepo), new BreakthroughSessionService(creditsRepo), new SecondChanceSessionService(creditsRepo))
  const streakService = new StreakService(creditsRepo)

  return { app: createApp({ vocab: vocabService, session: sessionService, streak: streakService }), creditsRepo, sessionRepo }
}

// ── GET /api/v1/streak ────────────────────────────────────────────────────────

describe('GET /api/v1/streak', () => {
  it('returns count 0 and saveAvailable false for a fresh database', async () => {
    const { app } = makeApp()

    const res = await request(app).get('/api/v1/streak')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ count: 0, saveAvailable: false, lastSessionDate: null, nextMilestone: null })
  })

  it('returns saveAvailable true when last session was exactly two days ago', async () => {
    const { app, creditsRepo } = makeApp()
    const today = new Date()
    const twoDaysAgo = new Date(today)

    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2)
    creditsRepo.updateStreak(3, twoDaysAgo.toISOString().slice(0, 10))

    const res = await request(app).get('/api/v1/streak')

    const body = res.body as StreakInfo

    expect(res.status).toBe(200)
    expect(body.saveAvailable).toBe(true)
    expect(body.count).toBe(3)
  })
})

// ── POST /api/v1/streak/save ──────────────────────────────────────────────────

describe('POST /api/v1/streak/save', () => {
  let creditsRepo: FakeCreditsRepository
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    const result = makeApp()

    app = result.app
    creditsRepo = result.creditsRepo

    const today = new Date()
    const twoDaysAgo = new Date(today)

    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2)
    creditsRepo.updateStreak(5, twoDaysAgo.toISOString().slice(0, 10))
    creditsRepo.addBalance(300)
  })

  it('returns 200 and the new balance', async () => {
    const res = await request(app).post('/api/v1/streak/save')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ balance: 100 })
  })

  it('deducts 200 credits', async () => {
    await request(app).post('/api/v1/streak/save')

    expect(creditsRepo.getBalance()).toBe(100)
  })

  it('sets streak_save_pending', async () => {
    await request(app).post('/api/v1/streak/save')

    expect(creditsRepo.isStreakSavePending()).toBe(true)
  })

  it('returns 400 when the streak is not saveable', async () => {
    creditsRepo.updateStreak(5, '2020-01-01')

    const res = await request(app).post('/api/v1/streak/save')

    expect(res.status).toBe(400)
  })

  it('returns 402 when balance is below 200', async () => {
    creditsRepo.addBalance(-200)  // now 100

    const res = await request(app).post('/api/v1/streak/save')

    expect(res.status).toBe(402)
  })
})

// ── POST /api/v1/streak/pause ─────────────────────────────────────────────────

describe('POST /api/v1/streak/pause', () => {
  it('returns 200 and PauseInfo when activation succeeds', async () => {
    const { app, creditsRepo } = makeApp()

    creditsRepo.updateStreak(5, new Date(Date.now() - 86400000).toISOString().slice(0, 10))

    const res = await request(app).post('/api/v1/streak/pause')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ active: true })
  })

  it('returns 400 when already paused', async () => {
    const { app, creditsRepo } = makeApp()

    creditsRepo.setPauseActive('2026-03-15')

    const res = await request(app).post('/api/v1/streak/pause')

    expect(res.status).toBe(400)
  })

  it('returns 200 with streakDaysLost > 0 when retroactive days exceed budget (Fall B)', async () => {
    const { app, creditsRepo } = makeApp()

    creditsRepo.updateStreak(5, '2020-01-01')  // many days ago
    creditsRepo.setPauseInactive(13, 2026)     // only 1 day remaining

    const res = await request(app).post('/api/v1/streak/pause')

    const body = res.body as { active: boolean; streakDaysLost: number }

    expect(res.status).toBe(200)
    expect(body.active).toBe(true)
    expect(body.streakDaysLost).toBeGreaterThan(0)
  })

  it('returns 409 when a training session is currently open', async () => {
    const { app, sessionRepo } = makeApp()

    const openSession: Session = {
      id: 'test-session',
      type: 'normal',
      direction: 'SOURCE_TO_TARGET',
      status: 'open',
      words: [],
      stressHighStakes: false,
      firstAnsweredAt: null,
    }

    sessionRepo.insert(openSession)

    const res = await request(app).post('/api/v1/streak/pause')

    expect(res.status).toBe(409)
  })
})

// ── POST /api/v1/streak/resume ────────────────────────────────────────────────

describe('POST /api/v1/streak/resume', () => {
  it('returns 200 and resume result when deactivation succeeds', async () => {
    const { app, creditsRepo } = makeApp()

    creditsRepo.updateStreak(5, '2026-03-10')
    creditsRepo.setPauseActive('2026-03-11')

    const res = await request(app).post('/api/v1/streak/resume')

    expect(res.status).toBe(200)
    const body = res.body as { creditsAwarded: number; milestoneLabels: string[] }

    expect(body.creditsAwarded).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(body.milestoneLabels)).toBe(true)
  })

  it('returns 400 when the game is not paused', async () => {
    const { app } = makeApp()

    const res = await request(app).post('/api/v1/streak/resume')

    expect(res.status).toBe(400)
  })
})
