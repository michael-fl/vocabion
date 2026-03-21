/**
 * Business logic for vocabulary management.
 *
 * Depends on `VocabRepository`, `SessionRepository`, and `CreditsRepository`
 * interfaces — never on any concrete database implementation. Instantiated
 * once at server startup and injected into the vocab router.
 *
 * @example
 * ```ts
 * const service = new VocabService(vocabRepo, sessionRepo, creditsRepo)
 * const entries = service.listAll()
 * ```
 */
import type { VocabEntry } from '../../../shared/types/VocabEntry.ts'
import type { VocabRepository } from './VocabRepository.ts'
import type { SessionRepository } from '../session/SessionRepository.ts'
import type { CreditsRepository } from '../credits/CreditsRepository.ts'
import { computeScore } from '../session/srsScore.ts'
import type {
  CreateVocabEntryRequest,
  UpdateVocabEntryRequest,
  ImportVocabRequest,
  AddOrMergeVocabRequest,
  SetBucketRequest,
  SetMarkedRequest,
  SpendCreditsRequest,
  RefundCreditsRequest,
} from '../../validation/vocabSchemas.ts'
import { ApiError } from '../../errors/ApiError.ts'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns `existing` with any values from `incoming` appended that are not
 * already present (case-insensitive comparison, original casing preserved).
 */
function mergeUnique(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing)
  const result = [...existing]

  for (const w of incoming) {
    if (!seen.has(w)) {
      seen.add(w)
      result.push(w)
    }
  }

  return result
}

// ── Export types ──────────────────────────────────────────────────────────────

/** A single entry in the export file — only the user-editable fields. */
export interface ExportEntry {
  de: string
  en: string[]
  bucket: number
}

/** The full export payload returned by `GET /api/v1/vocab/export`. */
export interface ExportVocabResponse {
  version: 1
  exportedAt: string
  entries: ExportEntry[]
}

// ── Service ───────────────────────────────────────────────────────────────────

export class VocabService {
  constructor(
    private readonly repo: VocabRepository,
    private readonly sessionRepo: SessionRepository,
    private readonly creditsRepo: CreditsRepository,
  ) {}

  /** Returns all vocabulary entries ordered by creation date. */
  listAll(): VocabEntry[] {
    return this.repo.findAll()
  }

  /**
   * Returns the entry with the given id.
   * @throws {ApiError} 404 if not found.
   */
  getById(id: string): VocabEntry {
    const entry = this.repo.findById(id)

    if (entry === undefined) {
      throw new ApiError(404, `Vocabulary entry not found: ${id}`)
    }

    return entry
  }

  /**
   * Creates a new entry with bucket 0 and the current timestamp.
   * Returns the created entry.
   */
  create(data: CreateVocabEntryRequest): VocabEntry {
    const now = new Date().toISOString()
    const entry: VocabEntry = {
      id: crypto.randomUUID(),
      de: data.de,
      en: data.en,
      bucket: 0,
      maxBucket: 0,
      manuallyAdded: true,
      marked: false,
      score: 0,
      lastAskedAt: null,
      createdAt: now,
      updatedAt: now,
    }

    this.repo.insert(entry)

    return entry
  }

  /**
   * Updates the translations of an existing entry.
   * @throws {ApiError} 404 if not found.
   */
  update(id: string, data: UpdateVocabEntryRequest): VocabEntry {
    const existing = this.getById(id)
    const updated: VocabEntry = {
      ...existing,
      de: data.de,
      en: data.en,
      updatedAt: new Date().toISOString(),
    }

    this.repo.update(updated)

    return updated
  }

  /**
   * Deletes the entry with the given id.
   * @throws {ApiError} 404 if not found.
   */
  delete(id: string): void {
    this.getById(id)
    this.repo.delete(id)
  }

  /**
   * Bulk-imports vocabulary entries with merge-on-conflict behaviour.
   *
   * For each entry in the import file (matching is case-sensitive):
   * - If no existing entry shares a German word → insert as a new entry at
   *   `bucket` (defaults to 0 if not specified in the file).
   * - If an existing entry shares a German word → merge DE and EN arrays
   *   (duplicates filtered out), then move to `bucket` from the file, or keep
   *   the existing bucket if the file does not specify one.
   *
   * Returns the total number of entries processed and how many were merged.
   */
  importEntries(data: ImportVocabRequest): { imported: number; merged: number } {
    const now = new Date().toISOString()
    const allEntries = this.repo.findAll()

    let merged = 0

    for (const item of data.entries) {
      const existing = allEntries.find((e) => e.de === item.de)

      if (existing === undefined) {
        const newMaxBucket = item.bucket ?? 0
        const entry: VocabEntry = {
          id: crypto.randomUUID(),
          de: item.de,
          en: item.en,
          bucket: newMaxBucket,
          maxBucket: newMaxBucket,
          manuallyAdded: false,
          marked: false,
          score: 0,
          lastAskedAt: null,
          createdAt: now,
          updatedAt: now,
        }

        this.repo.insert(entry)
        allEntries.push(entry)
        this.creditsRepo.addBalance(Math.max(0, newMaxBucket - 3))
      } else {
        const mergedBucket = item.bucket ?? existing.bucket
        const newMaxBucket = Math.max(existing.maxBucket, mergedBucket)
        const creditDelta = Math.max(0, newMaxBucket - 3) - Math.max(0, existing.maxBucket - 3)
        const updated: VocabEntry = {
          ...existing,
          en: mergeUnique(existing.en, item.en),
          bucket: mergedBucket,
          maxBucket: newMaxBucket,
          updatedAt: now,
        }

        this.repo.update(updated)
        allEntries[allEntries.indexOf(existing)] = updated

        if (creditDelta > 0) {
          this.creditsRepo.addBalance(creditDelta)
        }

        merged++
      }
    }

    return { imported: data.entries.length, merged }
  }

  /**
   * Adds or merges one vocabulary entry per German word in `data.de`.
   *
   * For each word in `data.de`:
   * - If no existing entry has that German word → a new entry is created.
   * - If an existing entry matches (case-sensitive) → the EN translations
   *   are merged into it (duplicates filtered out); the DE word is unchanged.
   *
   * Returns one result object per input word, each carrying the created/updated
   * entry and a `merged` flag.
   */
  addOrMerge(data: AddOrMergeVocabRequest): { entry: VocabEntry; merged: boolean }[] {
    const results: { entry: VocabEntry; merged: boolean }[] = []

    for (const word of data.de) {
      const existing = this.repo.findAll().find((e) => e.de === word)

      if (existing === undefined) {
        const entry = this.create({ de: word, en: data.en })

        results.push({ entry, merged: false })
      } else {
        const mergedEn = mergeUnique(existing.en, data.en)
        const entry = this.update(existing.id, { de: existing.de, en: mergedEn })

        results.push({ entry, merged: true })
      }
    }

    return results
  }

  /**
   * Sets the bucket of an existing entry to an explicit value.
   * Used to restore a word's bucket after adding a missed alternative.
   * @throws {ApiError} 404 if not found.
   */
  setBucket(id: string, data: SetBucketRequest): VocabEntry {
    const existing = this.getById(id)
    const updated: VocabEntry = {
      ...existing,
      bucket: data.bucket,
      updatedAt: new Date().toISOString(),
    }

    this.repo.update(updated)

    return updated
  }

  /**
   * Toggles the starred/marked status of an entry and recalculates its score.
   * @throws {ApiError} 404 if not found.
   */
  setMarked(id: string, data: SetMarkedRequest): VocabEntry {
    const existing = this.getById(id)
    const withMarked: VocabEntry = {
      ...existing,
      marked: data.marked,
      updatedAt: new Date().toISOString(),
    }
    const updated: VocabEntry = {
      ...withMarked,
      score: computeScore(withMarked, this.sessionRepo.countRecentErrors(id, 10)),
    }

    this.repo.update(updated)

    return updated
  }

  /**
   * Returns the current credit balance.
   *
   * Credits are earned when a word reaches a new highest time-based bucket (≥ 4)
   * and can be spent (balance decremented) on future hint features.
   */
  getCredits(): number {
    return this.creditsRepo.getBalance()
  }

  /** Returns the number of stars the user has earned (all-time watermark). */
  getEarnedStars(): number {
    return this.creditsRepo.getEarnedStars()
  }

  /**
   * Deducts `amount` credits from the balance.
   * Returns the new balance after deduction.
   * @throws {ApiError} 402 if the balance is insufficient.
   */
  spendCredits(data: SpendCreditsRequest): number {
    const balance = this.creditsRepo.getBalance()

    if (balance < data.amount) {
      throw new ApiError(402, `Insufficient credits: have ${balance}, need ${data.amount}`)
    }

    this.creditsRepo.addBalance(-data.amount)

    return this.creditsRepo.getBalance()
  }

  /**
   * Adds `amount` credits back to the balance (e.g. when an incorrectly marked
   * answer is accepted as a valid alternative after the fact).
   * Returns the new balance after the refund.
   */
  refundCredits(data: RefundCreditsRequest): number {
    this.creditsRepo.addBalance(data.amount)

    return this.creditsRepo.getBalance()
  }

  /**
   * Exports all entries in the standard import/export format.
   * Only user-editable fields (`de`, `en`, `bucket`) are included.
   */
  exportAll(): ExportVocabResponse {
    const entries = this.repo.findAll()

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: entries.map((e) => ({ de: e.de, en: e.en, bucket: e.bucket })),
    }
  }
}
