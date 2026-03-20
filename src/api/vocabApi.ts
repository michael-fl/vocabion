/**
 * HTTP client for the vocabulary API (`/api/v1/vocab`).
 *
 * All functions throw an `Error` if the server responds with a non-OK status.
 *
 * @example
 * ```ts
 * import { listVocab } from './vocabApi.ts'
 * const entries = await listVocab()
 * ```
 */
import type { VocabEntry } from '../../shared/types/VocabEntry.ts'

const BASE = '/api/v1/vocab'

/** Returned by `addOrMergeVocab`. */
export interface AddOrMergeResult {
  entry: VocabEntry
  /** `true` if variants were merged into an existing entry; `false` if a new entry was created. */
  merged: boolean
}

/** Fetches all vocabulary entries from the server. */
export async function listVocab(): Promise<VocabEntry[]> {
  const res = await fetch(BASE)

  if (!res.ok) {
    throw new Error(`Failed to list vocab: ${res.status}`)
  }

  return res.json() as Promise<VocabEntry[]>
}

/**
 * Sets the SRS bucket of a vocabulary entry to the given value.
 * Used to restore a word's bucket after the user adds a missed alternative.
 */
export async function setVocabBucket(vocabId: string, bucket: number): Promise<void> {
  const res = await fetch(`${BASE}/${vocabId}/set-bucket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket }),
  })

  if (!res.ok) {
    throw new Error(`Failed to set vocab bucket: ${res.status}`)
  }
}

/**
 * Sets the starred/marked status of a vocabulary entry.
 * Marked words are highlighted in the vocabulary list and can be reviewed separately.
 */
export async function setVocabMarked(vocabId: string, marked: boolean): Promise<VocabEntry> {
  const res = await fetch(`${BASE}/${vocabId}/set-marked`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ marked }),
  })

  if (!res.ok) {
    throw new Error(`Failed to set vocab marked: ${res.status}`)
  }

  return res.json() as Promise<VocabEntry>
}

/**
 * Adds a new entry or merges translations into an existing one.
 * `de` and `en` are already-parsed arrays of variants.
 */
export async function addOrMergeVocab(de: string[], en: string[]): Promise<AddOrMergeResult> {
  const res = await fetch(`${BASE}/add-or-merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ de, en }),
  })

  if (!res.ok) {
    throw new Error(`Failed to add/merge vocab: ${res.status}`)
  }

  return res.json() as Promise<AddOrMergeResult>
}
