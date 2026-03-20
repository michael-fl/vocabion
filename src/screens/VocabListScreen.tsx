/**
 * Vocabulary list screen.
 *
 * Loads all vocabulary entries from the server and displays them in several
 * collapsible `<details>` sections (all collapsed by default):
 *
 * - **Marked** — all starred words across all buckets, sorted alphabetically.
 * - **Scored** — all words with score > 0, sorted by score descending.
 * - **Bucket N** — words grouped by their current SRS bucket, sorted alphabetically.
 *
 * The Marked and Scored sections are cross-bucket views; words still appear in
 * their respective bucket sections as well.
 *
 * Stars are clickable in every section to toggle the marked state.
 *
 * @example
 * ```tsx
 * <VocabListScreen onBack={() => setScreen('home')} />
 * ```
 */
import { useState, useEffect, useCallback } from 'react'

import type { VocabEntry } from '../../shared/types/VocabEntry.ts'
import * as vocabApi from '../api/vocabApi.ts'
import { formatDueIn } from '../utils/srsDisplay.ts'
import { dictUrl } from '../utils/dictUrl.ts'
import { AddWordForm } from './AddWordForm.tsx'

export interface VocabListScreenProps {
  onBack: () => void
}

/** Groups entries by bucket number, sorted alphabetically within each bucket. */
function groupByBucket(entries: VocabEntry[]): Map<number, VocabEntry[]> {
  const map = new Map<number, VocabEntry[]>()

  for (const entry of entries) {
    const group = map.get(entry.bucket) ?? []

    group.push(entry)
    map.set(entry.bucket, group)
  }

  for (const group of map.values()) {
    group.sort((a, b) => a.de[0].localeCompare(b.de[0], 'de'))
  }

  return map
}

interface VocabTableProps {
  words: VocabEntry[]
  now: Date
  /** When true, shows a Bucket column (used for cross-bucket views). */
  showBucket: boolean
  /** IDs of words currently being toggled (disabled while in-flight). */
  togglingIds: Set<string>
  onToggleMark: (entry: VocabEntry) => void
}

/**
 * Shared table used by all vocabulary sections.
 *
 * For bucket sections (`showBucket = false`) the Due in column is shown only
 * when the bucket is time-based (≥ 4). For cross-bucket views (`showBucket = true`)
 * Due in is always shown as a column, with values only for time-based rows.
 */
function VocabTable({ words, now, showBucket, togglingIds, onToggleMark }: VocabTableProps) {
  // For bucket sections (all same bucket): show Due in only for time-based buckets.
  // For cross-bucket sections: always show Due in column (value per row for bucket ≥ 4 only).
  const showDueInColumn = showBucket || words.some((e) => e.bucket >= 4)

  return (
    <table>
      <thead>
        <tr>
          <th>German</th>
          <th>English</th>
          {showBucket && <th>Bucket</th>}
          {showDueInColumn && <th>Due in</th>}
          <th aria-label="Marked" />
          <th>Score</th>
        </tr>
      </thead>
      <tbody>
        {words.map((entry) => (
          <tr key={entry.id}>
            <td>{entry.de.map((w, i) => <span key={w}>{i > 0 && ' / '}<a href={dictUrl(w)} target="_blank" rel="noreferrer">{w}</a></span>)}</td>
            <td>{entry.en.map((w, i) => <span key={w}>{i > 0 && ' / '}<a href={dictUrl(w)} target="_blank" rel="noreferrer">{w}</a></span>)}</td>
            {showBucket && <td>{entry.bucket}</td>}
            {showDueInColumn && <td>{entry.bucket >= 4 ? formatDueIn(entry, now) : null}</td>}
            <td>
              <button
                type="button"
                aria-label={entry.marked ? 'Unmark' : 'Mark'}
                disabled={togglingIds.has(entry.id)}
                onClick={() => { onToggleMark(entry) }}
              >
                {entry.marked ? '★' : '☆'}
              </button>
            </td>
            <td>{entry.score}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Renders vocabulary entries in collapsible sections. */
export function VocabListScreen({ onBack }: VocabListScreenProps) {
  const [entries, setEntries] = useState<VocabEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())
  const now = new Date()

  useEffect(() => {
    vocabApi
      .listVocab()
      .then((data) => {
        setEntries(data)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load vocabulary')
      })
  }, [refreshKey])

  const handleToggleMark = useCallback((entry: VocabEntry) => {
    setTogglingIds((prev) => new Set(prev).add(entry.id))

    vocabApi
      .setVocabMarked(entry.id, !entry.marked)
      .then((updated) => {
        setEntries((prev) =>
          prev !== null ? prev.map((e) => (e.id === updated.id ? updated : e)) : prev,
        )
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to update word')
      })
      .finally(() => {
        setTogglingIds((prev) => {
          const next = new Set(prev)
          next.delete(entry.id)
          return next
        })
      })
  }, [])

  const buckets =
    entries !== null
      ? [...groupByBucket(entries).entries()].sort(([a], [b]) => a - b)
      : []

  const markedWords =
    entries !== null
      ? [...entries].filter((e) => e.marked).sort((a, b) => a.de[0].localeCompare(b.de[0], 'de'))
      : []

  const scoredWords =
    entries !== null
      ? [...entries]
          .filter((e) => e.score > 0)
          .sort((a, b) => b.score - a.score || a.de[0].localeCompare(b.de[0], 'de'))
      : []

  return (
    <div>
      <h1>Vocabulary</h1>

      <button onClick={onBack}>Back to home</button>

      <AddWordForm onSuccess={() => { setRefreshKey((k) => k + 1) }} />

      {error !== null && <p role="alert">{error}</p>}

      {entries === null && error === null && <p>Loading…</p>}

      {entries !== null && entries.length === 0 && (
        <p>No vocabulary entries yet.</p>
      )}

      {markedWords.length > 0 && (
        <details>
          <summary>
            Marked — {markedWords.length} {markedWords.length === 1 ? 'word' : 'words'}
          </summary>

          <VocabTable words={markedWords} now={now} showBucket={true} togglingIds={togglingIds} onToggleMark={handleToggleMark} />
        </details>
      )}

      {scoredWords.length > 0 && (
        <details>
          <summary>
            Scored — {scoredWords.length} {scoredWords.length === 1 ? 'word' : 'words'}
          </summary>

          <VocabTable words={scoredWords} now={now} showBucket={true} togglingIds={togglingIds} onToggleMark={handleToggleMark} />
        </details>
      )}

      {buckets.map(([bucket, words]) => (
        <details key={bucket}>
          <summary>
            Bucket {bucket} — {words.length} {words.length === 1 ? 'word' : 'words'}
          </summary>

          <VocabTable words={words} now={now} showBucket={false} togglingIds={togglingIds} onToggleMark={handleToggleMark} />
        </details>
      ))}
    </div>
  )
}
