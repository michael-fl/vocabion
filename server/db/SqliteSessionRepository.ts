/**
 * SQLite-backed implementation of `SessionRepository`.
 *
 * All operations are synchronous (better-sqlite3). The `words` array is
 * serialised as a JSON TEXT column and deserialised on read. Column names
 * follow snake_case (database convention) and are mapped to camelCase on the
 * way out.
 *
 * @example
 * ```ts
 * import { openDatabase } from './database.ts'
 * import { SqliteSessionRepository } from './SqliteSessionRepository.ts'
 *
 * const db = openDatabase('./vocabion.db', migrationsDir)
 * const repo = new SqliteSessionRepository(db)
 * ```
 */
import type Database from 'better-sqlite3'

import type { Session, SessionDirection, SessionType, SessionWord } from '../../shared/types/Session.ts'
import type { SessionRepository } from '../features/session/SessionRepository.ts'

interface SessionRow {
  id: string
  direction: string
  type: string
  words: string        // JSON-encoded SessionWord[]
  status: string
  created_at: string
  first_answered_at: string | null
  stress_high_stakes: number | null
  chapter_number: number | null
}

function rowToSession(row: SessionRow): Session {
  const stressHighStakes =
    row.stress_high_stakes === 1 ? true :
    row.stress_high_stakes === 0 ? false :
    undefined

  return {
    id: row.id,
    direction: row.direction as SessionDirection,
    type: row.type as SessionType,
    words: JSON.parse(row.words) as SessionWord[],
    status: row.status as 'open' | 'completed',
    createdAt: row.created_at,
    firstAnsweredAt: row.first_answered_at,
    stressHighStakes,
    chapterNumber: row.chapter_number ?? undefined,
  }
}

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: Database.Database) {}

  findOpen(): Session | undefined {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE status = 'open' LIMIT 1")
      .get() as SessionRow | undefined

    return row !== undefined ? rowToSession(row) : undefined
  }

  findById(id: string): Session | undefined {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as SessionRow | undefined

    return row !== undefined ? rowToSession(row) : undefined
  }

  findLastCompleted(): Session | undefined {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE status = 'completed' ORDER BY created_at DESC LIMIT 1")
      .get() as SessionRow | undefined

    return row !== undefined ? rowToSession(row) : undefined
  }

  findLastCompletedRegular(): Session | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM sessions
         WHERE status = 'completed'
           AND type NOT IN ('starred', 'review')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get() as SessionRow | undefined

    return row !== undefined ? rowToSession(row) : undefined
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }

  insert(session: Session): void {
    const stressHighStakes =
      session.stressHighStakes === true ? 1 :
      session.stressHighStakes === false ? 0 :
      null

    this.db
      .prepare(
        `INSERT INTO sessions (id, direction, type, words, status, created_at, first_answered_at, stress_high_stakes, chapter_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.direction,
        session.type,
        JSON.stringify(session.words),
        session.status,
        session.createdAt,
        session.firstAnsweredAt,
        stressHighStakes,
        session.chapterNumber ?? null,
      )
  }

  update(session: Session): void {
    this.db
      .prepare('UPDATE sessions SET words = ?, status = ?, first_answered_at = ? WHERE id = ?')
      .run(JSON.stringify(session.words), session.status, session.firstAnsweredAt, session.id)
  }

  countRecentErrors(vocabId: string, sessionLimit: number): number {
    // Among the N most recent completed sessions (globally, excluding review
    // sessions), count how many contain an incorrect answer for the given word.
    // Review sessions are excluded so unlimited replays cannot inflate the
    // recency-driven score.
    const result = this.db
      .prepare(
        `SELECT COUNT(*) AS cnt
         FROM sessions s, json_each(s.words) jw
         WHERE s.status = 'completed'
           AND s.type != 'review'
           AND json_extract(jw.value, '$.vocabId') = ?
           AND json_extract(jw.value, '$.status') = 'incorrect'
           AND s.id IN (
             SELECT id FROM sessions
             WHERE status = 'completed'
               AND type != 'review'
             ORDER BY created_at DESC
             LIMIT ?
           )`,
      )
      .get(vocabId, sessionLimit) as { cnt: number }

    return result.cnt
  }
}
