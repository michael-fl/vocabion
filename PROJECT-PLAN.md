# Vocabion — Project Plan

## Application Description

Vocabion is a web-based vocabulary trainer for macOS. It helps users memorize German–English
vocabulary pairs using a spaced repetition system (SRS). The app uses a React frontend
communicating with a Node.js backend that owns all business logic and data persistence.

Core characteristics:

- **Spaced repetition** — words are distributed across numbered buckets; more recent or
  difficult words stay in lower buckets and appear more frequently.
- **Session-based learning** — the user trains in sessions of a fixed number of words (default: 10).
- **Bidirectional** — supports DE → EN (default) and EN → DE translation directions.
- **Forgiving input** — case-insensitive, normalizes hyphens vs. spaces in compound words.
- **Multiple translations** — a word can have several valid translations; if so, the user must
  supply two correct ones to pass.
- **Import / Export** — the full vocabulary database can be exported and imported as JSON.

---

## Architectural Overview

### Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React 19 + TypeScript | already bootstrapped |
| Build | Vite | already bootstrapped |
| Backend | Node.js + Express + TypeScript | lightweight, widely used, easy REST API |
| Database | SQLite via `better-sqlite3` | embedded, file-based, no server process, public domain |
| Request validation | Zod | schema-first validation, excellent TypeScript inference |
| Logging | pino + pino-pretty | structured JSON to file; human-readable output in terminal |
| State (client) | React state + context | sufficient for this scale |
| Styling | CSS Modules | scoped styles, zero runtime cost |
| Testing | Vitest + Testing Library | already configured (frontend); Vitest for backend too |

**Why SQLite / `better-sqlite3`:**
- Most widely deployed embedded database in the world
- Single `.db` file — trivial to back up or migrate
- Full SQL querying, schema migrations, relational integrity
- `better-sqlite3` is the dominant synchronous SQLite driver for Node.js (MIT)
- No separate database server process required

### Application Architecture

```
┌─────────────────────────────┐        ┌──────────────────────────────────────────┐
│        Browser              │        │             Node.js Server               │
│                             │        │                                          │
│  React UI (Vite)            │  HTTP  │  Express Routers (/api/v1/...)           │
│  ─ renders state            │◄──────►│        │                                 │
│  ─ handles user input       │  JSON  │        ▼                                 │
│  ─ calls API client         │        │  Zod validation middleware               │
│                             │        │        │                                 │
└─────────────────────────────┘        │        ▼                                 │
                                        │  Services (business logic, SRS)          │
                                        │        │                                 │
                                        │        ▼                                 │
                                        │  Repository interfaces                   │
                                        │        │                                 │
                                        │        ▼                                 │
                                        │  SQLite repositories (better-sqlite3)    │
                                        │        │                                 │
                                        │        ▼                                 │
                                        │  vocabion.db (SQLite file)               │
                                        │                                          │
                                        │  ── cross-cutting ──────────────────     │
                                        │  pino logger                             │
                                        │  errorHandler middleware                 │
                                        └──────────────────────────────────────────┘
```

In development, Vite proxies `/api/*` requests to the Express server so both run on different
ports without CORS issues.

### Shared Types

Domain types used by both the frontend and the backend live in a top-level `shared/types/`
directory. Neither side defines its own copy.

```
shared/types/
  VocabEntry.ts    # VocabEntry, SessionWord interfaces
  Session.ts       # Session interface
```

Both `src/` (frontend) and `server/` (backend) import from `shared/types/`. The TypeScript
project references in `tsconfig.json` are configured to include this directory for both sides.
No type definitions for domain objects exist anywhere else.

```typescript
// Frontend (e.g. src/features/vocab/vocabApi.ts)
import type { VocabEntry } from '../../shared/types/VocabEntry'

// Backend (e.g. server/features/vocab/vocabService.ts)
import type { VocabEntry } from '../../shared/types/VocabEntry'
```

### Repository Layer

A repository abstraction layer sits between the service layer and the database. Services
depend only on repository **interfaces**, not on any concrete database implementation.
Swapping the database engine requires only writing new repository classes — no changes to
services, routers, or tests.

```
VocabRepository           (interface)
  └─ SqliteVocabRepository  (concrete, uses better-sqlite3)

SessionRepository         (interface)
  └─ SqliteSessionRepository (concrete, uses better-sqlite3)
```

Example interface:

```typescript
interface VocabRepository {
  findAll(): VocabEntry[]
  findById(id: string): VocabEntry | undefined
  findByBucket(bucket: number): VocabEntry[]
  insert(entry: VocabEntry): void
  update(entry: VocabEntry): void
  delete(id: string): void
}
```

Concrete implementations are instantiated once at server startup in `server/index.ts` and
injected into the services as constructor arguments. Services and their unit tests never
import anything from `server/db/`.

### Database Migrations

Migrations live in `server/db/migrations/` as numbered SQL files (e.g. `001_initial.sql`).
A migration runner in `server/db/database.ts` executes all pending migrations automatically
on server startup, before the HTTP server begins accepting requests.

Server startup sequence:
1. Connect to SQLite
2. Run all pending migrations (idempotent — each migration is tracked in a `migrations` table)
3. Start the HTTP server

### Request Validation and Type Strategy

The project uses two complementary type systems that serve different purposes and must never
drift out of sync:

| | Where | Purpose |
|---|---|---|
| **TypeScript interfaces** | `shared/types/` | Compile-time type safety across the whole codebase |
| **Zod schemas** | `server/validation/` | Runtime validation of untrusted input at API boundaries |

**Rule: Zod schemas are the single source of truth for API request/response shapes.**
TypeScript types for request/response objects are derived directly from their Zod schema using
`z.infer<>` — they are never written by hand. This guarantees compile-time and runtime types
are always identical:

```typescript
// server/validation/vocabSchemas.ts
import { z } from 'zod'

export const createVocabEntrySchema = z.object({
  de: z.string().min(1),
  en: z.array(z.string()).min(1),
})

// TypeScript type derived from the schema — no separate interface needed
export type CreateVocabEntryRequest = z.infer<typeof createVocabEntrySchema>
```

**Domain types** (`VocabEntry`, `Session`, etc.) remain plain TypeScript interfaces in
`shared/types/` because they represent the internal domain model, not API input shapes, and
are not subject to runtime validation.

All API endpoints validate incoming request data using the Zod schemas before passing anything
to the service layer. Invalid input returns a structured `400` JSON response immediately.

### Error Handling

A global error handler middleware (`server/middleware/errorHandler.ts`) catches all errors
thrown by routes and converts them to structured JSON responses.

Expected failures (e.g. "entry not found") are thrown as `ApiError` instances:

```typescript
// server/errors/ApiError.ts
class ApiError extends Error {
  status: number
}
```

Unexpected errors (unhandled exceptions) are caught by the same middleware and returned as
`500` responses, with the full error logged via pino.

### Logging

Structured logging via **pino** (`server/lib/logger.ts`). `console.log` is not used anywhere
in server code.

```typescript
// Usage anywhere in server code
import { logger } from '../lib/logger'
logger.info('Server started on port 3000')
logger.warn('Bucket shortfall — filling from lower bucket')
logger.error({ err }, 'Unexpected error in vocabService')
```

The logger is used for:
- Server startup and shutdown
- Incoming requests (via pino-http middleware)
- Important service actions (session created, word promoted, import completed)
- Warnings (e.g. unexpected but recoverable conditions)
- All errors

### Transport strategy

Pino supports multiple simultaneous transports via `pino.transport({ targets: [...] })`.
The logger is configured with two targets running in parallel:

| Target | Format | Purpose |
|---|---|---|
| `pino-pretty` | Human-readable, coloured | Terminal output during development |
| `pino/file` (or equivalent) | Structured JSON, one object per line | Log file for storage and analysis |

This means developers see clean, readable output in the terminal while the same log events
are simultaneously written as structured JSON to a log file. No log information is lost and
no separate logging path is needed for production vs. development.

### API Versioning

All routes are prefixed with `/api/v1/`. This allows future breaking changes to be introduced
under `/api/v2/` without affecting existing clients.

### Test Utilities

Reusable fake repositories for unit tests live in `server/test-utils/`:

```
server/test-utils/
  FakeVocabRepository.ts     # in-memory VocabRepository implementation
  FakeSessionRepository.ts   # in-memory SessionRepository implementation
```

All service unit tests use these fakes — no SQLite, no filesystem, no I/O.

### Folder Structure

```
vocabion/
├─ shared/                         # shared between frontend and backend
│  └─ types/
│     ├─ VocabEntry.ts             # VocabEntry, SessionWord
│     └─ Session.ts                # Session
│
├─ src/                            # React frontend
│  ├─ app/
│  │  ├─ App.tsx
│  │  └─ App.test.tsx
│  ├─ features/
│  │  ├─ vocab/
│  │  │  └─ vocabApi.ts            # fetch wrappers for /api/v1/vocab
│  │  ├─ session/
│  │  │  └─ sessionApi.ts          # fetch wrappers for /api/v1/session
│  │  └─ settings/
│  │     └─ settingsStore.ts       # direction + session size in localStorage
│  ├─ shared/
│  │  └─ components/               # reusable UI primitives
│  ├─ test/
│  │  └─ setupTests.ts
│  └─ main.tsx
│
├─ server/                         # Node.js backend
│  ├─ db/                          # database engine — isolated behind repository interfaces
│  │  ├─ database.ts               # SQLite connection + migration runner
│  │  ├─ SqliteVocabRepository.ts  # implements VocabRepository
│  │  ├─ SqliteSessionRepository.ts# implements SessionRepository
│  │  └─ migrations/               # versioned SQL files (001_initial.sql, …)
│  ├─ errors/
│  │  └─ ApiError.ts               # ApiError class with status code
│  ├─ features/
│  │  ├─ vocab/
│  │  │  ├─ VocabRepository.ts     # repository interface
│  │  │  ├─ vocabService.ts        # business logic — depends on VocabRepository
│  │  │  ├─ vocabService.test.ts
│  │  │  └─ vocabRouter.ts         # Express router for /api/v1/vocab
│  │  └─ session/
│  │     ├─ SessionRepository.ts   # repository interface
│  │     ├─ sessionService.ts      # SRS logic — depends on SessionRepository
│  │     ├─ sessionService.test.ts
│  │     └─ sessionRouter.ts       # Express router for /api/v1/session
│  ├─ lib/
│  │  └─ logger.ts                 # pino logger instance
│  ├─ middleware/
│  │  └─ errorHandler.ts           # global Express error handler
│  ├─ test-utils/
│  │  ├─ FakeVocabRepository.ts    # in-memory VocabRepository for tests
│  │  └─ FakeSessionRepository.ts  # in-memory SessionRepository for tests
│  ├─ validation/
│  │  ├─ vocabSchemas.ts           # Zod schemas for vocab endpoints
│  │  └─ sessionSchemas.ts         # Zod schemas for session endpoints
│  └─ index.ts                     # Express app entry point + dependency wiring
│
├─ index.html
├─ vite.config.ts                  # includes /api proxy to Express
├─ tsconfig.json
├─ package.json
└─ README.md
```

### REST API Endpoints

All endpoints are prefixed with `/api/v1/`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/vocab` | List all vocabulary entries |
| `POST` | `/api/v1/vocab` | Add a new entry |
| `PUT` | `/api/v1/vocab/:id` | Update an entry |
| `DELETE` | `/api/v1/vocab/:id` | Delete an entry |
| `GET` | `/api/v1/session/open` | Get the currently open session (if any) |
| `POST` | `/api/v1/session` | Create a new session |
| `POST` | `/api/v1/session/:id/answer` | Submit an answer for the current word |
| `POST` | `/api/v1/vocab/add-or-merge` | Add one entry per DE word; merges EN into existing entries |
| `POST` | `/api/v1/vocab/import` | Import vocabulary from JSON |
| `GET` | `/api/v1/vocab/export` | Export all vocabulary as JSON |

### Data Model

Domain types are defined in `shared/types/` and imported by both frontend and backend.

```typescript
// shared/types/VocabEntry.ts
interface VocabEntry {
  id:          string        // UUID
  de:          string        // exactly one German word (plain string in SQLite)
  en:          string[]      // one or more English translations (stored as JSON array in SQLite)
  bucket:      number        // 0 = newest / least known; increases on correct answer
  lastAskedAt: string | null // ISO 8601; null = word has never appeared in a session
  createdAt:   string        // ISO 8601
  updatedAt:   string        // ISO 8601
}
// Note: lastAskedAt is distinct from updatedAt. updatedAt reflects any edit to the entry
// (e.g. correcting a translation). lastAskedAt is set only when the word is answered in a
// session, and is the sole input to the time-based due-date calculation for buckets 4+.

interface SessionWord {
  vocabId: string
  status:  'pending' | 'correct' | 'incorrect'
}

// shared/types/Session.ts
interface Session {
  id:        string
  direction: 'DE_TO_EN' | 'EN_TO_DE'
  words:     SessionWord[]   // stored as JSON column in SQLite
  status:    'open' | 'completed'
  createdAt: string
}
```

### Spaced Repetition Strategy

Each session draws words from two distinct selection modes:

**Frequency-based buckets (0–3)** — selected every session using a dynamic, size-aware strategy:

**Bucket 0 (new words):** always draws **1 or 2 words chosen at random (50/50)**, clamped to the number of available words and `sessionSize`. This keeps a steady trickle of fresh vocabulary without overwhelming the session. If bucket 0 is empty the draw is 0; if bucket 0 has only 1 word the draw is 1.

**Manually-added word priority:** Words added via the UI "Add word" form carry a `manuallyAdded: true` flag. Within the bucket-0 pool these words are always drawn first (the entire manually-added subset is included, overriding the normal 1-or-2 draw count), followed by regular bucket-0 words up to the remaining budget. Words added via JSON import are never flagged. The flag is cleared on every selected word immediately after word selection in `sessionService.createSession()`, so each manually-added word gets one guaranteed appearance. Implemented via migration `009_manually_added.sql` (`manually_added INTEGER NOT NULL DEFAULT 0` column) and `VocabEntry.manuallyAdded: boolean`.

**Buckets 1–3 (active learning):** the remaining `sessionSize − b0draw` slots are distributed **proportionally to the current word counts** of buckets 1, 2, and 3. A bucket holding twice as many words as another receives roughly twice as many session slots. This is self-tuning — buckets naturally grow over time and automatically receive more practice as they do. Formally, for each bucket `i ∈ {1,2,3}`:

```
target_i = round(remaining × |bucket_i| / (|bucket1| + |bucket2| + |bucket3|))
```

Counts are cascaded (each bucket is capped at `remaining − already_assigned`) so the total never exceeds `sessionSize`. If a bucket is smaller than its target, only the available words are taken; any shortfall is filled from remaining frequency words across all buckets, and then from time-based words if necessary.

**Time-based buckets (4 and above)** — selected only when the word is *due*, based on how
long ago it was last asked:

| Bucket | Review interval | Words per session |
|---|---|---|
| 4 | once per 22 hours | 0 or 1 |
| 5 | once per 1 week  | 0 or 1 |
| 6 | once per 2 weeks | 0 or 1 |
| N (N ≥ 5) | once per (N − 4) weeks | 0 or 1 |

A word from bucket 4 is included when at least 22 hours have elapsed since `lastAskedAt`.
A word from bucket N (N ≥ 5) is included when at least (N − 4) weeks have elapsed.
A `null` value (never asked) is treated as always due. At most one word per time-based
bucket appears in any single session. The shared helper `shared/utils/srsInterval.ts`
(`getIntervalMs`) encodes this formula and is used by both the server selection logic and
the frontend "Due in" display.

**Session types:**

There are four session types: `normal`, `repetition`, `focus`, and `discovery`. On each `createSession` call the type is chosen as follows:

1. **Discovery session check (highest priority):** If the active pool (words in buckets 1–4) has fewer than `DISCOVERY_POOL_THRESHOLD` (80) words **and** at least `discoverySize` (24) bucket-0 words exist **and** no discovery session was already completed today (`last_discovery_session_date` in the credits table), a discovery session is created. At most one discovery session per calendar day.
2. **Focus session check:** If no focus session has been completed today (`last_focus_session_date` in the credits table), and at least 5 words with `score ≥ 2` and `bucket > 0` exist, a focus session is created. The normal/repetition alternation state is **not advanced** — it picks up where it left off after the focus session is completed.
3. **Normal/repetition alternation (fallback):** If neither condition above is met, sessions alternate based on the last completed session type:

| Last completed session | Next session (if enough due words) |
|---|---|
| none (first ever session) | normal |
| normal | repetition |
| repetition | normal |
| focus | determined by last non-focus completed session (same alternation) |

If a repetition session is due but fewer than `repetitionSize` due time-based words exist, the repetition is **skipped** and a normal session is created instead. Because the fallback session is also stored as `'normal'`, the next session will try repetition again.

*Discovery sessions* — inject new words when the active pool is running low. Default size: **24 words** (`discoverySize` parameter, default 24).
1. Only bucket-0 words are included.
2. Manually added words are drawn first, then regular words; within each group, sorted by score descending (ties shuffled randomly).
3. A **push back** action is available: the user can remove a word from the session and keep it in bucket 0 for a future discovery session. Budget: **10 push-backs per session** (`DISCOVERY_PUSHBACK_BUDGET`). After a push-back the session continues with the next pending word; if no pending words remain the session completes.
4. Wrong answers never deduct credits (`free = true` path in `handleWrongAnswer`).
5. Hints are always free and automatic (bucket 0 auto-hint; no paid button shown).
6. Perfect session bonus: **+100 credits** (instead of the standard +10) when all words are answered correctly with no push-backs.

*Normal sessions* — focus on frequency learning (buckets 0–3 + up to 1 due word per time-based bucket). Described in detail below under "Session size". Default size: **12 words** (`size` parameter, default 12). If the total is still below `sessionSize` after frequency + 1-per-due-bucket selection, two fill-up phases run: first with additional due time-based words (lowest bucket first), then with non-due time-based words (lowest bucket first). Already-selected words are excluded from both phases.

*Repetition sessions* — focus exclusively on reviewing overdue time-based words. Default size: **24 words** (`repetitionSize` parameter, default 24).
1. Only due words from time-based buckets (4+) are included. No fallback to frequency buckets (0–3).
2. Words are selected starting with bucket 4, score-ordered within each bucket (ties shuffled randomly), up to `repetitionSize`.
3. If bucket 4 does not have enough due words, continue with bucket 5, then 6, and so on.
4. If the total due time-based words across all buckets is still less than `repetitionSize`, the repetition session is skipped (see above).

*Focus sessions* — target the words with the highest priority scores to address problem words.
1. Only words from buckets 1+ are eligible (bucket 0 is excluded).
2. Primary candidates: words with `score ≥ 2`, sorted by score descending (ties shuffled randomly). Up to `sessionSize` (default 10) words are taken.
3. If fewer than 5 primary candidates exist, the focus session is **skipped** and step 3 (normal/repetition) applies instead.
4. If primary candidates fill fewer than `sessionSize` slots, remaining slots are filled from buckets 1+ words (any score), highest score first, excluding already selected words.
5. `last_focus_session_date` is recorded when the session **completes**. Only one focus session per calendar day.

The session title shown in the UI reflects the type: **"Learning Session"** for normal, **"Repetition Session"** for repetition, **"Focus Session"** for focus, **"Discovery Session"** for discovery.

**Session size — how many questions will be asked:**

*Words selected at session start:*
- **Frequency words**: up to `sessionSize` (default 12), capped by the total number of
  entries in buckets 0–3. Shortfalls are filled by the fallback rule, but the cap is hard:
  `min(total_freq_entries, 12)`.
- **Time-based words**: exactly 1 per occupied time-based bucket that currently has a due
  word, subject to the `maxSessionSize` cap (see below). Zero if no time-based words are due
  that day.

*Session size cap (`maxSessionSize`, configurable):*

When `maxSessionSize` is set, the total words selected at session start never exceeds it.
Time-based slots available = `maxSessionSize − F`, where F is the number of frequency words
actually selected (≤ `sessionSize`). If more time-based buckets are
due than there are available slots, the app **randomly selects a subset of the due buckets**
to fill the remaining slots; the rest are skipped and remain due for the next session.

Second-chance words (appended during the session) are not counted against the cap.

*Second-chance additions during the session:*
- A **fully wrong** answer on a time-based word may append 1 second-chance word to the
  session. At most one second-chance word is added per initially selected time-based word.

*Resulting bounds (with default `sessionSize` = 10, `maxSessionSize` = M):*

| Scenario | Questions asked |
|---|---|
| Minimum (few freq entries, no time-based words due) | 1 (service rejects 0-word sessions) |
| Typical (≥ 10 freq entries, no time-based words due) | 10 |
| Typical + D due time-based buckets, no cap | 10 + D |
| Typical + D due time-based buckets, cap M | min(10 + D, M) |
| Maximum for a given D (no cap) | 10 + 2 × D (every time-based word triggers a second chance) |
| Maximum with cap M | M + (M − 10) = 2M − 10 (second chances on all time-based words) |

Without a cap, D is unbounded in theory (one bucket per level: 4, 5, 6, …).
In practice D grows slowly — roughly 1 new occupied bucket per week of daily practice.

**Fallback rules (when a bucket has insufficient words):**
1. The shortfall is filled from the next lower non-empty bucket.
2. If all lower buckets are empty, words are taken from the next higher non-empty bucket.

**Partial correctness (applies to all buckets):**

A word with ≥ 2 required translations can be answered partially correct (exactly one of two
answers is right). Partial correctness is treated as a mild failure:
- **Partial answer** → word stays in its current bucket; `lastAskedAt` set to now.
  No second-chance word is drawn, even for time-based buckets.

**Promotion and demotion — frequency-based buckets (0–3):**
- Correct answer → word moves to `bucket + 1`; `lastAskedAt` set to now
- Partial answer → word stays in its current bucket; `lastAskedAt` set to now
- Fully wrong answer → word is reset to `bucket 1`; `lastAskedAt` set to now

Bucket 0 is reserved for words that have never been seen. A wrong answer never sends a word back to bucket 0.

**Promotion and demotion — time-based buckets (4+):**

A **correct** answer on a time-based word only promotes the word if it is currently **due**
(`elapsed ≥ interval`). If the word is not yet due (e.g. it was included in a focus session
ahead of schedule), the bucket is left unchanged and only `lastAskedAt` is reset to now. This
prevents the SRS schedule from being accidentally accelerated by early reviews.

A **fully wrong** answer on a time-based word triggers a second-chance flow:

1. The user is warned that the answer was wrong.
2. A second word (word 2) is drawn from the same bucket. If that bucket has no other word
   available, the next lower or next higher non-empty bucket is used instead.
3. The outcome depends on how word 2 is answered. Word 2 **never changes bucket** — its
   sole purpose is to give word 1 a chance to avoid a full reset:
   - Word 2 **correct** → word 1 moves to `bucket − 1`; word 2 stays in its current bucket;
     `lastAskedAt` set to now for word 2. For word 1, if the new bucket is still time-based (≥ 4),
     `lastAskedAt` is backdated so that word 1 becomes due again in ~24 h — ensuring it appears in
     the next day's repetition session regardless of the new bucket's normal interval. If the new
     bucket is a frequency bucket (< 4), `lastAskedAt` is set to now (the word will appear in every
     normal session anyway).
   - Word 2 **partial** → word 1 is reset to `bucket 1`; word 2 stays in its current bucket;
     `lastAskedAt` set to now for both.
   - Word 2 **fully wrong** → word 1 is reset to `bucket 1`; word 2 stays in its current bucket;
     `lastAskedAt` set to now for both.

There is no upper limit on the number of buckets.

**Score-based word preference:**

Every vocabulary entry has a persistent `score` (integer ≥ 0, stored in the DB). The score expresses how urgently the word needs practice. Within every candidate pool — frequency bucket picks, time-based 1-per-bucket selection, shortfall fill-up phases, and repetition session picks — candidates are **sorted by score descending**. Words with equal score are shuffled randomly within their group. The counts and proportions defined above are unchanged; only the draw order is affected.

Formula:
```
score = recentErrorCount + (marked ? 2 : 0) + max(maxBucket − bucket − 2, 0)
```
- `recentErrorCount` — number of erroneous answers for this word within the 10 most recent completed sessions globally (sessions where the word was not asked count as 0 errors). Both fully incorrect and **partially correct** answers count as +1, because partial answers are stored with `SessionWord.status = 'incorrect'` — there is no separate partial status on the session word.
- `marked` — +2 if the user starred the word (guarantees score ≥ 2, which automatically qualifies the word for focus sessions)
- fall-from-peak — how far the word dropped below its highest-ever bucket, with a grace of 2 buckets (e.g. a word that peaked at bucket 6 and fell to bucket 1 contributes 3 points)

The score is recomputed and persisted whenever an answer is submitted (`SessionService.submitAnswer`) or the word is starred/unstarred (`VocabService.setMarked`). Implemented in `srsScore.ts` (`computeScore`) and applied via `sortByScoreThenShuffle()` in `srsSelection.ts`.

**Shortfall fill-up (when total selected < `sessionSize`):**

If the total number of selected words after the two regular selection passes (frequency words
from buckets 0–3, then one due word per time-based bucket) is still below `sessionSize`
(e.g. buckets 0–3 are empty and few time-based buckets are due), the gap is filled in two
additional phases:

1. **Phase 1 — additional due words:** Starting from bucket 4, take as many due words as
   available and needed. Move to bucket 5 if more words are still needed, then bucket 6, and
   so on. Words already selected in the regular passes are excluded.
2. **Phase 2 — non-due words:** If `sessionSize` is still not reached, repeat the same
   bucket-4-upward sweep with words that are not yet due.

Within each bucket, words are picked randomly. The 1-word-per-bucket rule from the regular
time-based pass does **not** apply here — multiple words may be taken from the same bucket.

### Implementation status

| Area | File | Status |
|---|---|---|
| Due-date calculation | `server/features/session/srsSelection.ts` — `isDue()` | ✓ complete |
| Frequency word selection (weights + fallback) | `srsSelection.ts` — `selectFrequencyWords()` | ✓ complete |
| Time-based word selection (1 per due bucket) | `srsSelection.ts` — `selectTimeBasedWords()` | ✓ complete |
| Repetition session word selection | `srsSelection.ts` — `selectRepetitionWords()` | ✓ complete |
| Focus session word selection | `srsSelection.ts` — `selectFocusWords()` | ✓ complete |
| Discovery session word selection | `srsSelection.ts` — `selectDiscoveryWords()` | ✓ complete |
| Session type selection (discovery priority → focus → normal/rep) | `sessionService.ts` — `createSession()` | ✓ complete |
| Push back word (discovery sessions only) | `sessionService.ts` — `pushBackWord()` | ✓ complete |
| Bucket promotion / demotion | `server/features/session/sessionService.ts` | ✓ complete |
| Second-chance flow | `sessionService.ts` — `handleWrongAnswer()` / `handleCorrectAnswer()` | ✓ complete |
| Persistence (`bucket` + `lastAskedAt`) | `server/db/SqliteVocabRepository.ts` — `update()` | ✓ complete |

**Test gaps: closed ✓**
- `lastAskedAt` is asserted to be non-null after a correct answer (frequency bucket and time bucket tests).
- Correct first-attempt answer on a time-based word (bucket ≥ 4) is now explicitly tested with outcome `"correct"` and bucket promotion.

### Credit System

The user earns credits each time a word reaches a new personal highest bucket for the first time:

- **All buckets:** +1 credit per bucket level.
- If a word falls back and climbs to the same bucket again, **no additional credit** is awarded — each bucket level is counted only once per word.

**Storage:** The balance is kept as a single integer in the `credits` table (migration `004_credits.sql`), incremented whenever a word's `maxBucket` increases. The delta per promotion is always 1. This counter is also updated during bulk import when imported entries carry `bucket > 0`.

**`maxBucket`:** Each `VocabEntry` stores the highest bucket ever reached (`max_bucket` column, migration `003_max_bucket.sql`). It is updated whenever a correct answer promotes a word past its current `maxBucket`. It never decreases.

**Spending:** Credits are spent via `POST /api/v1/vocab/credits/spend` with `{ amount: number }`. The service throws a 402 error if the balance is insufficient. Currently used by the hint feature with a tiered cost:

| Bucket | Hint cost |
|--------|-----------|
| 0 | auto-shown (2 chars), free — no paid button |
| 1 | auto-shown (1 char), free — paid button enabled: 10 credits → shows 2 chars |
| 2–3 | 10 credits |
| 4 | 20 credits |
| 5 | 30 credits |
| n ≥ 5 | min(10 × (n − 2), 30) credits — capped at 30 |

**Session cost:** **1 credit is deducted immediately per incorrectly answered word** (including second-chance words), at the moment the wrong answer is submitted — mirroring how credits are earned immediately for correct answers. If the balance is 0 the deduction is skipped — the balance never goes negative. The session summary shows credits earned, credits spent on hints, and the total session cost (accumulated wrong-answer deductions). **Exception: discovery sessions are entirely free — wrong answers never deduct credits.**

**New-bucket milestone bonus:** A scaling bonus is awarded the first time any word is promoted into a bucket that has never existed before, subject to two conditions:
1. The new bucket number is ≥ 6.
2. The bucket number exceeds `max_bucket_ever` — a global high-water mark stored in the `credits` table (migration `007_bucket_milestone.sql`) that tracks the highest bucket ever reached across all words. It never decreases.

The bonus scales linearly: **bucket N → +(N−5)×100 credits** (bucket 6 = +100, bucket 7 = +200, bucket 8 = +300, …).

The bonus fires at most once per bucket level: if bucket 6 becomes empty again after a wrong answer and a different word later climbs into bucket 6, no second bonus is paid. The `bucketMilestoneBonus` field on `AnswerResult` carries the amount (0 or the scaled value) so the UI can display a celebration message.

**Perfect session bonus:** Awarded when a session is completed without any mistakes, second-chance words, or hints. The bonus amount depends on session type:
- **Normal / repetition / focus:** **+10 credits.**
- **Discovery:** **+100 credits** — all words must be answered correctly with no push-backs (a `pushed_back` word counts as non-correct and disqualifies the bonus).

All conditions that must hold (except discovery, which has no second-chance words or paid hints):
1. Every word in the session was answered correctly (no `'incorrect'` or `'pushed_back'` status).
2. No second-chance words were triggered (no word has `secondChanceFor` set).
3. The hint button was not clicked even once during the session.

The `hintsUsed` flag is passed as part of the final answer submission payload so the server can enforce this condition without requiring a separate endpoint. The bonus is shown as a distinct line item in the session summary and included in the Total.

The current balance is displayed in a persistent header visible on all screens and refreshed after each answer submission.

### Answer Validation Rules

1. **Case**: normalize both sides to lowercase before comparing.
2. **Compound words**: normalize hyphens and spaces (`well-known` ↔ `well known`).
3. **Multiple translations**: if a word has ≥ 2 translations, the user must provide **two**
   correct ones (in any order). If only one translation exists, one answer suffices.
4. **Typo tolerance**: after normalization, if no exact match is found, each answer is
   tested against each translation using Levenshtein distance (via the `leven` library).
   Two rules apply depending on word length (longer of typed vs. correct):

   | Word length | Accepted as typo when… |
   |---|---|
   | < 8 characters | distance = 1 (exactly one edit) |
   | ≥ 8 characters | distance ÷ max length ≤ 15 % |

   A typo match is treated as **correct** for SRS purposes — the word is promoted to
   `bucket + 1` just like an exact match. The UI informs the user with a spelling correction:
   _"Correct! (Spelling: "machone" → "machine") → bucket 5"_.

   Implemented in `server/features/session/answerValidation.ts`.
   Two new `AnswerOutcome` values: `correct_typo` and `second_chance_correct_typo`.

All validation runs server-side in `answerValidation.ts`.

### Testing & Coverage Strategy

#### Test runner

All tests — frontend, backend, and shared — run via **Vitest**. The global test command is:

```bash
npm test              # vitest run (single pass, no coverage)
npm run test:coverage # vitest run --coverage
```

Frontend tests use the `jsdom` environment (configured globally in `vite.config.ts`).
Server and shared tests override to `node` with a per-file docblock:

```ts
// @vitest-environment node
```

#### Coverage tool

Coverage is collected using **`@vitest/coverage-v8`** (V8's built-in instrumentation — no Babel or Istanbul transform required). Configuration lives in `vite.config.ts` under the `test.coverage` key:

```ts
// vite.config.ts (illustrative snippet)
test: {
  coverage: {
    provider: 'v8',
    reporter: ['text', 'html'],
    reportsDirectory: './coverage',
    thresholds: {
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },
  },
}
```

#### Coverage reports

| Reporter | Output | Purpose |
|---|---|---|
| `text` | Console (stdout) | Quick per-file summary after every run |
| `html` | `coverage/index.html` | Detailed line-by-line browsable report |

#### Coverage thresholds

| Metric | Minimum |
|---|---|
| Lines | 80 % |
| Functions | 80 % |
| Branches | 80 % |
| Statements | 80 % |

Vitest exits with a non-zero code when any threshold is not met. This causes CI and `npm run build` (if coverage is wired into it) to fail automatically — no manual inspection needed.

#### What is excluded from coverage

- `server/index.ts` — server entry point (wiring only, no logic; tested indirectly by integration tests in later phases)
- `server/lib/logger.ts` — pino configuration file; always mocked in tests
- `**/*.test.ts` / `**/*.test.tsx` — test files themselves
- `shared/**/*.test.ts` — shared type guard tests

---

### Import / Export Format

```json
{
  "version": 1,
  "exportedAt": "2026-03-11T10:00:00Z",
  "entries": [
    {
      "de": ["Tisch"],
      "en": ["table"],
      "bucket": 2
    }
  ]
}
```

---

## Used Libraries

### Runtime dependencies

| Library | Version | Purpose |
|---|---|---|
| `react` | ^19.2 | UI component framework |
| `react-dom` | ^19.2 | React DOM renderer |
| `express` | ^5.2 | HTTP server and routing |
| `better-sqlite3` | ^12.6 | Synchronous SQLite driver |
| `zod` | ^4.3 | Runtime request validation; TypeScript types derived via `z.infer<>` |
| `pino` | ^10.3 | Structured JSON logger |
| `pino-http` | ^11.0 | Express middleware for HTTP request logging via pino |
| `pino-pretty` | ^13.1 | Human-readable terminal transport for pino |
| `leven` | ^4.1 | Levenshtein distance for typo-tolerant answer validation |

### Dev / tooling dependencies

| Library | Version | Purpose |
|---|---|---|
| `typescript` | ~5.9 | Type checking |
| `vite` | ^7.3 | Frontend bundler and dev server |
| `vitest` | ^4.0 | Test runner (frontend and backend) |
| `@vitest/coverage-v8` | ^4.0 | V8-based code coverage |
| `@testing-library/react` | ^16.3 | React component testing utilities |
| `@testing-library/jest-dom` | ^6.9 | Custom DOM matchers for vitest |
| `jsdom` | ^28.1 | Browser DOM simulation for frontend tests |
| `eslint` | ^9.39 | Linter |
| `typescript-eslint` | ^8.48 | TypeScript-aware ESLint rules |
| `eslint-plugin-react-hooks` | ^7.0 | Enforces React hooks rules |
| `eslint-plugin-react-refresh` | ^0.4 | Vite fast-refresh compatibility lint |
| `@vitejs/plugin-react` | ^5.1 | React support for Vite |
| `@types/node` | ^24 | Node.js type declarations |
| `@types/express` | ^5.0 | Express type declarations |
| `@types/better-sqlite3` | ^7.6 | better-sqlite3 type declarations |
| `supertest` | ^7 | HTTP integration testing for Express routers |
| `@types/supertest` | ^6 | supertest type declarations |
| `concurrently` | ^9 | Run backend and frontend dev servers in parallel (`npm run dev:all`) |

> **UUID generation** — no external library; uses `crypto.randomUUID()` (Node.js built-in).

---

## Implementation Plan

### Phase 1 — Shared types ✅
- [x] Create `shared/types/VocabEntry.ts` and `shared/types/Session.ts`
- [x] Add a dedicated `tsconfig.shared.json` and add it to the project references in `tsconfig.json`
- [x] Verify both `src/` and `server/` can import from `shared/types/` without errors
- [x] Unit tests for `isVocabEntry`, `isSessionWord`, `isSession` type guards (47 tests total, all passing)

### Phase 2 — Backend: infrastructure ✅
- [x] Install `express`, `better-sqlite3`, `zod`, `pino`, `pino-http`, `pino-pretty` and their `@types/*`; UUID generation uses `crypto.randomUUID()` (Node.js built-in)
- [x] Set up `server/lib/logger.ts` — pino with pino-pretty (terminal) + pino/file (JSON) dual transport; silenced in tests
- [x] Set up `server/errors/ApiError.ts`
- [x] Set up `server/middleware/errorHandler.ts`
- [x] Set up `server/db/database.ts` with SQLite connection and migration runner
- [x] Create first migration: `server/db/migrations/001_initial.sql`
- [x] Add `tsconfig.server.json`; wire into root `tsconfig.json` references
- [x] Tests: 31 new tests covering ApiError, errorHandler (all branches), and database/migrations (78 total, all passing)

### Phase 3 — Backend: repository interfaces + SQLite implementation ✅
- [x] Define `VocabRepository` and `SessionRepository` interfaces (import types from `shared/types/`)
- [x] Implement `SqliteVocabRepository` and `SqliteSessionRepository`
- [x] Create `server/test-utils/FakeVocabRepository.ts` and `FakeSessionRepository.ts`
- [x] Tests: 45 new tests — SQLite implementations (full CRUD + round-trips), fake repositories (copy isolation, all methods); 123 total, all passing
- [ ] Wire concrete repositories into `server/index.ts` (dependency injection) — deferred to Phase 4

### Phase 4 — Backend: service layer + API ✅
- [x] Implement `vocabService.ts` (CRUD + import/export)
- [x] Add Zod schemas in `server/validation/vocabSchemas.ts` and `sessionSchemas.ts`
- [x] Implement `vocabRouter.ts` with validation; wires all `/api/v1/vocab` endpoints
- [x] Unit tests for `vocabService.ts` using `FakeVocabRepository` (22 tests)
- [x] Implement `sessionService.ts`: `getOpenSession`, `createSession`, `submitAnswer`
- [x] Implement SRS word selection (`srsSelection.ts`) and answer validation (`answerValidation.ts`) as pure, fully-tested utility modules
- [x] Implement full second-chance flow for time-based bucket wrong answers
- [x] Implement `sessionRouter.ts` with validation; wires all `/api/v1/session` endpoints
- [x] Unit tests for `sessionService.ts` using fake repos (24 tests, all second-chance branches covered)
- [x] Router integration tests using supertest + real services + fake repos (14 + 12 tests)
- [x] `server/app.ts` — Express app factory (injectable services, separates creation from listen)
- [x] `server/index.ts` — full server entry point with dependency wiring
- [x] Wire concrete repositories into `server/index.ts` (dependency injection) ✓
- [x] Tests: 104 new tests; 227 total, all passing

### Phase 5 — Code coverage ✓
- [x] Add `coverage` script to `package.json`: `vitest run --coverage`
- [x] Configure `test.coverage` in `vite.config.ts`:
  - Provider: `v8`
  - Reporters: `text` (console) + `html` (`coverage/`)
  - Thresholds: 80 % for lines, functions, branches, and statements
  - Exclude: `server/index.ts`, `server/lib/logger.ts`, test files
- [x] Add `coverage/` to `.gitignore`
- [x] Run `npm run test:coverage` and confirm all thresholds pass
- [x] Results: 98.76 % stmts, 97.01 % branches, 100 % functions, 98.71 % lines; 227 tests passing

### Phase 6 — Frontend: API client + minimal UI (MVP) ✓
- [x] Configure Vite `/api` proxy to Express
- [x] Implement `vocabApi.ts` and `sessionApi.ts` (typed fetch wrappers)
- [x] Home screen: "Start new session" / "Continue session" buttons
- [x] Training screen: prompt word, text input(s), submit, correct/wrong feedback, second-chance flow
- [x] End-of-session summary (# correct / # incorrect, with second-chance breakdown)
- [x] Tests: 20 new tests; 247 total, all passing

### Optional — Close SRS test gaps ✓
- [x] Add `lastAskedAt` non-null assertions after correct answers (frequency and time-based buckets)
- [x] Add explicit test for correct first-attempt answer on a time-based word (bucket ≥ 4): outcome `"correct"`, bucket promoted to 5
- [x] Tests: 4 new tests; 255 total, all passing

### Phase 7 — Frontend: vocabulary management
- [x] Vocab list screen: entries grouped by bucket, collapsible sections, alphabetical sort; time-based buckets (≥ 4) show "Due in" column with human-friendly remaining time
- [x] Add word form (add-or-merge): two comma-separated inputs (DE / EN); creates a new entry or merges variants into an existing one (case-insensitive match on any DE word, deduplication)
- [x] Add-alternative button: after an incorrect answer the user can click `Add "X" [+]` to add their typed answer as a valid translation; also restores the word to `originalBucket + 1` via `POST /api/v1/vocab/:id/set-bucket`
- [ ] Edit / delete entry form
- [ ] Import JSON (file picker → POST `/api/v1/vocab/import`)
- [ ] Export JSON (GET `/api/v1/vocab/export` → file download)

### Phase 7b — Marked / Favourite Words

Allows users to star individual words during a training session. Starred words are persisted and visible in the vocabulary list. Later phases will extend this feature.

**Implemented:**
- `marked: boolean` field on `VocabEntry` (shared type + migration `005_marked.sql`)
- `POST /api/v1/vocab/:id/set-marked` — toggles the mark
- `VocabService.setMarked()` — updates the `marked` column
- Training screen: ☆/★ button next to the prompt word; optimistic UI update; calls `setVocabMarked()`
- Vocabulary list screen: ★ shown for marked entries
- Score-based word preference in session generation (see "Spaced Repetition Strategy" section for the full formula and implementation details)

**Planned extensions (out of scope for now):**
- Dedicated "Favourites" / "Merkliste" screen listing all marked words
- Bulk un-mark action

### Optional — Manually-added word priority ✓
- [x] Migration `009_manually_added.sql`: `manually_added INTEGER NOT NULL DEFAULT 0` column on `vocab_entries`
- [x] `VocabEntry.manuallyAdded: boolean` added to the shared type
- [x] `VocabService.create()` sets `manuallyAdded: true`; `importEntries()` sets it to `false`
- [x] `srsSelection.ts`: bucket-0 pool split into manually-added (shuffled, always included first) and regular (score-sorted); manually-added words override the normal 1-or-2 draw count
- [x] `sessionService.createSession()` clears `manuallyAdded` on all selected words after word selection
- [x] Tests: 582 total, 27 test files, all passing

### Phase 8 — Settings
- [ ] Direction toggle (DE → EN / EN → DE), locked while session is open
- [ ] `sessionSize` setting (default 10) — target number of frequency words per session
- [ ] `maxSessionSize` setting — hard cap on total words selected at session start (time-based
  words fill remaining slots; excess due buckets are skipped randomly)
- [ ] Persist settings in `localStorage`

### Phase 9a — App Shell Layout + Theme System

Replace the current flat layout with a proper single-page app shell:

**Layout structure (desktop-only):**
- **Header** (fixed top) — app name "Vocabion", credit balance, streak info, right-panel toggle button
- **Left sidebar** — navigation: Home (new/continue session), Vocabulary, Settings
- **Main content** — renders the currently active screen
- **Right panel** — hidden by default; toggled via header button; shows "Coming soon…" label (reserved for dict.leo.org iframe)
- **Footer** (fixed bottom) — app version string

**Theme system:**
- Three named themes: `scholar` (Navy + Amber), `slate` (Dark slate + Indigo), `forest` (Deep green + Gold)
- Themes defined as CSS custom property sets on `html[data-theme="..."]` in a single `themes.css`
- All component styles use `var(--color-*)` tokens — no hardcoded hex values
- Active theme persisted in `localStorage`; applied before first render to avoid flash

**CSS variable tokens (defined per theme):**
- `--color-chrome-bg` — header/sidebar background
- `--color-chrome-text` — text on dark chrome areas
- `--color-content-bg` — main content area background
- `--color-content-text` — primary text on content areas
- `--color-accent` — primary action color (buttons, links, highlights)
- `--color-accent-hover` — hover state of accent
- `--color-muted` — secondary/muted text
- `--color-success` — correct answer / positive feedback
- `--color-error` — wrong answer / destructive actions
- `--color-border` — subtle borders and dividers

**Implementation checklist:**
- [x] `src/styles/themes.css` — three theme definitions as CSS custom property blocks
- [x] `src/styles/global.css` — base reset, body defaults, layout shell grid
- [x] `src/hooks/useTheme.ts` — read/write theme to `localStorage`; set `data-theme` on `<html>`
- [x] `src/components/AppLayout/AppLayout.tsx` + `AppLayout.module.css` — shell grid (header, sidebar, main, right panel, footer)
- [x] `src/components/AppLayout/Header.tsx` + `Header.module.css` — app name, credits, streak, right-panel toggle
- [x] `src/components/AppLayout/Sidebar.tsx` + `Sidebar.module.css` — nav items, active state
- [x] `src/components/AppLayout/RightPanel.tsx` + `RightPanel.module.css` — toggleable panel, "Coming soon…"
- [x] `src/components/AppLayout/Footer.tsx` + `Footer.module.css` — version string
- [x] `src/app/App.tsx` — replaced flat render with `AppLayout`; integrated navigation state
- [x] `src/screens/SettingsScreen.tsx` — theme picker (three visual cards, one per theme)
- [x] Tests for `useTheme` hook and `SettingsScreen` (827 tests, all passing)

### Phase 9b — Polish
- [ ] Empty-state screens (no vocabulary, no open session)
- [ ] Progress bar during a session
- [ ] Refine component-level styles within the new shell

---

## Current State

| Area | Status |
|---|---|
| Project bootstrap (Vite + React + TS) | done |
| ESLint + strict TS config | done |
| Vitest + Testing Library | done |
| Code coverage (Vitest V8, 80% thresholds) | done |
| Folder structure (frontend + backend) | done |
| Shared types directory | done |
| Express server setup | done |
| pino logging | done |
| ApiError + error handler middleware | done |
| SQLite connection + migration runner | done |
| Repository interfaces | done |
| SQLite repositories | done |
| Test utilities (fake repositories) | done |
| Zod validation schemas | done |
| Vocabulary service + API | done |
| Session / SRS logic + API | done |
| Frontend API client (`vocabApi`, `sessionApi`) | done |
| Home screen (start / continue session) | done |
| Training screen (prompt, answer, feedback) | done |
| End-of-session summary screen | done |
| Vocabulary list screen (read-only, with buckets) | done |
| Vocabulary add word (add-or-merge) | done |
| Add-alternative + bucket restore | done |
| Repetition sessions (alternating, time-based only) | done |
| Typo-tolerant answer validation | done |
| Different session sizes (normal=12, repetition=24) | done |
| Credit system (`maxBucket` tracking, persistent header display) | done |
| Answer hints (10 credits, shows first 1–2 chars per word as placeholder) | done |
| Mark / favourite words (star toggle in training, ★ in vocab list) | done |
| Score-based word preference (`score` field, `srsScore.ts`, recalculated on answer/mark) | done |
| Score backfill migration (008) for pre-existing entries | done |
| Bucket milestone bonus (+100 credits first time any word enters a never-seen bucket ≥ 6) | done |
| Manually-added word priority (`manuallyAdded` flag, migration 009, always drawn first in bucket 0) | done |
| Vocabulary edit / delete UI | not started |
| Import / Export UI | not started |
| Settings (direction, session size) | not started |
| Daily practice streaks | done |
| App shell layout (header, sidebar, right panel, footer) | done |
| Theme system (Scholar / Slate / Forest, CSS variables, picker) | done |

---

## Suggested Next Steps

**Recently completed (638 tests passing, 29 test files)**

- Daily practice streaks: migration 010 adds `streak_count`, `last_session_date`, `streak_save_pending` to `credits` table. `StreakService` computes streak state (active / at-risk / lost). `streakRouter` exposes `GET /api/v1/streak` and `POST /api/v1/streak/save`. `SessionService` awards +1 streak credit when the first session of the day extends a streak to ≥ 2 days (no credit for day 1 or after a gap). HomeScreen always shows streak count, warning banner when at-risk, evening warning (≥ 20:00 + last session was yesterday), and save button. SummaryScreen shows +1 streak credit line. `src/api/streakApi.ts` provides typed fetch wrappers.
- Score-based word selection: `score` column on `vocab_entries` (migration 006), backfill migration 008, `srsScore.ts` utility, `sortByScoreThenShuffle` in `srsSelection.ts`. VocabListScreen shows Score column; TrainingScreen shows `[score: N]` debug label.
- Bucket milestone bonus: +100 credits the first time any word globally enters a bucket ≥ 6 that has never existed before. `max_bucket_ever` in credits table (migration 007). `CreditsRepository.getMaxBucketEver/setMaxBucketEver`. `bucketMilestoneBonus` field on `AnswerResult`; TrainingScreen shows celebration message.
- Manually-added word priority: `manuallyAdded: boolean` on `VocabEntry` (migration 009). Words added via the UI "Add word" form are always drawn first in bucket 0 (all of them, overriding the normal 1-or-2 draw count). Flag is cleared after first session inclusion. JSON-imported words are never flagged.

**Phase 7 (continued) — Vocabulary CRUD + Import/Export**

The vocab list screen, add-word form, and hint feature are done. Remaining Phase 7 items:

1. Edit / delete entry — click a row to edit `de`/`en` arrays or delete with confirmation
2. Import JSON — file picker that posts to `POST /api/v1/vocab/import`
3. Export JSON — calls `GET /api/v1/vocab/export` and triggers a file download

---

## Streaks Feature ✓

### Overview

Track daily practice streaks: a consecutive count of days the user has practiced. The feature
rewards consistency and provides a soft safety-net (streak save) when the user skips exactly
one calendar day.

### Rules

All date comparisons are **calendar-day based** (UTC, `YYYY-MM-DD` string equality — no hour
counting). "Yesterday" means the calendar day before today, not "within the last 24 hours".

- **Streak credit**: completing the first session of a calendar day awards +1 credit,
  but only when the resulting streak count is ≥ 2 (i.e. the user also practiced yesterday).
  Starting a brand-new streak (day 1) or resuming after a gap does not award a credit.
- **Streak count display**: always shown on the Home screen.
- **At-risk state** (last session date = the day before yesterday): Home screen shows a warning
  "Your streak is at risk! Save it for 50 credits" with a Save button.
  - Clicking deducts 50 credits and immediately starts a new session.
  - The streak is prolonged (i.e. `last_session_date` is set to yesterday) when the user
    answers the **first question** of that saving session.
- **Lost state** (last session date is older than the day before yesterday): streak resets
  irrevocably to 0; no save option is offered.
- **Streak credit display**: the +1 credit bonus is shown on the session summary screen.

### Data Model

Migration `010_streaks.sql` adds three columns to the `credits` table:

| Column | Type | Description |
|---|---|---|
| `streak_count` | INTEGER NOT NULL DEFAULT 0 | current consecutive-day count |
| `last_session_date` | TEXT (YYYY-MM-DD) | date of the last practice session |
| `streak_save_pending` | INTEGER NOT NULL DEFAULT 0 | 1 while a save-session is in progress |

### Backend Design

- **`CreditsRepository` interface** — add methods:
  - `getStreakCount(): number`
  - `getLastSessionDate(): string | null`
  - `isStreakSavePending(): boolean`
  - `setStreakSavePending(pending: boolean): void`
  - `updateStreak(today: string): void` — increments streak, sets `last_session_date`
- **`SqliteCreditsRepository`** and **`FakeCreditsRepository`** implement the new methods.
- **`StreakService`**:
  - `getStreak(today: string)` — returns `{ streakCount, atRisk, lost }` computed from
    `last_session_date` relative to `today`.
  - `saveStreak()` — validates balance ≥ 50, deducts 50 credits, sets `streak_save_pending = 1`.
- **`streakRouter`**:
  - `GET  /api/v1/streak` — returns current streak info.
  - `POST /api/v1/streak/save` — triggers streak save (calls `StreakService.saveStreak()`).
- **`SessionService.submitAnswer`**: on the very first answer of a session, if
  `streak_save_pending` is true, set `last_session_date` to yesterday and clear the flag.
- **`SessionService` session completion**: if this is the first session of the day, call
  `updateStreak(today)` and add +1 to credits if `newStreak >= 2`; set `AnswerResult.streakCredit`.

### Frontend Design

- **`src/api/streakApi.ts`** — `getStreak()` and `saveStreak()` typed fetch wrappers.
- **`HomeScreen`**:
  - Always displays streak count (e.g. "Streak: 7 days").
  - When `atRisk` is true: shows warning banner and "Save streak (50 credits)" button.
  - When `lost` is true: shows "Streak lost" message (no save option).
- **`SummaryScreen`**: when `streakCredit > 0`, shows "+1 streak credit" line.
- **`TrainingScreen`**: passes `streakCredit` through `onComplete` callback.
- **`App.tsx`**: fetches streak on mount and after each session; wires up save-streak action.

### Implementation Checklist

- [x] Migration 010: add `streak_count`, `last_session_date`, `streak_save_pending` columns to `credits`
- [x] `CreditsRepository` interface: add `getStreakCount`, `getLastSessionDate`, `isStreakSavePending`, `setStreakSavePending`, `updateStreak`
- [x] `SqliteCreditsRepository` and `FakeCreditsRepository` implementations
- [x] `StreakService` with `getStreak(today)` and `saveStreak()`
- [x] `streakRouter`: `GET /api/v1/streak` and `POST /api/v1/streak/save`
- [x] `SessionService.submitAnswer`: streak save bridging on first answer; +1 streak credit on session completion
- [x] `AnswerResult.streakCredit: number` (backend + frontend)
- [x] `src/api/streakApi.ts`
- [x] `HomeScreen`: show streak count and save-streak warning/button
- [x] `HomeScreen`: evening streak warning (≥ 20:00, last session was yesterday) — `isEveningStreakWarning()` in `src/utils/streakWarning.ts`
- [x] `SummaryScreen`: show +1 streak credit
- [x] `TrainingScreen`: pass `streakCredit` to `onComplete`
- [x] `App.tsx`: fetch streak, wire everything together
- [x] Tests for all new/changed components

### Streak Milestones

Reaching certain streak lengths triggers a special reward **instead of** the normal +1 daily credit:

| Milestone | Streak length | Credits |
|-----------|--------------|---------|
| Week 1 | 7 days | 10 |
| 2 Weeks | 14 days | 20 |
| Month 1 | 1 full calendar month | 200 |
| Month 2–11 | each subsequent month | 200 |
| 1 Year (month 12) | 12 full months | 500 |
| Month 13–23 | each subsequent month | 200 |
| 2 Years (month 24) | 24 full months | 1 000 |
| Month 25+ / Year 3+ | monthly 200, every 12th month 1 000 | 200 / 1 000 |

**Week milestones** fire when `streak_count` hits 7 or 14 (and the respective milestone hasn't been awarded yet for this streak).

**Monthly milestone calendar rule:** if the streak started on day 1–7 of a month, that partial month counts as month 1 (reward paid on the last day of that month). If started on day 8+, month 1 is the next full calendar month. All subsequent months must be fully practiced (no unrecovered gaps).

**Year milestones:** month 12 = 500 credits; month 24 and every 12th month thereafter = 1 000 credits.

**Next milestone display:** the home screen streak line shows the next upcoming milestone and how many days away it is, e.g.: `Current streak: 7 days — Next: Month 1 (200 credits) in 14 days`

**Celebration:** when a milestone is reached, the session summary celebrates it prominently (e.g. "Streak milestone: 2 Weeks! +20 credits") instead of the plain daily-streak line.

#### New data columns (migration 011)

| Column | Default | Purpose |
|--------|---------|---------|
| `streak_start_date` | computed from existing data | YYYY-MM-DD of the current streak's first day |
| `streak_weeks_awarded` | 0 | week milestones paid (0, 1, or 2); reset to 0 on streak reset |
| `streak_months_awarded` | 0 | monthly milestones paid; reset to 0 on streak reset |

`updateStreak(count, date)` resets all three columns to their initial values whenever `count = 1` (new or restarted streak).

#### Implementation checklist

- [x] Migration 011: `streak_start_date`, `streak_weeks_awarded`, `streak_months_awarded`
- [x] `shared/utils/streakMilestones.ts` — pure functions: `checkMilestoneReached`, `getNextMilestone`, helpers
- [x] `CreditsRepository` — 5 new methods; `updateStreak` resets milestone counters when `count = 1`
- [x] `SqliteCreditsRepository` + `FakeCreditsRepository` — implement new methods
- [x] `SessionService.submitAnswer` — call `checkMilestoneReached`; award milestone credits (or 1 credit if no milestone); set `milestoneLabel` on result
- [x] `AnswerResult.milestoneLabel?: string` (backend + frontend)
- [x] `StreakService.getStreak` — compute and return `nextMilestone`
- [x] `StreakInfo.nextMilestone` (backend + frontend)
- [x] `HomeScreen` — show `nextMilestone` on the streak line
- [x] `SummaryScreen` — celebrate milestone when `milestoneLabel` is set
- [x] `TrainingScreen` / `App.tsx` — thread `milestoneLabel` through `onComplete` callback
- [x] Tests for all new/changed code
