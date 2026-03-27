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

| Bucket | Group | Review interval | Words per session |
|---|---|---|---|
| 4 | Established | once per 1 day | 0 or 1 |
| 5 | Established | once per 1 week | 0 or 1 |
| 6–9 | Veteran | once per (N − 4) weeks (2–5 weeks) | 0 or 1 |
| 10 | Master | once per 6 weeks | 0 or 1 |
| 11 | Master | once per 8 weeks | 0 or 1 |
| 12–13 | Master | once per 12 weeks | 0 or 1 |
| 14+ | Legend | once per 12 weeks (cap) | 0 or 1 |

A word from bucket 4 is included when at least 1 day has elapsed since `lastAskedAt`.
A word from bucket N (5 ≤ N ≤ 10) is included when at least (N − 4) weeks have elapsed.
Bucket 11 uses an 8-week interval; bucket 12 and above are capped at 12 weeks.
A `null` value (never asked) is treated as always due. At most one word per time-based
bucket appears in any single session. The shared helper `shared/utils/srsInterval.ts`
(`getIntervalMs`) encodes this schedule and is used by both the server selection logic and
the frontend "Due in" display.

**Minimum time to reach a status group** (assuming perfect answers, reviewed exactly when due,
starting from bucket 4):

| Status | Enters at bucket | Min. time from bucket 4 | Approx. |
|--------|-----------------|------------------------|---------|
| Established | 4 | immediately | — |
| Veteran | 6 | 8 days | ~1 week |
| Master | 10 | 106 days | ~15 weeks |
| Legend | 14 | 372 days | ~1 year |

**Session types:**

There are seven session types: `stress`, `normal`, `repetition`, `focus`, `discovery`, `starred`, and `veteran`. The first six are chosen automatically on each `createSession` call using a **shuffled round-robin rotation**:

- `SessionService` maintains a private in-memory sequence of the six automatic types, shuffled with Fisher-Yates at startup and reshuffled each time all six positions have been visited.
- On each `createSession` call the service advances the sequence index, calling `trySelectType()` for the current candidate. If the candidate's eligibility conditions are met, that session type is used. Otherwise the candidate is skipped and the next one in the sequence is tried.
- The sequence is server-side state — it persists across browser refreshes but resets when the server restarts.
- `starred` is never part of the rotation; it is always manually triggered.

**Eligibility conditions per type:**

| Type | Eligible when |
|---|---|
| `stress` | ≥ 10 words in buckets 2+, `stress_session_due_at ≤ today` |
| `discovery` | active pool (buckets 1–4) < `DISCOVERY_POOL_THRESHOLD` (80), ≥ `DISCOVERY_MIN_WORDS` (10) bucket-0 words exist, not already done today (`last_discovery_session_date`) |
| `focus` | ≥ `FOCUS_MIN_WORDS` (10) words with `score ≥ 2` and `bucket` in 1–5 |
| `veteran` | `veteran_session_due_at ≤ today`, ≥ `VETERAN_MIN_BUCKET6_WORDS` (50) in buckets 6+, `selectVeteranWords` returns ≥ `VETERAN_MIN_WORDS` (10) qualifying words (bucket ≥ 6 **and** difficulty ≥ 2) |
| `repetition` | ≥ `REPETITION_MIN_WORDS` (10) due time-based words (buckets 4+) exist |
| `normal` | always eligible (at least one word in vocabulary) |

An optional `shuffleFn` constructor parameter (default: Fisher-Yates) allows tests to inject a deterministic sequence.

*Discovery sessions* — inject new words when the active pool is running low. Default size: **24 words** (`discoverySize` parameter, default 24).
1. Only bucket-0 words are included.
2. Manually added words are drawn first, then regular words; within each group, sorted by score descending (ties shuffled randomly).
3. A **push back** action is available: the user can remove a word from the session and keep it in bucket 0 for a future discovery session. Budget: **10 push-backs per session** (`DISCOVERY_PUSHBACK_BUDGET`). After a push-back the session continues with the next pending word; if no pending words remain the session completes.
4. Wrong answers never deduct credits (`free = true` path in `handleWrongAnswer`).
5. Hints are always free and automatic (bucket 0 auto-hint; no paid button shown).
6. Perfect session bonus: **+100 credits** (instead of the standard +20) when all words are answered correctly with no push-backs.

*Normal sessions* — focus on frequency learning (buckets 0–3 + up to 1 due word per time-based bucket). Described in detail below under "Session size". Default size: **12 words** (`size` parameter, default 12). If the total is still below `sessionSize` after frequency + 1-per-due-bucket selection, two fill-up phases run: first with additional due time-based words (lowest bucket first), then with non-due time-based words (lowest bucket first). Already-selected words are excluded from both phases.

*Repetition sessions* — focus exclusively on reviewing overdue time-based words. Default size: **24 words** (`repetitionSize` parameter, default 24).
1. Only due words from time-based buckets (4+) are included. No fallback to frequency buckets (0–3).
2. Words are selected starting with bucket 4, score-ordered within each bucket (ties shuffled randomly), up to `repetitionSize`.
3. If bucket 4 does not have enough due words, continue with bucket 5, then 6, and so on.
4. If the total due time-based words across all buckets is still less than `REPETITION_MIN_WORDS` (10), the repetition session is skipped (see above). Between 10 and 24 due words, a shorter session is returned with however many are available.

*Focus sessions* — target the words with the highest priority scores to address problem words.
1. Only words from **buckets 1–5** are eligible as primary candidates (bucket 0 and buckets 6+ are excluded — high-bucket words are considered well-learned regardless of their score).
2. Primary candidates: words with `score ≥ 2`, sorted by score descending (ties shuffled randomly). Up to `sessionSize` (default 10) words are taken.
3. If fewer than `FOCUS_MIN_WORDS` (10) primary candidates exist, the focus session is **skipped** in the current rotation cycle.
4. If primary candidates fill fewer than `sessionSize` slots, remaining slots are filled from buckets 1+ words (any score), highest score first, excluding already selected words.

*Stress sessions* — high-stakes timed challenge that fires automatically once a week when trigger conditions are met. No credit balance requirement.
1. **Trigger conditions:** at least `STRESS_MIN_WORDS` (10) words exist in buckets 2+, session is due (`stress_session_due_at ≤ today`). When qualifying words first reach 10 and no stress session has ever been scheduled, the first due date is set to `today + random(0–48 h)`.
2. **Word selection:** `selectStressWords(allEntries, stressSize=24, minWords=10)` — only words in **buckets 2+** are eligible (bucket 0/1 excluded as the user may not know them yet). Selects across three difficulty tiers (each shuffled randomly within the tier):
   - Tier A (up to 8): difficulty ≥ 4
   - Tier B (up to 8): difficulty ≥ 2, excluding tier A picks
   - Tier C (remaining slots up to 24): any bucket-2+ word, excluding prior picks
   Words are drawn regardless of due status. Unfilled tier slots carry forward to tier C.
3. **No hints:** the hint button is hidden for the entire session.
4. **Second-chance words:** a wrong answer on a time-based word inserts a second-chance word, identical to normal sessions. The countdown timer resets for each new question including second-chance questions.
5. **Time limit per question:** 15 seconds when only one answer field is shown; 25 seconds when two fields are shown. The timer resets on each new word. When it expires, whatever is typed is auto-submitted (empty fields count as wrong).
6. **Scoring — two modes, determined once at session start by the current balance:**
   - *High-stakes mode (balance ≥ 500):* `fee = floor(500 / sessionSize)` rounded down to the nearest even number (max session size 24 → fee = 20). Wrong/timed out: deduct `fee` credits, reset to bucket 1. Partially correct: deduct `fee / 2`, stay in current bucket.
   - *Standard mode (balance < 500):* Wrong/timed out: deduct 1 credit, reset to bucket 1. Partially correct: free, stay in current bucket.
   - Fully correct (both modes): no credit cost; word promoted one bucket if due.
7. **Credit earning:** +5 credits when a word is promoted into a new personal highest bucket (`bucket > maxBucket`), same as any other session. **+100 credit bonus** for a perfect session (every answer fully correct, no partials, no timeouts, no second-chance words triggered).
8. **Scheduling:** after the session completes (regardless of outcome), the next due date is set to `today + 6 days + random(0–48 h)`.
9. **Counts toward daily streak** like any other session type.
10. **Summary screen:** a dedicated `StressSummaryScreen` shows correct/wrong counts, credits gained or lost, and the perfect bonus if applicable.

*Veteran sessions* — periodic review of mastered words (buckets 6+), firing automatically roughly once a week.
1. **Trigger conditions:** at least `VETERAN_MIN_BUCKET6_WORDS` (50) words exist in buckets 6+, and `veteran_session_due_at ≤ today`. When the bucket-6+ count first reaches 50 and no veteran session has ever been scheduled, the first due date is set to `today + random(0–48 h)`.
2. **Word selection:** `selectVeteranWords(allEntries, sessionSize, VETERAN_MIN_WORDS)` — filters bucket ≥ 6 **and** difficulty ≥ 2, sorts by difficulty descending (ties shuffled randomly). Returns null if fewer than `VETERAN_MIN_WORDS` (10) words qualify.
3. **SRS promotion rules:** same as focus sessions — due words (time-based bucket, `lastAskedAt + interval ≤ now`) are promoted one bucket; non-due words are not promoted.
4. **Scheduling:** after the session completes (any outcome), the next due date is set to `today + VETERAN_INTERVAL_DAYS (6) + random(0–48 h)`.
5. **Counts toward daily streak** like any other session type.

*Starred sessions* — on-demand review of all words the user has starred (★), triggered manually via the "Start ★ session" button on the Home screen.
1. All words with `marked = true` are included, capped at **100**.
2. Words are sorted by score descending (ties shuffled randomly) — the trickiest starred words come first.
3. SRS promotion rules mirror focus sessions: time-based words (bucket 4+) that are not yet due are not promoted.
4. `last_starred_session_date` is recorded when the session **completes**. Only one starred session per calendar day.
5. The button is disabled when: no marked words exist, a starred session was already completed today, or another session is currently in progress (has at least one answered word).
6. An unstarted open session (0 answered words) is automatically discarded before the starred session is created.

`createStarredSession(direction)` in `SessionService` handles all of the above. `getStarredSessionAvailable()` exposes availability state to the frontend.

The session title shown in the UI reflects the type: **"Learning Session"** for normal, **"Repetition Session"** for repetition, **"Focus Session"** for focus, **"Discovery Session"** for discovery, **"Stress Session"** for stress, **"Starred Session"** for starred, **"Veteran Session"** for veteran.

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
- **Partial answer** → word stays in its current bucket; `lastAskedAt` set to now (except for non-due time-based words — see below).
  No second-chance word is drawn, even for time-based buckets.

**Promotion and demotion — frequency-based buckets (0–3):**
- Correct answer → word moves to `bucket + 1`; `lastAskedAt` set to now
- Partial answer → word stays in its current bucket; `lastAskedAt` set to now
- Fully wrong answer → word is reset to `bucket 1`; `lastAskedAt` set to now

Bucket 0 is reserved for words that have never been seen. A wrong answer never sends a word back to bucket 0.

**Promotion and demotion — time-based buckets (4+):**

A **correct** answer on a time-based word only promotes the word if it is currently **due**
(`elapsed ≥ interval`). If the word is not yet due (e.g. it was included in a focus session
ahead of schedule), the bucket is left unchanged and `lastAskedAt` is **not updated** — the
SRS schedule is left entirely intact so the user is not penalised for an incidental early review.

A **partial** answer on a non-due time-based word follows the same rule: the bucket is left
unchanged and `lastAskedAt` is **not updated**. (For due time-based words and all frequency
buckets, a partial answer still sets `lastAskedAt` to now as usual.)

A **fully wrong** answer on a time-based word triggers a second-chance flow:

1. The user is warned that the answer was wrong.
2. A second word (word 2) is selected from the full vocabulary (all words not already in the
   session). Candidates are scored by `difficulty * 2 + bucket` (difficulty weighted 2× over
   bucket so intrinsically hard words outrank mere high-bucket words). Candidates are sorted
   descending by this score and a **top tier** is formed — whichever is larger: the top 5
   candidates or the top 25% of the pool. Word 2 is picked at random from that top tier, so
   the selection is biased toward difficult/high-scored words without being fully deterministic.
   If no eligible candidates exist, no second-chance word is inserted and word 1 is demoted
   immediately.
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
| Session type selection (shuffled round-robin: stress, discovery, focus, veteran, repetition, normal) | `sessionService.ts` — `createSession()` | ✓ complete |
| Stress session word selection | `srsSelection.ts` — `selectStressWords()` | ✓ complete |
| Push back word (discovery sessions only) | `sessionService.ts` — `pushBackWord()` | ✓ complete |
| Bucket promotion / demotion | `server/features/session/sessionService.ts` | ✓ complete |
| Second-chance flow | `sessionService.ts` — `handleWrongAnswer()` / `handleCorrectAnswer()` | ✓ complete |
| Persistence (`bucket` + `lastAskedAt`) | `server/db/SqliteVocabRepository.ts` — `update()` | ✓ complete |

**Test gaps: closed ✓**
- `lastAskedAt` is asserted to be non-null after a correct answer (frequency bucket and time bucket tests).
- Correct first-attempt answer on a time-based word (bucket ≥ 4) is now explicitly tested with outcome `"correct"` and bucket promotion.

### Credit System

The user earns credits each time a word reaches a new personal highest bucket for the first time:

- **All buckets:** +5 credits per bucket level.
- If a word falls back and climbs to the same bucket again, **no additional credit** is awarded — each bucket level is counted only once per word.

**Storage:** The balance is kept as a single integer in the `credits` table (migration `004_credits.sql`), incremented whenever a word's `maxBucket` increases. The delta per promotion is always 5. This counter is also updated during bulk import when imported entries carry `bucket > 0`.

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

**Session cost:** **1 credit is deducted immediately per incorrectly answered word** (including second-chance words), at the moment the wrong answer is submitted — mirroring how credits are earned immediately for correct answers. If the balance is 0 the deduction is skipped — the balance never goes negative. The session summary shows credits earned, credits spent on hints, and the total session cost (accumulated wrong-answer deductions). **Exceptions — wrong answers are free for:**
- **Discovery sessions** — entirely free, no credit deductions.
- **Virgin words** — a word is virgin when `entry.bucket <= 1 && entry.maxBucket <= 1` (never reached bucket 2 or above). Once a word has ever climbed higher, it is no longer virgin and wrong answers cost the usual 1 credit, even if the word has since fallen back.

**New-bucket milestone bonus:** A scaling bonus is awarded the first time any word is promoted into a bucket that has never existed before, subject to two conditions:
1. The new bucket number is ≥ 6.
2. The bucket number exceeds `max_bucket_ever` — a global high-water mark stored in the `credits` table (migration `007_bucket_milestone.sql`) that tracks the highest bucket ever reached across all words. It never decreases.

The bonus scales linearly and is capped at 500: **bucket N → min((N−5)×100, 500) credits** (bucket 6 = +100, bucket 7 = +200, …, bucket 10+ = +500).

The bonus fires at most once per bucket level: if bucket 6 becomes empty again after a wrong answer and a different word later climbs into bucket 6, no second bonus is paid. The `bucketMilestoneBonus` field on `AnswerResult` carries the amount (0 or the scaled value) so the UI can display a celebration message.

**Perfect session bonus:** Awarded when a session is completed without any mistakes, second-chance words, or hints. The bonus amount depends on session type:
- **Normal / repetition / focus / veteran / starred:** **+20 credits.**
- **Discovery:** **+100 credits** — all words must be answered correctly with no push-backs (a `pushed_back` word counts as non-correct and disqualifies the bonus).
- **Stress:** **+100 credits** — all answers must be fully correct (no partials, no timeouts, no second-chance words triggered). New-bucket-record bonuses (+5) also apply in stress sessions.

All conditions that must hold (except discovery, which has no second-chance words or paid hints; and stress, which has no hints):
1. Every word in the session was answered correctly (no `'incorrect'` or `'pushed_back'` status).
2. No second-chance words were triggered (no word has `secondChanceFor` set). *(Not applicable to discovery sessions.)*
3. The hint button was not clicked even once during the session. *(Hints are unavailable in stress sessions.)*

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
| Bucket milestone bonus (first time any word enters a never-seen bucket ≥ 6; min((N−5)×100, 500), capped at 500) | done |
| Manually-added word priority (`manuallyAdded` flag, migration 009, always drawn first in bucket 0) | done |
| Vocabulary edit / delete UI | not started |
| Import / Export UI | not started |
| Settings (direction, session size) | not started |
| Daily practice streaks | done |
| App shell layout (header, sidebar, right panel, footer) | done |
| Theme system (Scholar / Slate / Forest, CSS variables, picker) | done |
| Starred session (once-per-day session for all marked words, up to 100, score-sorted) | done |
| Earned stars (+1 star when any word globally first enters Established/Veteran/Master/Legend, additive) | done |
| Language-neutral rename (de/en → source/target throughout code and DB) | planned |

---

## Suggested Next Steps

**Recently completed (638 tests passing, 29 test files)**

- Daily practice streaks: migration 010 adds `streak_count`, `last_session_date`, `streak_save_pending` to `credits` table. `StreakService` computes streak state (active / at-risk / lost). `streakRouter` exposes `GET /api/v1/streak` and `POST /api/v1/streak/save`. `SessionService` awards +1 streak credit when the first session of the day extends a streak to ≥ 2 days (no credit for day 1 or after a gap). HomeScreen always shows streak count, warning banner when at-risk, evening warning (≥ 20:00 + last session was yesterday), and save button. SummaryScreen shows +1 streak credit line. `src/api/streakApi.ts` provides typed fetch wrappers.
- Score-based word selection: `score` column on `vocab_entries` (migration 006), backfill migration 008, `srsScore.ts` utility, `sortByScoreThenShuffle` in `srsSelection.ts`. VocabListScreen shows Score column; TrainingScreen shows `[score: N]` debug label.
- Bucket milestone bonus: min((N−5)×100, 500) credits the first time any word globally enters a bucket ≥ 6 that has never existed before (capped at 500 from bucket 10 / Master onwards). `max_bucket_ever` in credits table (migration 007). `CreditsRepository.getMaxBucketEver/setMaxBucketEver`. `bucketMilestoneBonus` field on `AnswerResult`; TrainingScreen shows celebration message.
- Manually-added word priority: `manuallyAdded: boolean` on `VocabEntry` (migration 009). Words added via the UI "Add word" form are always drawn first in bucket 0 (all of them, overriding the normal 1-or-2 draw count). Flag is cleared after first session inclusion. JSON-imported words are never flagged.

- Word difficulty score: a permanent `difficulty` field on `VocabEntry` (migration `025_difficulty.sql` adds `max_score` and `difficulty` columns, backfilled from existing data). Formula: `spaceBonus + multipleBonus + lengthBonus + maxScore`, where `maxScore` is the all-time highest priority score. `computeDifficulty()` in `shared/utils/difficulty.ts`. Recomputed in `VocabService` (create, update, import, setMarked) and `SessionService` (answer submit). `VocabListScreen` shows a Difficulty column in every table.

**Recently added**

- Starred session: a new on-demand session type (`type = 'starred'`) that includes all marked (★) words, capped at 100, score-sorted. Accessible via a second button on the Home screen. Limited to one per calendar day; `last_starred_session_date` in the credits table. Migration `018_starred_session.sql` adds the column; migration `019_session_type_starred.sql` rebuilds the sessions table to add `'starred'` to the type CHECK constraint.
- Earned stars: a persistent counter (`earned_stars INTEGER` in the credits table, migration `020_earned_stars.sql`) displayed as amber ★ characters in the header. Stars only ever increase. Awarded as **+1 star** when any word globally first enters a named group boundary (Established b4, Veteran b6, Master b10, Legend b14), tracked via `max_bucket_ever`. Uses `CreditsRepository.addStars(1)` (additive).

  | First word ever enters | Stars |
  |---|---|
  | Established (bucket 4) | +1 |
  | Veteran (bucket 6) | +1 |
  | Master (bucket 10) | +1 |
  | Legend (bucket 14) | +1 |
- Buy stars: users can purchase cosmetic earned-stars for 500 credits each (max 3 per offer). A `StarsPurchaseDialog` pops up automatically on the Home screen when the balance ≥ 500, the feature is not paused, and the snooze period has expired. Any interaction (buy, No, Cancel) snoozes the offer for 7 days. Migration `023_stars_offer_snooze.sql` adds `stars_offer_snoozed_until TEXT` to the credits table. `StarsService` handles offer logic, purchase validation, and snooze. `starsRouter` exposes `GET /api/v1/stars/offer`, `POST /api/v1/stars/purchase`, and `POST /api/v1/stars/snooze`.

**Planned — Language-neutral rename (de/en → source/target)**

The codebase currently has German/English hardcoded throughout. This refactoring makes the trainer language-agnostic. It is purely mechanical — no logic changes.

*Scope (~40 files):*

1. **DB migration** (`021_source_target.sql`) — two steps:
   - `ALTER TABLE vocab_entries RENAME COLUMN de TO source` and `RENAME COLUMN en TO target` (SQLite ≥ 3.25 supports this directly)
   - Rebuild the `sessions` table to change the CHECK constraint from `('DE_TO_EN', 'EN_TO_DE')` to `('SOURCE_TO_TARGET', 'TARGET_TO_SOURCE')` and `UPDATE` existing rows to the new values

2. **Shared types**
   - `VocabEntry`: fields `de` → `source`, `en` → `target`; update JSDoc
   - `SessionDirection`: `'DE_TO_EN' | 'EN_TO_DE'` → `'SOURCE_TO_TARGET' | 'TARGET_TO_SOURCE'`; update type guard in `isSession()`

3. **Backend — server/**
   - `SqliteVocabRepository.ts`: all SQL column references
   - `vocabService.ts`: field references, docstrings (124 occurrences of the direction enum across backend alone)
   - `sessionService.ts`, `answerValidation.ts`, `srsSelection.ts`: direction comparisons
   - `vocabSchemas.ts`, `sessionSchemas.ts`: Zod field names and enum values
   - All corresponding test files

4. **Frontend — src/**
   - `VocabListScreen.tsx`: column headers "German" → "Source", "English" → "Target"; CSS class names `.colDE`/`.colEN` → `.colSource`/`.colTarget`
   - `AddWordForm.tsx`: field names, UI labels, error message text
   - `TrainingScreen.tsx`: direction comparisons and field accesses
   - `sessionApi.ts`, `vocabApi.ts`: request/response field names and types
   - All corresponding test files

5. **Import/export format — breaking change**
   - The JSON export format changes from `{ de, en, bucket }` to `{ source, target, bucket }`
   - `bootstrap-vocabulary.json` and any user-created import files must be updated
   - Mention the format change in the import guide (`scripts/IMPORT-VOCAB.md`)

*Migration checklist:*
- [ ] Migration `021_source_target.sql`
- [ ] `shared/types/VocabEntry.ts` — fields renamed
- [ ] `shared/types/Session.ts` — `SessionDirection` values renamed
- [ ] `server/db/SqliteVocabRepository.ts` — SQL queries
- [ ] `server/features/vocab/vocabService.ts` — field refs + docstrings
- [ ] `server/features/session/sessionService.ts` — direction comparisons
- [ ] `server/features/session/answerValidation.ts` — direction comparisons
- [ ] `server/features/session/srsSelection.ts` — direction comparisons
- [ ] `server/validation/vocabSchemas.ts` — Zod schema field names
- [ ] `server/validation/sessionSchemas.ts` — Zod schema direction enum
- [ ] `server/db/SqliteSessionRepository.ts` — direction value references
- [ ] All backend test files (fake repos, service tests, router tests)
- [ ] `src/screens/VocabListScreen.tsx` + CSS — column headers and class names
- [ ] `src/screens/AddWordForm.tsx` — labels and error message
- [ ] `src/screens/TrainingScreen.tsx` — direction comparisons and field access
- [ ] `src/api/sessionApi.ts`, `src/api/vocabApi.ts` — types and field names
- [ ] All frontend test files
- [ ] `bootstrap-vocabulary.json` — rename all `de`/`en` keys
- [ ] `scripts/IMPORT-VOCAB.md` — update format documentation
- [ ] `server/db/database.test.ts` — update migration count

## Focus Replay ✓

After completing a focus session with enough errors, the session summary screen offers the user up to **two** chances to replay the same session.

**Trigger conditions:**
- The completed session is of type `focus`
- **Replay 1** (after original session): error rate ≥ 25% — `(wrong + partial answers) / total words >= 0.25` (e.g. 3 or more errors in a 12-word session)
- **Replay 2** (after Replay 1): at least 1 answer in Replay 1 was wrong or partial
- No further replay is offered after Replay 2

**The offer:**
- Displayed on the **session summary screen**, below the regular summary content — a clearly visible prompt and a single "Play again" button
- If the user declines (or navigates away), the offer is gone permanently for that session
- The shuffle rotation is unaffected either way — it continues normally from wherever it left off

**The replay session:**
- Contains the **exact same words** as the original, but **reshuffled** (random new order)
- Stored as a plain `focus` session — no special marker or flag
- Treated as a fully independent new session: earns credits, perfect bonus, bucket promotions, and streak credit exactly as any other session would (streak +1 only fires if it is the first session of that calendar day)

**Implementation:**
- `SummaryScreen`: computes the error rate from the completed session's word list (original words only, second-chance words excluded). The `replayCount` prop (passed through `App.tsx` training → summary state) tracks how many replays have already been played: `0` = original session, `1` = after Replay 1, `2` = after Replay 2. The offer is shown only when appropriate for the current `replayCount`.
- `POST /api/v1/session/:id/replay` endpoint in `sessionRouter.ts` → `SessionService.createReplaySession(originalSessionId)`: looks up the completed focus session, excludes second-chance words, reshuffles the vocab IDs, inserts a new open `focus` session.
- `createReplaySession(sessionId)` in `sessionApi.ts` calls the endpoint.
- No new `SessionType` value — replay sessions are plain `focus`.
- No DB migration needed.

---

## Breakthrough Session ✓

A session type that concentrates on words that are **one correct answer away from a bucket milestone** — promoting them efficiently in a single focused run.

**Trigger conditions (all must be met):**
- At least **5 qualifying words** exist (across all three pool categories below)
- Part of the **shuffle rotation** alongside the other automatic session types
- Fires at most **once per week** (6 days base + 0–48 h random jitter ≈ ±1 day), same scheduling pattern as veteran sessions

**Word pool — three categories, deduplicated into a flat pool first:**
1. **Bucket 3 words** — one step from entering the time-based SRS system (bucket 4). Always eligible regardless of due date (frequency bucket).
2. **Bucket 5 words that are due** — one step from veteran territory (bucket 6). Only due words are included; non-due words cannot be promoted.
3. **Words in the current highest occupied bucket that are due** (if time-based) or unconditionally (if frequency) — one step from setting a new personal `maxBucket` record, earning 5 credits + a star (if bucket ≥ 4) + potential bucket-milestone bonus.

Deduplication: a word that falls into more than one category (e.g. highest bucket is 5 and it is due) is counted once, assigned to the first matching category for distribution purposes.

**Word selection:**
- Session size: up to **24 words**.
- Slots are distributed **proportionally** by the relative size of each category within the flat pool — matching the bucket 1–3 distribution logic in normal sessions.
- Within each category, words are sorted by score descending (ties broken randomly).

**SRS promotion rules:** same as normal/focus sessions — correct answer promotes by one bucket; due time-based words are promoted; non-due are not (though non-due words only reach this pool via category 1, where due-ness is not a requirement).

**Session title in UI:** "Breakthrough Session"

**Implementation notes:**
- Added `SessionType` value `'breakthrough'` to `shared/types/Session.ts`; updated `isSession()` guard
- Added `selectBreakthroughWords(allEntries, sessionSize, minWords, now)` to `srsSelection.ts` with three-category deduplication and proportional slot allocation
- `BreakthroughSessionService` in `breakthroughSessionService.ts` handles `isAvailable`, `scheduleFirst` (within 48 h), and `scheduleNext` (6 days + 0–48 h random)
- Added `breakthrough_session_due_at` column to the `credits` table (migration `030_breakthrough_session.sql`)
- Added `getBreakthroughSessionDueAt`/`setBreakthroughSessionDueAt` to `CreditsRepository`, `SqliteCreditsRepository`, and `FakeCreditsRepository`
- Added `'breakthrough'` to `SHUFFLED_TYPES` and implemented the case in `trySelectType()` in `sessionService.ts`; `scheduleFirst` triggered from `createSession`; `scheduleNext` called on session completion
- `TrainingScreen`: added "Breakthrough Session" label to the session title area

---

## Second Chance Session ✓

A new session type that gives words a structured second opportunity after passing the in-session second-chance flow. The existing "second chance" mechanics inside a session are also modified.

### Change to the existing second-chance flow

When a time-based word (bucket 4+) is answered wrong, a second-chance word (W2) is inserted. The outcome now changes as follows:

| W2 outcome | Old W1 result | New W1 result |
|---|---|---|
| Fully correct | bucket N−1 | bucket 1.5 (see below) |
| Incorrect | bucket 1 | bucket 1 (unchanged) |
| Partial | bucket 1 | bucket 1 (unchanged) |

### Bucket 1.5 — second chance bucket

When W1 enters bucket 1.5:
- Its integer `bucket` field is preserved at N (the bucket it was in before the wrong answer).
- A new `secondChanceDueAt` timestamp is written: `max(next calendar day 00:00 UTC, now + 12 h)`.
- W1 is excluded from all regular session types until resolved.
- The vocabulary list page shows these words in a dedicated **"Second Chance (pending)"** section.
- No separate `restoreBucket` field is needed — the preserved `bucket = N` serves as the restore target.

### Second Chance Session

**Trigger (checked before the regular rotation):**
- At least 1 bucket-1.5 word is due (`now >= secondChanceDueAt`)
- No second chance session has been played today (tracked via `lastSecondChanceSessionDate` in the credits table)

**Priority:** Highest — fires before Stress, Discovery, Focus, Veteran, Breakthrough, Repetition, and Normal.

**Word pool:** All due bucket-1.5 words (up to 24), sorted by score descending, ties broken randomly.

**No hints** — auto-hint and paid-hint are both disabled.

**Answer outcomes:**
- Fully correct → `bucket` stays at N, `secondChanceDueAt` cleared. Word is fully restored.
- Incorrect or partially correct → `bucket` set to 1, `secondChanceDueAt` cleared.

**Daily limit:** At most one per calendar day. After completion, `lastSecondChanceSessionDate` is set to today; the next session is earliest the following day.

**Session title in UI:** "Second Chance Session"

**Implementation notes:**
- New `VocabEntry` field: `secondChanceDueAt: string | null`
- New DB migration: `ALTER TABLE vocab_entries ADD COLUMN second_chance_due_at TEXT;`
- New DB migration: `ALTER TABLE credits ADD COLUMN last_second_chance_session_date TEXT;`
- New `SessionType` value: `'second_chance_session'`; update `isSession()` guard
- New `selectSecondChanceSessionWords(all, sessionSize, now)` in `srsSelection.ts`
- All existing selection functions receive a pre-filtered list (words with `secondChanceDueAt !== null` excluded)
- `SecondChanceSessionService` in `secondChanceSessionService.ts`: `isAvailable(today, allEntries, now)`, `scheduleCompletion(today)`, `calcDueAt(now): string`
- Modify `submitAnswer` in `sessionService.ts`: on `second_chance_correct` outcome, set `secondChanceDueAt` instead of demoting W1 to bucket N−1
- Add `second_chance_session` case to `trySelectType`, checked before the round-robin loop
- `VocabListScreen`: add "Second Chance (pending)" section above the bucket list for words with `secondChanceDueAt !== null`
- `TrainingScreen`: show "Second Chance Session" label; disable hint button for this session type
- `CreditsRepository` / `SqliteCreditsRepository` / `FakeCreditsRepository`: add `getLastSecondChanceSessionDate` / `setLastSecondChanceSessionDate`
- `VocabRepository` / `SqliteVocabRepository`: add `setSecondChanceDueAt(id, dueAt, bucket)` or handle via existing `update()`

---

## Recovery Session ✓

A session type that targets words which were once well-learned but have since regressed — words the player used to know but has apparently forgotten again. The goal is to recover that lost knowledge through focused re-consolidation.

**Eligibility (per word — both conditions must hold):**
- `maxBucket ≥ 6` — the word once reached veteran territory, meaning it was genuinely mastered
- `maxBucket − bucket ≥ 2` — it has since fallen back by at least 2 full bucket levels

Example: a word that peaked at bucket 6 and now sits at bucket 2 qualifies (gap = 4). A word that peaked at bucket 4 and is now at bucket 3 does not (gap = 1, not enough regression). A word that peaked at bucket 3 does not qualify at all (maxBucket too low — early-learning noise, not a real regression).

**Trigger conditions (all must be met):**
- At least **5 qualifying words** exist
- Part of the **shuffle rotation** alongside the other automatic session types

**Word selection:**
- Draw from all qualifying comeback candidates, **regardless of due date** — the point is targeted recovery, not SRS scheduling
- Session size: up to **12 words**
- Sort by **gap descending** (`maxBucket − bucket`) as primary criterion — biggest regressions first; then by **score descending** as tiebreaker
- If more than 12 candidates exist, take the 12 highest-ranked

**Session mechanics:** identical to a normal session — hints available, second-chance flow applies for time-based wrong answers, same credit rules.

**Session title in UI:** "Recovery Session"

**Implementation notes:**
- New `SessionType` value: `'recovery'`
- New `selectRecoveryWords(allEntries, sessionSize, minWords)` in `srsSelection.ts`
- Add to `SHUFFLED_TYPES` constant and `trySelectType()` in `sessionService.ts`
- New DB migration to add `'recovery'` to the sessions type CHECK constraint
- `TrainingScreen`: show "Recovery Session" label in the session title area

**To-do:**
- [x] `shared/types/Session.ts`: add `'recovery'` to the `SessionType` union
- [x] `srsSelection.ts`: implement `selectRecoveryWords()` with gap + score sorting
- [x] `SessionService.createSession()`: add recovery check to `trySelectType()`
- [x] `SessionService` tests for recovery word selection and trigger threshold
- [x] New DB migration for `'recovery'` type CHECK constraint
- [x] `TrainingScreen`: display "Recovery Session" label

---

**Phase 7 (continued) — Vocabulary CRUD + Import/Export**

The vocab list screen, add-word form, and hint feature are done. Remaining Phase 7 items:

1. Edit / delete entry — click a row to edit `source`/`target` arrays or delete with confirmation
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

---

## Stress Session Feature

### Overview

A high-stakes timed session type that fires automatically at most once per week when qualifying words exist. No credit balance requirement. The session challenges the user under time pressure, deducting credits for wrong or partial answers and awarding a +100 bonus for a perfect run. Second-chance words apply as in normal sessions.

### Trigger Conditions

- At least `STRESS_MIN_WORDS` (10) words exist in buckets 2+.
- `stress_session_due_at` (YYYY-MM-DD UTC) is ≤ today.

**First trigger:** when qualifying words first reach 10 and `stress_session_due_at` is still null, it is set to `today + random(0–48 h)`.

The trigger is checked inside `createSession()` as part of the normal round-robin rotation.

### Session Rules

- **Size:** up to 24 words (`stressSize = 24`), drawn from buckets 2+ using three difficulty tiers (bucket 0/1 excluded); words are selected regardless of due status.
- **No hints:** the hint button is hidden for the entire session.
- **Second-chance words:** a wrong answer on a time-based word inserts a second-chance word, identical to normal sessions. The countdown timer resets for each new question including second-chance questions.
- **Time limit per question:** 15 s (one answer field) / 25 s (two answer fields). The timer resets on each new word. Expiry auto-submits whatever is typed; empty fields count as fully wrong.

### Scoring

Fee mode is determined **once at session start** based on the balance at that moment.

*High-stakes mode (balance ≥ 500 at session start):*

| Outcome | Credit effect | Bucket effect |
|---|---|---|
| Fully correct | none (or +5 if new bucket record) | promoted one bucket if due; unchanged if not yet due |
| Partially correct | −½ × fee | stays in current bucket |
| Wrong or timed out | −1 × fee | reset to bucket 1 |

**Per-answer fee:** `floor(500 ÷ sessionSize)` rounded down to the nearest even number. For the maximum session size of 24: fee = 20 credits (10 for partial).

*Standard mode (balance < 500 at session start):*

| Outcome | Credit effect | Bucket effect |
|---|---|---|
| Fully correct | none (or +5 if new bucket record) | promoted one bucket if due; unchanged if not yet due |
| Partially correct | free | stays in current bucket |
| Wrong or timed out | −1 credit | reset to bucket 1 |

**New-bucket-record bonus:** +5 credits when a word is promoted into a new personal highest bucket (`bucket > maxBucket`), same as any other session.

**Perfect session bonus:** +100 credits if every answer is fully correct (no partials, no timeouts, no second-chance words triggered).

### Scheduling

After each stress session completes (any outcome), the next due date is set to `today + 6 days + random(0–48 h)`.

### Data Model

Migration `024_stress_session.sql` adds one column to the `credits` table:

| Column | Type | Description |
|---|---|---|
| `stress_session_due_at` | TEXT (YYYY-MM-DD) | next eligible date for a stress session; null = not yet scheduled |

### Backend Design

- **`CreditsRepository`** — two new methods: `getStressSessionDueAt(): string | null`, `setStressSessionDueAt(date: string | null): void`.
- **`SqliteCreditsRepository`** + **`FakeCreditsRepository`** — implement the new methods.
- **`StressSessionService`** (new file `server/features/session/stressSessionService.ts`):
  - `isAvailable(today, qualifyingWordCount)`: returns true when all trigger conditions are met (no balance check).
  - `scheduleNext(today)`: sets `stress_session_due_at` to `today + 6 days + random 0–48 h`.
  - `scheduleFirst(today)`: sets `stress_session_due_at` to `today + random 0–48 h` (used when qualifying words first reach 10).
- **`SessionService`** modifications:
  - `createSession()`: stress is part of the normal round-robin rotation; fee mode (high-stakes vs standard) stored on the session based on balance at creation time.
  - `submitAnswer()` for stress sessions: apply fee based on stored mode for wrong/partial; second-chance flow identical to normal sessions; award +5 new-bucket-record bonus; call `scheduleNext` on session completion; award +100 perfect bonus if applicable.
  - `shared/types/Session.ts`: add `'stress'` to the `SessionType` union.
- **`sessionRouter`** — no new routes needed; stress session uses the same `POST /api/v1/session` and `POST /api/v1/session/:id/answer` as all other session types.

### Frontend Design

- **`TrainingScreen`**: detect `session.type === 'stress'`:
  - Show countdown timer (15 s or 25 s depending on field count). Timer resets on each new word.
  - Display live credit balance prominently.
  - Hide hint button.
  - On timer expiry: auto-submit with whatever is currently typed.
- **`StressSummaryScreen`** (new screen): shown after a stress session completes (instead of the regular `SummaryScreen`). Displays correct/partial/wrong counts, total credits lost, and the perfect-session bonus if earned.
- **`App.tsx`**: route to `StressSummaryScreen` when session type is `'stress'`.

### Implementation Checklist

- [x] Migration `024_stress_session.sql`: add `stress_session_due_at TEXT` to `credits`
- [x] Migration `033_stress_session_update.sql`: add `stress_high_stakes INTEGER` to `sessions`
- [x] `CreditsRepository`: add `getStressSessionDueAt()`, `setStressSessionDueAt()`
- [x] `SqliteCreditsRepository` + `FakeCreditsRepository`: implement new methods
- [x] `shared/types/Session.ts`: add `'stress'` to `SessionType`; add `stressHighStakes?: boolean`
- [x] `StressSessionService`: `isAvailable()`, `scheduleNext()`, `scheduleFirst()`; unit tests
- [x] `SessionService.createSession()`: stress in round-robin rotation; `stressHighStakes` set at session start
- [x] `SessionService.submitAnswer()`: fee mode from `stressHighStakes`; second-chance flow; +5 bucket-record credit; +100 perfect bonus
- [x] `SessionService` tests for stress scoring
- [x] `srsSelection.ts`: `selectStressWords()` — three difficulty tiers from full vocabulary
- [x] `TrainingScreen`: countdown timer, live balance, hidden hints, second-chance display
- [x] Tests for all new/changed code

---

## Buy Stars Feature ✓

### Overview

Users can spend credits to purchase cosmetic prestige stars. The offer dialog appears automatically once the credit balance reaches ≥ 500 and is snoozed for 7 days after any interaction (purchase, decline, or abort) to avoid being intrusive.

### Rules

- **Cost:** `STAR_COST_CREDITS` = 500 credits per star.
- **Cap per offer:** `MAX_STARS_PER_OFFER` = 3 stars — the user can buy 1–3 stars in a single dialog interaction.
- **maxBuyable:** `min(floor(balance / 500), 3)` — limited by what the balance can afford.
- **Suppression:** the offer is not shown when:
  - balance < 500
  - the game is paused
  - the offer was snoozed (`stars_offer_snoozed_until` > today)
- **Snooze duration:** `STARS_OFFER_SNOOZE_DAYS` = 7 days, set on any interaction.

### Data Model

The `credits` table stores the snooze date:

| Column | Type | Description |
|---|---|---|
| `stars_offer_snoozed_until` | TEXT (YYYY-MM-DD) | offer suppressed until this date; null = not snoozed |

`earned_stars INTEGER` (added in migration `020_earned_stars.sql`) holds the persistent star count; `addStars(n)` increments it and never decreases it.

### Backend Design

- **`StarsService`** (`server/features/stars/StarsService.ts`):
  - `getOffer(today)`: returns `{ shouldOffer, maxBuyable, costPerStar }`.
  - `purchaseStars(count, today)`: deducts `count × 500` credits, adds `count` stars, snoozes for 7 days. Throws on invalid count or insufficient credits.
  - `snooze(today)`: records the snooze without a purchase (decline / abort).
- **`CreditsRepository`**: `getStarsOfferSnoozedUntil()`, `setStarsOfferSnoozedUntil()`, `addStars()`, `getEarnedStars()`.
- **`starsRouter`** (`server/features/stars/starsRouter.ts`): `GET /api/v1/stars/offer`, `POST /api/v1/stars/purchase`, `POST /api/v1/stars/snooze`.

### Frontend Design

- After a session completes, `SummaryScreen` calls `getStarsOffer()` and displays the buy-stars dialog when `shouldOffer` is true.
- The dialog shows the cost per star and lets the user choose how many to buy (up to `maxBuyable`), or decline.
- On purchase or decline/abort, the snooze endpoint is called so the offer disappears for 7 days.

---

## Veteran Session Feature

### Overview

A periodic automatic review of fully-mastered words (buckets 6+), firing roughly once a week when the user has built up a sufficient veteran vocabulary. Unlike stress sessions there is no credit pressure — the session uses the same SRS promotion rules as focus sessions.

### Trigger Conditions

- At least `VETERAN_MIN_BUCKET6_WORDS` (50) words exist in buckets 6+.
- `veteran_session_due_at` (YYYY-MM-DD UTC) is ≤ today.

**First trigger:** when the bucket-6+ count first reaches 50 and `veteran_session_due_at` is still null, it is set to `today + random(0–48 h)`. This ensures the first veteran session fires within two days of the user becoming eligible.

The trigger is checked inside `createSession()` via the shuffled round-robin rotation; veteran is eligible whenever its due date and word-count conditions are met.

### Session Rules

- **Size:** up to 24 words (`veteranSize`), drawn from all words in buckets 6+.
- **Word selection:** sorted by difficulty descending (ties shuffled randomly) via `selectVeteranWords()`.
- **Minimum words:** if fewer than `VETERAN_MIN_WORDS` (5) qualifying words exist, the session is skipped.
- **SRS promotion:** same as focus — due words are promoted one bucket; non-due words are unchanged.

### Scheduling

After each veteran session completes (any outcome), the next due date is set to `today + VETERAN_INTERVAL_DAYS (6) + random(0–48 h)`.

### Data Model

Migration `028_veteran_session.sql` adds one column to the `credits` table:

| Column | Type | Description |
|---|---|---|
| `veteran_session_due_at` | TEXT (YYYY-MM-DD) | next eligible date for a veteran session; null = not yet scheduled |

### Backend Design

- **`CreditsRepository`** — two new methods: `getVeteranSessionDueAt(): string | null`, `setVeteranSessionDueAt(date: string | null): void`.
- **`SqliteCreditsRepository`** + **`FakeCreditsRepository`** — implement the new methods.
- **`VeteranSessionService`** (`server/features/session/veteranSessionService.ts`):
  - `isAvailable(today, bucket6PlusCount)`: returns true when all trigger conditions are met.
  - `scheduleFirst(today)`: sets `veteran_session_due_at` to `today + random(0–48 h)` if not yet set.
  - `scheduleNext(today)`: sets `veteran_session_due_at` to `today + 6 days + random(0–48 h)`.
- **`srsSelection.ts`**: `selectVeteranWords(entries, sessionSize, minWords)` — filters bucket ≥ 6, `sortByDifficultyThenShuffle`, returns null if fewer than `minWords` qualify.
- **`SessionService`** modifications:
  - `createSession()`: compute `bucket6PlusCount`; call `veteranService.scheduleFirst()` when count first reaches 50; insert veteran check after focus check.
  - `submitAnswer()`: call `veteranService.scheduleNext()` on veteran session completion.
  - `shared/types/Session.ts`: add `'veteran'` to the `SessionType` union.

### Frontend Design

- **`TrainingScreen`**: display **"Veteran Session"** as the session title when `session.type === 'veteran'`.
- No special UI changes needed — no timer, no credit pressure, no hidden hints.

### Implementation Checklist

- [x] Migration `028_veteran_session.sql`: add `veteran_session_due_at TEXT` to `credits`
- [x] `CreditsRepository`: add `getVeteranSessionDueAt()`, `setVeteranSessionDueAt()`
- [x] `SqliteCreditsRepository` + `FakeCreditsRepository`: implement new methods
- [x] `server/db/database.test.ts`: bump migration count 27 → 28
- [x] `shared/types/Session.ts`: add `'veteran'` to `SessionType`
- [x] `VeteranSessionService`: `isAvailable()`, `scheduleNext()`, `scheduleFirst()`; unit tests
- [x] `srsSelection.ts`: `selectVeteranWords()` + `sortByDifficultyThenShuffle()`; unit tests
- [x] `SessionService.createSession()`: veteran check after focus, before normal/rep
- [x] `SessionService.submitAnswer()`: call `scheduleNext` on veteran session completion
- [x] `SessionService` tests for veteran session creation and completion
- [x] `TrainingScreen`: show "Veteran Session" label
- [x] Tests for all new/changed code
