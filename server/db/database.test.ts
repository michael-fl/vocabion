// @vitest-environment node

/**
 * Tests for the database factory and migration runner.
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlinkSync } from 'node:fs'

import { describe, it, expect, afterEach } from 'vitest'
import type Database from 'better-sqlite3'

import { openDatabase } from './database.ts'

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations')

// ── Helpers ───────────────────────────────────────────────────────────────────

function tables(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name)
}

function columns(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  ).map((r) => r.name)
}

// ── Schema creation ───────────────────────────────────────────────────────────

describe('openDatabase — schema', () => {
  it('returns a Database instance', () => {
    const db = openDatabase(':memory:', MIGRATIONS_DIR)

    expect(db).toBeDefined()
    expect(typeof db.prepare).toBe('function')

    db.close()
  })

  it('creates the migrations tracking table', () => {
    const db = openDatabase(':memory:', MIGRATIONS_DIR)

    expect(tables(db)).toContain('migrations')

    db.close()
  })

  it('creates the vocab_entries table', () => {
    const db = openDatabase(':memory:', MIGRATIONS_DIR)

    expect(tables(db)).toContain('vocab_entries')

    db.close()
  })

  it('creates the sessions table', () => {
    const db = openDatabase(':memory:', MIGRATIONS_DIR)

    expect(tables(db)).toContain('sessions')

    db.close()
  })

  it('creates the credits table', () => {
    const db = openDatabase(':memory:', MIGRATIONS_DIR)

    expect(tables(db)).toContain('credits')

    db.close()
  })

  it('vocab_entries has all expected columns', () => {
    const db = openDatabase(':memory:', MIGRATIONS_DIR)

    const cols = columns(db, 'vocab_entries')

    expect(cols).toContain('id')
    expect(cols).toContain('de')
    expect(cols).toContain('en')
    expect(cols).toContain('bucket')
    expect(cols).toContain('last_asked_at')
    expect(cols).toContain('created_at')
    expect(cols).toContain('updated_at')

    db.close()
  })

  it('sessions has all expected columns', () => {
    const db = openDatabase(':memory:', MIGRATIONS_DIR)

    const cols = columns(db, 'sessions')

    expect(cols).toContain('id')
    expect(cols).toContain('direction')
    expect(cols).toContain('words')
    expect(cols).toContain('status')
    expect(cols).toContain('created_at')

    db.close()
  })
})

// ── Migration tracking ────────────────────────────────────────────────────────

describe('openDatabase — migration tracking', () => {
  it('records the initial migration in the migrations table', () => {
    const db = openDatabase(':memory:', MIGRATIONS_DIR)

    const rows = db.prepare('SELECT name FROM migrations').all() as { name: string }[]

    expect(rows).toHaveLength(16)
    expect(rows[0].name).toBe('001_initial.sql')
    expect(rows[1].name).toBe('002_session_type.sql')

    db.close()
  })

  it('sets applied_at to a non-empty ISO string', () => {
    const db = openDatabase(':memory:', MIGRATIONS_DIR)

    const row = db
      .prepare('SELECT applied_at FROM migrations WHERE name = ?')
      .get('001_initial.sql') as { applied_at: string } | undefined

    expect(row).toBeDefined()
    expect(typeof row?.applied_at).toBe('string')
    expect(row?.applied_at.length).toBeGreaterThan(0)

    db.close()
  })
})

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('openDatabase — idempotency', () => {
  const tmpPaths: string[] = []

  afterEach(() => {
    for (const p of tmpPaths) {
      try {
        unlinkSync(p)
      } catch {
        // file may already be gone
      }
    }

    tmpPaths.length = 0
  })

  it('does not re-apply migrations when the database is opened a second time', () => {
    const dbPath = join(tmpdir(), `vocabion-test-${Date.now()}.db`)

    tmpPaths.push(dbPath)

    openDatabase(dbPath, MIGRATIONS_DIR).close()

    const db = openDatabase(dbPath, MIGRATIONS_DIR)
    const count = (
      db.prepare('SELECT COUNT(*) as n FROM migrations').get() as { n: number }
    ).n

    expect(count).toBe(16)

    db.close()
  })

  it('does not throw when opened a second time on the same path', () => {
    const dbPath = join(tmpdir(), `vocabion-test-${Date.now()}.db`)

    tmpPaths.push(dbPath)

    expect(() => {
      openDatabase(dbPath, MIGRATIONS_DIR).close()
      openDatabase(dbPath, MIGRATIONS_DIR).close()
    }).not.toThrow()
  })
})

// ── Pragmas ───────────────────────────────────────────────────────────────────

describe('openDatabase — pragmas', () => {
  it('enables WAL journal mode', () => {
    const db = openDatabase(':memory:', MIGRATIONS_DIR)

    const row = db.pragma('journal_mode') as { journal_mode: string }[]

    expect(row[0].journal_mode).toBe('memory') // :memory: uses "memory" not "wal"

    db.close()
  })

  it('enables foreign key enforcement', () => {
    const db = openDatabase(':memory:', MIGRATIONS_DIR)

    const row = db.pragma('foreign_keys') as { foreign_keys: number }[]

    expect(row[0].foreign_keys).toBe(1)

    db.close()
  })
})
