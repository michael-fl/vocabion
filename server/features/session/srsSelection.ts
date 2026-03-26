/**
 * Pure functions for the spaced repetition word selection algorithm.
 *
 * Kept as pure functions (no I/O, no side-effects) so they can be tested
 * in isolation with simple VocabEntry arrays.
 *
 * Selection strategy:
 * - **Frequency-based (buckets 0–3):** always included, using a dynamic strategy.
 *   Bucket 0 draws 1 or 2 words at random (clamped to availability). Buckets 1–3
 *   fill the rest proportionally to their current word counts. Shortfalls are
 *   filled from other frequency buckets.
 * - **Time-based (buckets 4+):** included only when due. At most 1 word per
 *   bucket. Due = null `lastAskedAt` (never asked) OR elapsed ≥ interval
 *   (bucket 4 = 22 hours, bucket 5 = 1 week, bucket n ≥ 5 = (n−4) weeks).
 *   If `maxSessionSize` is set and more buckets are due than the remaining slots,
 *   due buckets are chosen randomly so the total stays within the cap.
 * - **Shortfall fill-up:** if the total selected so far is still below `sessionSize`,
 *   remaining slots are filled in two phases: first with additional due time-based words
 *   (bucket 4 upward, multiple per bucket), then with non-due time-based words (same
 *   order). Words already selected are excluded from both phases.
 * - **Score-based preference:** within every candidate pool (per bucket, per phase),
 *   words are sorted by score descending. Words with equal score are shuffled randomly.
 *   Counts and proportions are unchanged; only the draw order is affected.
 *
 * @example
 * ```ts
 * import { selectSessionWords } from './srsSelection.ts'
 * const words = selectSessionWords(allEntries, 10, new Date(), 15)
 * ```
 */
import type { VocabEntry } from '../../../shared/types/VocabEntry.ts'
import { getIntervalMs } from '../../../shared/utils/srsInterval.ts'

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns `true` if a time-based word (bucket ≥ 4) is due for review.
 *
 * A `null` `lastAskedAt` is always due (word has never been presented).
 * Otherwise the word is due when the elapsed time since `lastAskedAt` ≥
 * `getIntervalMs(bucket)` (bucket 4 = 1 day, bucket 5 = 1 week, …).
 */
export function isDue(entry: VocabEntry, now: Date): boolean {
  if (entry.lastAskedAt === null) {
    return true
  }

  const elapsed = now.getTime() - new Date(entry.lastAskedAt).getTime()

  return elapsed >= getIntervalMs(entry.bucket)
}

/**
 * Selects vocabulary words for a repetition session.
 *
 * Only picks due words from time-based buckets (4+), starting with the lowest
 * bucket and working upward. Returns fewer than `sessionSize` words if not
 * enough due time-based words exist — the caller is responsible for falling
 * back to a normal session in that case.
 *
 * @param all - All vocabulary entries.
 * @param sessionSize - Target number of words.
 * @param now - Current timestamp.
 * @returns Up to `sessionSize` due time-based words, sorted bucket-ascending.
 */
export function selectRepetitionWords(
  all: VocabEntry[],
  sessionSize: number,
  now: Date,
): VocabEntry[] {
  const byBucket = new Map<number, VocabEntry[]>()

  for (const e of all) {
    if (e.bucket < 4 || !isDue(e, now)) {
      continue
    }

    const list = byBucket.get(e.bucket) ?? []
    list.push(e)
    byBucket.set(e.bucket, list)
  }

  const selected: VocabEntry[] = []
  const sortedBuckets = [...byBucket.keys()].sort((a, b) => a - b)

  for (const bucket of sortedBuckets) {
    if (selected.length >= sessionSize) {
      break
    }

    const available = sortByScoreThenShuffle(byBucket.get(bucket) ?? [])
    const need = sessionSize - selected.length

    selected.push(...available.slice(0, need))
  }

  return selected
}

/**
 * Selects vocabulary words for a training session.
 *
 * @param all - All vocabulary entries in the database.
 * @param sessionSize - Target total number of words. Frequency words fill up to
 *   this target first; due time-based words are added on top; any remaining gap
 *   is filled with non-due time-based words (lowest bucket first).
 * @param now - Current timestamp used for time-based due-date calculation.
 * @param maxSessionSize - Optional hard cap on total words selected (excluding
 *   second-chance words added later). When set, time-based slots are limited to
 *   `maxSessionSize − freqSelected.length`; excess due buckets are skipped randomly.
 * @returns Combined array of frequency-based and time-based words.
 */
export function selectSessionWords(
  all: VocabEntry[],
  sessionSize: number,
  now: Date,
  maxSessionSize?: number,
): VocabEntry[] {
  const freqEntries = all.filter((e) => e.bucket <= 3)
  const timeEntries = all.filter((e) => e.bucket >= 4)

  const freqSelected = selectFrequencyWords(freqEntries, sessionSize)

  const timeSlots =
    maxSessionSize !== undefined ? Math.max(0, maxSessionSize - freqSelected.length) : undefined

  const timeSelected = selectTimeBasedWords(timeEntries, now, timeSlots)

  const selected = [...freqSelected, ...timeSelected]

  // Phase 1: fill remaining gap with additional due time-based words (bucket 4 upward)
  const fillCount1 = sessionSize - selected.length

  if (fillCount1 > 0) {
    const selectedIds = new Set(selected.map((e) => e.id))
    const phase1 = selectTimeWordsForFill(timeEntries, now, selectedIds, fillCount1, true)

    selected.push(...phase1)
  }

  // Phase 2: fill any remaining gap with non-due time-based words (bucket 4 upward)
  const fillCount2 = sessionSize - selected.length

  if (fillCount2 > 0) {
    const selectedIds = new Set(selected.map((e) => e.id))
    const phase2 = selectTimeWordsForFill(timeEntries, now, selectedIds, fillCount2, false)

    selected.push(...phase2)
  }

  return selected
}

/**
 * Selects vocabulary words for a focus session.
 *
 * A focus session targets the words with the highest priority scores across
 * buckets 1–5. Bucket 0 (new words) and buckets 6+ (well-learned words) are
 * excluded from primary candidates. Only words with `score >= 2` are eligible
 * as primary candidates; ties within a score group are broken randomly.
 *
 * - Returns `null` when fewer than 5 primary candidates exist (session is skipped).
 * - When fewer than `sessionSize` primary candidates exist, remaining slots are
 *   filled with the highest-scoring words from buckets 1+ (score < 2 allowed),
 *   excluding already selected entries.
 *
 * @param all - All vocabulary entries in the database.
 * @param sessionSize - Target number of words (typically 10).
 * @returns Selected entries, or `null` if the focus session should be skipped.
 */
export function selectFocusWords(all: VocabEntry[], sessionSize: number): VocabEntry[] | null {
  const primary = sortByScoreThenShuffle(all.filter((e) => e.bucket > 0 && e.bucket <= 5 && e.score >= 2))

  if (primary.length < 5) {
    return null
  }

  const selected = primary.slice(0, sessionSize)

  if (selected.length < sessionSize) {
    const selectedIds = new Set(selected.map((e) => e.id))
    const topUp = sortByScoreThenShuffle(all.filter((e) => e.bucket > 0 && !selectedIds.has(e.id)))

    selected.push(...topUp.slice(0, sessionSize - selected.length))
  }

  return selected
}

/**
 * Selects vocabulary words for a starred session.
 *
 * Only picks words that the user has marked with ★. Words are sorted by score
 * descending with ties broken randomly (same priority as focus sessions).
 * At most `limit` words are returned.
 *
 * Returns `null` when no marked words exist — the caller should reject the request.
 *
 * @param all - All vocabulary entries.
 * @param limit - Maximum number of words to include (e.g. 100).
 * @returns Up to `limit` starred entries, or `null` if none are marked.
 */
export function selectStarredWords(all: VocabEntry[], limit: number): VocabEntry[] | null {
  const marked = all.filter((e) => e.marked)

  if (marked.length === 0) {
    return null
  }

  return sortByScoreThenShuffle(marked).slice(0, limit)
}

/**
 * Selects vocabulary words for a discovery session.
 *
 * Only picks words from bucket 0. Manually added words are preferred (sorted
 * first); within each group, words are sorted by score descending with ties
 * broken randomly.
 *
 * Returns `null` when fewer than `sessionSize` bucket-0 words exist, so the
 * caller can fall back to a different session type.
 *
 * @param all - All vocabulary entries.
 * @param sessionSize - Target number of words (must be satisfied exactly).
 * @returns Exactly `sessionSize` bucket-0 entries, or `null` if not enough exist.
 */
export function selectDiscoveryWords(all: VocabEntry[], sessionSize: number): VocabEntry[] | null {
  const bucket0 = all.filter((e) => e.bucket === 0)

  if (bucket0.length < sessionSize) {
    return null
  }

  const manual = sortByScoreThenShuffle(bucket0.filter((e) => e.manuallyAdded))
  const regular = sortByScoreThenShuffle(bucket0.filter((e) => !e.manuallyAdded))
  const candidates = [...manual, ...regular]

  return candidates.slice(0, sessionSize)
}

/**
 * Selects vocabulary words for a stress session using difficulty-based tiers.
 *
 * Words are drawn in three tiers, each randomly shuffled:
 * - Tier A (up to 8): difficulty ≥ 4
 * - Tier B (up to 8): difficulty ≥ 2, excluding tier A picks
 * - Tier C (remaining slots up to sessionSize): any word, excluding prior picks
 *
 * Each tier fills as many slots as available; if a tier has fewer than 8 words
 * the shortfall carries forward so tier C always fills up to `sessionSize`.
 *
 * Returns `null` when fewer than `minWords` total entries exist.
 *
 * @param all - All vocabulary entries.
 * @param sessionSize - Maximum number of words to include (e.g. 24).
 * @param minWords - Minimum total words required (e.g. 5).
 * @returns Up to `sessionSize` entries selected across the three tiers, or `null`.
 */
export function selectStressWords(
  all: VocabEntry[],
  sessionSize: number,
  minWords: number,
): VocabEntry[] | null {
  if (all.length < minWords) {
    return null
  }

  const selected: VocabEntry[] = []
  const usedIds = new Set<string>()

  // Tier A: up to 8 words with difficulty >= 4
  const tierA = shuffle(all.filter((e) => e.difficulty >= 4)).slice(0, Math.min(8, sessionSize))

  for (const entry of tierA) {
    selected.push(entry)
    usedIds.add(entry.id)
  }

  // Tier B: up to 8 words with difficulty >= 2, not yet selected
  const tierB = shuffle(all.filter((e) => e.difficulty >= 2 && !usedIds.has(e.id)))
    .slice(0, Math.min(8, sessionSize - selected.length))

  for (const entry of tierB) {
    selected.push(entry)
    usedIds.add(entry.id)
  }

  // Tier C: remaining slots up to sessionSize, from any word not yet selected
  const tierC = shuffle(all.filter((e) => !usedIds.has(e.id)))
    .slice(0, sessionSize - selected.length)

  for (const entry of tierC) {
    selected.push(entry)
    usedIds.add(entry.id)
  }

  return selected
}

/**
 * Selects vocabulary words for a veteran session.
 *
 * Draws from words in buckets 6+ with difficulty ≥ 2, sorted by difficulty
 * descending (ties broken randomly). Requiring difficulty ≥ 2 ensures only
 * structurally complex or error-prone words are revisited; easy words that
 * reached a high bucket are skipped.
 *
 * Returns `null` when fewer than `minWords` qualifying entries exist.
 *
 * @param all - All vocabulary entries.
 * @param sessionSize - Maximum number of words to include.
 * @param minWords - Minimum qualifying words required (e.g. 5).
 * @returns Up to `sessionSize` entries from buckets 6+ with difficulty ≥ 2, sorted by difficulty, or `null`.
 */
export function selectVeteranWords(
  all: VocabEntry[],
  sessionSize: number,
  minWords: number,
): VocabEntry[] | null {
  const candidates = all.filter((e) => e.bucket >= 6 && e.difficulty >= 2)

  if (candidates.length < minWords) {
    return null
  }

  return sortByDifficultyThenShuffle(candidates).slice(0, sessionSize)
}

/**
 * Selects vocabulary words for a breakthrough session.
 *
 * Targets words that are one correct answer away from a bucket milestone by
 * drawing from three deduplicated categories (first match wins):
 *
 * 1. **Bucket 3** — one step from entering the time-based SRS system.
 *    Always eligible, no due-date check.
 * 2. **Due bucket-5** — one step from veteran territory (bucket 6).
 *    Only due words are included.
 * 3. **Highest occupied bucket** (if time-based: due only; if frequency:
 *    unconditionally) — one step from setting a new personal `maxBucket` record.
 *
 * Slot allocation is proportional to each category's share of the flat pool.
 * Within each category words are sorted by score descending (ties shuffled).
 *
 * Returns `null` when fewer than `minWords` qualifying entries exist.
 *
 * @param all - All vocabulary entries in the database.
 * @param sessionSize - Maximum number of words to include (e.g. 12).
 * @param minWords - Minimum flat-pool size required (e.g. 5).
 * @param now - Current timestamp used for time-based due-date checks.
 * @returns Up to `sessionSize` entries across the three categories, or `null`.
 */
export function selectBreakthroughWords(
  all: VocabEntry[],
  sessionSize: number,
  minWords: number,
  now: Date,
): VocabEntry[] | null {
  const maxBucket = all.reduce((m, e) => Math.max(m, e.bucket), 0)

  // Category 1: bucket 3 words — always eligible
  const cat1 = sortByScoreThenShuffle(all.filter((e) => e.bucket === 3))
  const cat1Ids = new Set(cat1.map((e) => e.id))

  // Category 2: due bucket-5 words (not already in cat1)
  const cat2 = sortByScoreThenShuffle(
    all.filter((e) => e.bucket === 5 && !cat1Ids.has(e.id) && isDue(e, now)),
  )
  const cat2Ids = new Set(cat2.map((e) => e.id))

  // Category 3: words in the highest occupied bucket, not already categorised.
  // Time-based words (bucket ≥ 4) require a due check; frequency words don't.
  const cat3 = sortByScoreThenShuffle(
    all.filter((e) => {
      if (cat1Ids.has(e.id) || cat2Ids.has(e.id)) {
        return false
      }

      if (e.bucket !== maxBucket) {
        return false
      }

      return e.bucket >= 4 ? isDue(e, now) : true
    }),
  )

  const totalPool = cat1.length + cat2.length + cat3.length

  if (totalPool < minWords) {
    return null
  }

  const effectiveSize = Math.min(sessionSize, totalPool)

  // Proportional slot allocation — same rounding strategy as normal sessions
  const s1 = Math.min(Math.round(effectiveSize * cat1.length / totalPool), effectiveSize, cat1.length)
  const s2 = Math.min(Math.round(effectiveSize * cat2.length / totalPool), effectiveSize - s1, cat2.length)
  const s3 = Math.min(effectiveSize - s1 - s2, cat3.length)

  const selected = [
    ...cat1.slice(0, s1),
    ...cat2.slice(0, s2),
    ...cat3.slice(0, s3),
  ]

  // Fill any rounding shortfall from the remaining pool, highest score first
  const shortfall = effectiveSize - selected.length

  if (shortfall > 0) {
    const usedIds = new Set(selected.map((e) => e.id))
    const remaining = sortByScoreThenShuffle(
      [...cat1, ...cat2, ...cat3].filter((e) => !usedIds.has(e.id)),
    )

    selected.push(...remaining.slice(0, shortfall))
  }

  return selected
}

/**
 * Selects vocabulary words for a second chance session.
 *
 * Only picks words that are currently in the second chance bucket
 * (`secondChanceDueAt !== null`) and whose due timestamp has been reached.
 * Words are sorted by score descending, with ties broken randomly.
 *
 * Returns an empty array when no words are due — the caller should fall through
 * to the normal session rotation.
 *
 * @param all - All vocabulary entries in the database.
 * @param sessionSize - Maximum number of words to include (e.g. 24).
 * @param now - Current timestamp used for due-date checks.
 * @returns Up to `sessionSize` due second-chance entries.
 */
export function selectSecondChanceSessionWords(
  all: VocabEntry[],
  sessionSize: number,
  now: Date,
): VocabEntry[] {
  const nowIso = now.toISOString()
  const due = all.filter((e) => e.secondChanceDueAt !== null && e.secondChanceDueAt <= nowIso)

  return sortByScoreThenShuffle(due).slice(0, sessionSize)
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr]

  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }

  return out
}

/**
 * Sorts vocab entries by score descending, shuffling within each score group.
 * Higher-scored words always appear before lower-scored ones; ties are random.
 */
function sortByScoreThenShuffle(arr: readonly VocabEntry[]): VocabEntry[] {
  const byScore = new Map<number, VocabEntry[]>()

  for (const e of arr) {
    const group = byScore.get(e.score) ?? []
    group.push(e)
    byScore.set(e.score, group)
  }

  return [...byScore.keys()]
    .sort((a, b) => b - a)
    .flatMap((s) => shuffle(byScore.get(s) ?? []))
}

/**
 * Sorts vocab entries by difficulty descending, shuffling within each difficulty group.
 * Higher-difficulty words always appear before lower-difficulty ones; ties are random.
 */
function sortByDifficultyThenShuffle(arr: readonly VocabEntry[]): VocabEntry[] {
  const byDifficulty = new Map<number, VocabEntry[]>()

  for (const e of arr) {
    const group = byDifficulty.get(e.difficulty) ?? []
    group.push(e)
    byDifficulty.set(e.difficulty, group)
  }

  return [...byDifficulty.keys()]
    .sort((a, b) => b - a)
    .flatMap((d) => shuffle(byDifficulty.get(d) ?? []))
}

function selectFrequencyWords(freqEntries: VocabEntry[], sessionSize: number): VocabEntry[] {
  const byBucket = new Map<number, VocabEntry[]>()

  for (const e of freqEntries) {
    const list = byBucket.get(e.bucket) ?? []
    list.push(e)
    byBucket.set(e.bucket, list)
  }

  // Bucket 0: manually-added words always come first; then fill with score-sorted regular words.
  // The draw count is normally 1 or 2, but is raised to include all manually-added words.
  const b0entries = byBucket.get(0) ?? []
  const b0manual = shuffle(b0entries.filter((e) => e.manuallyAdded))
  const b0regular = sortByScoreThenShuffle(b0entries.filter((e) => !e.manuallyAdded))

  const b1avail = (byBucket.get(1) ?? []).length
  const b2avail = (byBucket.get(2) ?? []).length
  const b3avail = (byBucket.get(3) ?? []).length

  const b0target = Math.random() < 0.5 ? 1 : 2
  const b0count = Math.min(Math.max(b0manual.length, b0target), b0entries.length, sessionSize)

  // Buckets 1–3: fill remaining slots proportionally to current bucket sizes
  const remaining = sessionSize - b0count
  const total123 = b1avail + b2avail + b3avail

  let b1count = 0
  let b2count = 0
  let b3count = 0

  if (total123 > 0) {
    b1count = Math.min(Math.round(remaining * b1avail / total123), remaining)
    b2count = Math.min(Math.round(remaining * b2avail / total123), remaining - b1count)
    b3count = remaining - b1count - b2count
  }

  const selected: VocabEntry[] = []
  const usedIds = new Set<string>()

  // Pick bucket 0: manually-added first (shuffled), then regular (score-sorted)
  for (const e of [...b0manual, ...b0regular].slice(0, b0count)) {
    usedIds.add(e.id)
    selected.push(e)
  }

  function pick(bucket: number, count: number): void {
    const available = sortByScoreThenShuffle(byBucket.get(bucket) ?? []).filter((e) => !usedIds.has(e.id))

    for (const e of available.slice(0, count)) {
      usedIds.add(e.id)
      selected.push(e)
    }
  }

  pick(1, b1count)
  pick(2, b2count)
  pick(3, b3count)

  // Fill any shortfall from remaining frequency entries (fallback rule)
  const shortfall = sessionSize - selected.length

  if (shortfall > 0) {
    const rem = sortByScoreThenShuffle(freqEntries.filter((e) => !usedIds.has(e.id)))

    for (const e of rem.slice(0, shortfall)) {
      selected.push(e)
    }
  }

  return selected
}

/**
 * Fills remaining session slots from time-based words, iterating buckets from
 * lowest to highest and picking randomly within each bucket.
 * Already-selected words (by id) are excluded.
 *
 * @param due - When `true`, only due words are considered; when `false`, only non-due words.
 */
function selectTimeWordsForFill(
  timeEntries: VocabEntry[],
  now: Date,
  excludeIds: Set<string>,
  count: number,
  due: boolean,
): VocabEntry[] {
  const byBucket = new Map<number, VocabEntry[]>()

  for (const e of timeEntries) {
    if (excludeIds.has(e.id) || isDue(e, now) !== due) {
      continue
    }

    const list = byBucket.get(e.bucket) ?? []
    list.push(e)
    byBucket.set(e.bucket, list)
  }

  const selected: VocabEntry[] = []
  const sortedBuckets = [...byBucket.keys()].sort((a, b) => a - b)

  for (const bucket of sortedBuckets) {
    if (selected.length >= count) {
      break
    }

    const available = sortByScoreThenShuffle(byBucket.get(bucket) ?? [])
    const remaining = count - selected.length

    selected.push(...available.slice(0, remaining))
  }

  return selected
}

function selectTimeBasedWords(timeEntries: VocabEntry[], now: Date, maxBuckets?: number): VocabEntry[] {
  const byBucket = new Map<number, VocabEntry[]>()

  for (const e of timeEntries) {
    const list = byBucket.get(e.bucket) ?? []
    list.push(e)
    byBucket.set(e.bucket, list)
  }

  // Collect one random candidate per due bucket
  const candidates: VocabEntry[] = []

  for (const entries of byBucket.values()) {
    const due = entries.filter((e) => isDue(e, now))

    if (due.length > 0) {
      candidates.push(sortByScoreThenShuffle(due)[0])
    }
  }

  // If a cap applies and is exceeded, randomly pick a subset of due buckets
  if (maxBuckets !== undefined && candidates.length > maxBuckets) {
    return sortByScoreThenShuffle(candidates).slice(0, maxBuckets)
  }

  return candidates
}
