// @vitest-environment node

/**
 * Tests for SqliteCreditsRepository.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

import { openDatabase } from './database.ts'
import { SqliteCreditsRepository } from './SqliteCreditsRepository.ts'

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations')

let db: Database.Database
let repo: SqliteCreditsRepository

beforeEach(() => {
  db = openDatabase(':memory:', MIGRATIONS_DIR)
  repo = new SqliteCreditsRepository(db)
})

afterEach(() => {
  db.close()
})

describe('getBalance', () => {
  it('returns 0 on a fresh database with no vocab entries', () => {
    expect(repo.getBalance()).toBe(0)
  })
})

describe('addBalance', () => {
  it('increments the balance', () => {
    repo.addBalance(3)

    expect(repo.getBalance()).toBe(3)
  })

  it('accumulates across multiple calls', () => {
    repo.addBalance(2)
    repo.addBalance(1)

    expect(repo.getBalance()).toBe(3)
  })

  it('decrements the balance when delta is negative', () => {
    repo.addBalance(5)
    repo.addBalance(-2)

    expect(repo.getBalance()).toBe(3)
  })
})

describe('streak methods', () => {
  it('getStreakCount returns 0 initially', () => {
    expect(repo.getStreakCount()).toBe(0)
  })

  it('getLastSessionDate returns null initially', () => {
    expect(repo.getLastSessionDate()).toBeNull()
  })

  it('isStreakSavePending returns false initially', () => {
    expect(repo.isStreakSavePending()).toBe(false)
  })

  it('updateStreak persists count and date', () => {
    repo.updateStreak(7, '2026-03-15')

    expect(repo.getStreakCount()).toBe(7)
    expect(repo.getLastSessionDate()).toBe('2026-03-15')
  })

  it('setStreakSavePending(true) sets the flag', () => {
    repo.setStreakSavePending(true)

    expect(repo.isStreakSavePending()).toBe(true)
  })

  it('setStreakSavePending(false) clears the flag', () => {
    repo.setStreakSavePending(true)
    repo.setStreakSavePending(false)

    expect(repo.isStreakSavePending()).toBe(false)
  })
})
