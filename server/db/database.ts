/**
 * SQLite database factory with automatic migration runner.
 *
 * Opens (or creates) a SQLite database at the given path and applies all
 * pending migrations from the given directory before returning the connection.
 * Migration state is tracked in a `migrations` table inside the database itself,
 * so migrations are never applied twice.
 *
 * Migrations are plain `.sql` files named with a numeric prefix for ordering,
 * e.g. `001_initial.sql`, `002_add_column.sql`.
 *
 * @example
 * ```ts
 * // server/index.ts
 * import { join } from 'node:path'
 * import { openDatabase } from './db/database.ts'
 *
 * const db = openDatabase(
 *   './vocabion.db',
 *   join(import.meta.dirname, 'db/migrations'),
 * )
 * ```
 */
import { readdirSync, readFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

import Database from 'better-sqlite3'

/**
 * Opens a SQLite database and runs all pending migrations.
 *
 * @param dbPath - File path for the SQLite database, or `':memory:'` for an
 *   in-memory database (useful in tests).
 * @param migrationsDir - Absolute path to the directory containing `.sql`
 *   migration files.
 * @returns An open `better-sqlite3` Database instance, ready to use.
 */
export function openDatabase(dbPath: string, migrationsDir: string): Database.Database {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db, migrationsDir)

  return db
}

function runMigrations(db: Database.Database, migrationsDir: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)

  const applied = new Set(
    (db.prepare('SELECT name FROM migrations').all() as { name: string }[]).map((r) => r.name),
  )

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const insertMigration = db.prepare(
    'INSERT INTO migrations (name, applied_at) VALUES (?, ?)',
  )

  for (const file of files) {
    if (!applied.has(file)) {
      const sql = readFileSync(join(migrationsDir, file), 'utf-8')

      db.exec(sql)
      insertMigration.run(file, new Date().toISOString())
    }
  }
}
