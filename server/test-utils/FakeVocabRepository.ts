/**
 * In-memory implementation of `VocabRepository` for use in unit tests.
 *
 * Backed by a `Map` — no SQLite, no filesystem, no I/O. Entries are shallow-
 * copied on read and write to prevent tests from accidentally mutating internal
 * state.
 *
 * Instantiate a fresh `FakeVocabRepository` in each test's `beforeEach` to
 * guarantee isolation between tests.
 *
 * @example
 * ```ts
 * import { FakeVocabRepository } from '../../test-utils/FakeVocabRepository.ts'
 *
 * const repo = new FakeVocabRepository()
 * const service = new VocabService(repo)
 * ```
 */
import type { VocabEntry } from '../../shared/types/VocabEntry.ts'
import type { VocabRepository } from '../features/vocab/VocabRepository.ts'

export class FakeVocabRepository implements VocabRepository {
  private readonly store = new Map<string, VocabEntry>()

  findAll(): VocabEntry[] {
    return [...this.store.values()].map((e) => ({ ...e }))
  }

  findById(id: string): VocabEntry | undefined {
    const entry = this.store.get(id)

    return entry !== undefined ? { ...entry } : undefined
  }

  findByBucket(bucket: number): VocabEntry[] {
    return [...this.store.values()]
      .filter((e) => e.bucket === bucket)
      .map((e) => ({ ...e }))
  }

  insert(entry: VocabEntry): void {
    this.store.set(entry.id, { ...entry })
  }

  update(entry: VocabEntry): void {
    this.store.set(entry.id, { ...entry })
  }

  delete(id: string): void {
    this.store.delete(id)
  }
}
