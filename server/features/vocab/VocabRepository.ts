/**
 * Repository interface for vocabulary entries.
 *
 * Services depend on this interface, never on any concrete implementation.
 * The SQLite implementation lives in `server/db/SqliteVocabRepository.ts`.
 * The in-memory fake for tests lives in `server/test-utils/FakeVocabRepository.ts`.
 *
 * @example
 * ```ts
 * class VocabService {
 *   constructor(private readonly repo: VocabRepository) {}
 * }
 * ```
 */
import type { VocabEntry } from '../../../shared/types/VocabEntry.ts'

export interface VocabRepository {
  /** Returns all entries ordered by creation date ascending. */
  findAll(): VocabEntry[]

  /** Returns the entry with the given id, or `undefined` if not found. */
  findById(id: string): VocabEntry | undefined

  /** Returns all entries that are in the given SRS bucket. */
  findByBucket(bucket: number): VocabEntry[]

  /** Inserts a new entry. Throws if an entry with the same id already exists. */
  insert(entry: VocabEntry): void

  /** Replaces all mutable fields of an existing entry. */
  update(entry: VocabEntry): void

  /** Deletes the entry with the given id. No-op if it does not exist. */
  delete(id: string): void
}
