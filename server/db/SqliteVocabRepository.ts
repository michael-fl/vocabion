/**
 * SQLite-backed implementation of `VocabRepository`.
 *
 * All operations are synchronous (better-sqlite3). JSON arrays (`de`, `en`) are
 * serialised to TEXT columns and deserialised on read. Column names follow
 * snake_case (database convention) and are mapped to camelCase on the way out.
 *
 * @example
 * ```ts
 * import { openDatabase } from './database.ts'
 * import { SqliteVocabRepository } from './SqliteVocabRepository.ts'
 *
 * const db = openDatabase('./vocabion.db', migrationsDir)
 * const repo = new SqliteVocabRepository(db)
 * ```
 */
import type Database from 'better-sqlite3'

import type { VocabEntry } from '../../shared/types/VocabEntry.ts'
import type { VocabRepository } from '../features/vocab/VocabRepository.ts'

interface VocabEntryRow {
  id: string
  de: string           // plain German word
  en: string           // JSON-encoded string[]
  bucket: number
  max_bucket: number
  manually_added: number  // SQLite boolean: 0 = false, 1 = true
  marked: number          // SQLite boolean: 0 = false, 1 = true
  score: number
  last_asked_at: string | null
  created_at: string
  updated_at: string
}

function rowToEntry(row: VocabEntryRow): VocabEntry {
  return {
    id: row.id,
    de: row.de,
    en: JSON.parse(row.en) as string[],
    bucket: row.bucket,
    maxBucket: row.max_bucket,
    manuallyAdded: row.manually_added === 1,
    marked: row.marked === 1,
    score: row.score,
    lastAskedAt: row.last_asked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class SqliteVocabRepository implements VocabRepository {
  constructor(private readonly db: Database.Database) {}

  findAll(): VocabEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM vocab_entries ORDER BY created_at ASC')
      .all() as VocabEntryRow[]

    return rows.map(rowToEntry)
  }

  findById(id: string): VocabEntry | undefined {
    const row = this.db
      .prepare('SELECT * FROM vocab_entries WHERE id = ?')
      .get(id) as VocabEntryRow | undefined

    return row !== undefined ? rowToEntry(row) : undefined
  }

  findByBucket(bucket: number): VocabEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM vocab_entries WHERE bucket = ? ORDER BY created_at ASC')
      .all(bucket) as VocabEntryRow[]

    return rows.map(rowToEntry)
  }

  insert(entry: VocabEntry): void {
    this.db
      .prepare(
        `INSERT INTO vocab_entries (id, de, en, bucket, max_bucket, manually_added, marked, score, last_asked_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.de,
        JSON.stringify(entry.en),
        entry.bucket,
        entry.maxBucket,
        entry.manuallyAdded ? 1 : 0,
        entry.marked ? 1 : 0,
        entry.score,
        entry.lastAskedAt,
        entry.createdAt,
        entry.updatedAt,
      )
  }

  update(entry: VocabEntry): void {
    this.db
      .prepare(
        `UPDATE vocab_entries
         SET de = ?, en = ?, bucket = ?, max_bucket = ?, manually_added = ?, marked = ?, score = ?, last_asked_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        entry.de,
        JSON.stringify(entry.en),
        entry.bucket,
        entry.maxBucket,
        entry.manuallyAdded ? 1 : 0,
        entry.marked ? 1 : 0,
        entry.score,
        entry.lastAskedAt,
        entry.updatedAt,
        entry.id,
      )
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM vocab_entries WHERE id = ?').run(id)
  }
}
