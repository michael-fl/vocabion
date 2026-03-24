/**
 * Vocabulary list screen.
 *
 * Loads all vocabulary entries from the server and displays them in several
 * collapsible `<details>` sections (all collapsed by default):
 *
 * - **Marked** — all starred words across all buckets, sorted alphabetically.
 * - **Scored** — all words with score > 0, sorted by score descending.
 * - **Named group** (New / Beginner / Learning / Established / Veteran / Master / Legend) —
 *   words grouped by named bucket ranges. Within each group, words are sorted by bucket first,
 *   then alphabetically. Groups spanning more than one bucket show a Bucket column.
 *
 * The Marked and Scored sections are cross-bucket views; words still appear in
 * their respective bucket sections as well.
 *
 * Stars are clickable in every section to toggle the marked state.
 *
 * @example
 * ```tsx
 * <VocabListScreen />
 * ```
 */
import { useState, useEffect, useCallback, Fragment } from 'react'
import {
  SparkleIcon, PlantIcon, BookOpenIcon, GraduationCapIcon,
  ShieldIcon, CrownIcon, TrophyIcon, StarIcon, TrendUpIcon,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'

import type { VocabEntry } from '../../shared/types/VocabEntry.ts'
import * as vocabApi from '../api/vocabApi.ts'
import { formatDueIn } from '../utils/srsDisplay.ts'
import { dictUrl } from '../utils/dictUrl.ts'
import { AddWordForm } from './AddWordForm.tsx'
import styles from './VocabListScreen.module.css'


/** Returns the display group name for a bucket number. */
function bucketGroupName(bucket: number): string {
  if (bucket === 0) { return 'New' }
  if (bucket === 1) { return 'Beginner' }
  if (bucket <= 3) { return 'Learning' }
  if (bucket <= 5) { return 'Established' }
  if (bucket <= 7) { return 'Veteran' }
  if (bucket <= 11) { return 'Master' }
  return 'Legend'
}

/** Ordered list of all bucket groups, including those not yet reached. */
const ALL_GROUP_DEFS = [
  { name: 'New',         bucketRange: '0',    multiGroup: false },
  { name: 'Beginner',    bucketRange: '1',    multiGroup: false },
  { name: 'Learning',    bucketRange: '2–3',  multiGroup: true },
  { name: 'Established', bucketRange: '4–5',  multiGroup: true },
  { name: 'Veteran',     bucketRange: '6–7',  multiGroup: true },
  { name: 'Master',      bucketRange: '8–11', multiGroup: true },
  { name: 'Legend',      bucketRange: '12+',  multiGroup: true },
] as const

/** Maps group name → Phosphor icon component. */
const GROUP_ICON: Record<string, Icon> = {
  New:         SparkleIcon,
  Beginner:    PlantIcon,
  Learning:    BookOpenIcon,
  Established: GraduationCapIcon,
  Veteran:     ShieldIcon,
  Master:      CrownIcon,
  Legend:      TrophyIcon,
}

/** Maps group name → CSS module class for the accent tint. */
const GROUP_CSS_CLASS: Record<string, string> = {
  New:         styles.groupNew,
  Beginner:    styles.groupBeginner,
  Learning:    styles.groupLearning,
  Established: styles.groupEstablished,
  Veteran:     styles.groupVeteran,
  Master:      styles.groupMaster,
  Legend:      styles.groupLegend,
}

interface BucketGroup {
  name: string
  bucketRange: string
  minBucket: number
  entries: VocabEntry[]
  hasMultipleBuckets: boolean
}

/**
 * Groups entries into named bucket ranges, sorted by bucket then alphabetically within each group.
 * Groups are returned in ascending bucket order.
 */
function groupByBucketGroup(entries: VocabEntry[]): BucketGroup[] {
  const map = new Map<string, { minBucket: number; entries: VocabEntry[]; buckets: Set<number> }>()

  for (const entry of entries) {
    const name = bucketGroupName(entry.bucket)
    const existing = map.get(name)

    if (existing === undefined) {
      map.set(name, { minBucket: entry.bucket, entries: [entry], buckets: new Set([entry.bucket]) })
    } else {
      existing.entries.push(entry)
      existing.buckets.add(entry.bucket)
      existing.minBucket = Math.min(existing.minBucket, entry.bucket)
    }
  }

  return [...map.values()]
    .map(({ minBucket, entries: groupEntries, buckets }) => {
      const name = bucketGroupName(minBucket)
      const def = ALL_GROUP_DEFS.find((d) => d.name === name)

      return {
        name,
        bucketRange: def?.bucketRange ?? String(minBucket),
        minBucket,
        entries: groupEntries.sort((a, b) => a.bucket - b.bucket || a.source.localeCompare(b.source)),
        hasMultipleBuckets: buckets.size > 1,
      }
    })
    .sort((a, b) => a.minBucket - b.minBucket)
}

interface VocabTableProps {
  words: VocabEntry[]
  now: Date
  /** When true, shows a Bucket column (used for cross-bucket views). */
  showBucket: boolean
  /** When true, renders a divider row between rows from different buckets. */
  showBucketSeparators: boolean
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
function VocabTable({ words, now, showBucket, showBucketSeparators, togglingIds, onToggleMark }: VocabTableProps) {
  // For bucket sections (all same bucket): show Due in only for time-based buckets.
  // For cross-bucket sections: always show Due in column (value per row for bucket ≥ 4 only).
  const showDueInColumn = showBucket || words.some((e) => e.bucket >= 4)
  const colCount = 5 + (showBucket ? 1 : 0) + (showDueInColumn ? 1 : 0)

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={`${styles.th} ${styles.colDE}`}>Source</th>
            <th className={`${styles.th} ${styles.colEN}`}>Target</th>
            {showBucket && <th className={`${styles.th} ${styles.colBucket}`}>Bucket</th>}
            <th className={`${styles.th} ${styles.colStar}`} aria-label="Marked" />
            <th className={`${styles.th} ${styles.colScore}`}>Score</th>
            <th className={`${styles.th} ${showDueInColumn ? styles.colDifficulty : styles.colDifficultyExpanded}`}>Difficulty</th>
            {showDueInColumn && <th className={`${styles.th} ${styles.colDueIn}`}>Due in</th>}
          </tr>
        </thead>
        <tbody>
          {words.map((entry, i) => {
            const prev = i > 0 ? words[i - 1] : undefined
            const showSeparator = showBucketSeparators && prev !== undefined && entry.bucket !== prev.bucket

            return (
              <Fragment key={entry.id}>
                {showSeparator && (
                  <tr className={styles.bucketSeparatorRow}>
                    <td colSpan={colCount} className={styles.bucketSeparatorCell}>Bucket {entry.bucket}</td>
                  </tr>
                )}
                <tr className={styles.tr}>
                  <td className={styles.td}>
                    <a href={dictUrl(entry.source)} target="_blank" rel="noreferrer">{entry.source}</a>
                  </td>
                  <td className={`${styles.td} ${styles.enCell}`}>
                    {entry.target.map((w, j) => (
                      <span key={w}>
                        {j > 0 && <span className={styles.enSep}> / </span>}
                        <a href={dictUrl(w)} target="_blank" rel="noreferrer">{w}</a>
                      </span>
                    ))}
                  </td>
                  {showBucket && <td className={`${styles.td} ${styles.tdCenter}`}>{entry.bucket}</td>}
                  <td className={`${styles.td} ${styles.tdCenter}`}>
                    <button
                      type="button"
                      className={`${styles.starBtn}${entry.marked ? ` ${styles.starBtnMarked}` : ''}`}
                      aria-label={entry.marked ? 'Unmark' : 'Mark'}
                      disabled={togglingIds.has(entry.id)}
                      onClick={() => { onToggleMark(entry) }}
                    >
                      {entry.marked ? '★' : '☆'}
                    </button>
                  </td>
                  <td className={`${styles.td} ${styles.tdRight}`}>{entry.score}</td>
                  <td className={`${styles.td} ${styles.tdRight}`}>{entry.difficulty}</td>
                  {showDueInColumn && <td className={styles.td}>{entry.bucket >= 4 ? formatDueIn(entry, now) : null}</td>}
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Renders vocabulary entries in collapsible sections. */
export function VocabListScreen() {
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

  const groups = entries !== null ? groupByBucketGroup(entries) : []

  const markedWords =
    entries !== null
      ? [...entries].filter((e) => e.marked).sort((a, b) => a.source.localeCompare(b.source))
      : []

  const scoredWords =
    entries !== null
      ? [...entries]
          .filter((e) => e.score > 0)
          .sort((a, b) => b.score - a.score || a.source.localeCompare(b.source))
      : []

  return (
    <div className={styles.screen}>
      <div className={styles.stickyTop}>
        <h1 className={styles.title}>Vocabulary</h1>

        <div className={styles.addWordSection}>
          <AddWordForm onSuccess={() => { setRefreshKey((k) => k + 1) }} />
        </div>
      </div>

      {error !== null && <p className={styles.error} role="alert">{error}</p>}

      {entries === null && error === null && <p>Loading…</p>}

      {entries !== null && entries.length === 0 && (
        <p>No vocabulary entries yet.</p>
      )}

      <div className={styles.sections}>
        {markedWords.length > 0 && (
          <details className={`${styles.section} ${styles.sectionSynthetic}`}>
            <summary className={styles.sectionSummary}>
              <StarIcon size={15} weight="regular" />
              Marked — {markedWords.length} {markedWords.length === 1 ? 'word' : 'words'}
            </summary>
            <VocabTable words={markedWords} now={now} showBucket={true} showBucketSeparators={false} togglingIds={togglingIds} onToggleMark={handleToggleMark} />
          </details>
        )}

        {scoredWords.length > 0 && (
          <details className={`${styles.section} ${styles.sectionSynthetic}`}>
            <summary className={styles.sectionSummary}>
              <TrendUpIcon size={15} />
              Scored — {scoredWords.length} {scoredWords.length === 1 ? 'word' : 'words'}
            </summary>
            <VocabTable words={scoredWords} now={now} showBucket={true} showBucketSeparators={false} togglingIds={togglingIds} onToggleMark={handleToggleMark} />
          </details>
        )}

        {entries !== null && entries.length > 0 && ALL_GROUP_DEFS.map(({ name, bucketRange, multiGroup }) => {
          const group = groups.find((g) => g.name === name)
          const groupClass = GROUP_CSS_CLASS[name] ?? ''
          const GroupIcon = GROUP_ICON[name]

          if (group === undefined) {
            return (
              <div key={name} className={`${styles.section} ${styles.sectionEmpty} ${groupClass}`}>
                <div className={`${styles.sectionSummary} ${styles.sectionSummaryLocked}`}>
                  <GroupIcon size={15} />
                  {name}
                  <span className={styles.bucketRange}>{bucketRange}</span>
                </div>
              </div>
            )
          }

          return (
            <details key={name} className={`${styles.section} ${groupClass}`}>
              <summary className={styles.sectionSummary}>
                <GroupIcon size={15} />
                {name} — {group.entries.length} {group.entries.length === 1 ? 'word' : 'words'}
                <span className={styles.bucketRange}>{group.bucketRange}</span>
              </summary>
              <VocabTable words={group.entries} now={now} showBucket={multiGroup} showBucketSeparators={group.hasMultipleBuckets} togglingIds={togglingIds} onToggleMark={handleToggleMark} />
            </details>
          )
        })}
      </div>
    </div>
  )
}
