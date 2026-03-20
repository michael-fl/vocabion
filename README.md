# Vocabion

A personal German–English vocabulary trainer built on spaced repetition. Words are organized into numbered buckets that determine how often they appear in practice sessions. The more reliably you answer a word, the higher its bucket — and the less frequently it shows up.

---

## For Developers

### Prerequisites

- [Node.js](https://nodejs.org/) v20 or higher

### Install dependencies

```bash
npm install
```

### Run in development

Run both the backend (port 3000) and the Vite frontend (port 5173) in one command:

```bash
npm run dev:all
```

Or start them separately in two terminals:

```bash
npm run dev:server   # Node.js backend on :3000
npm run dev          # Vite frontend on :5173
```

The app is available at `http://localhost:5173/`.

### Build for production

```bash
npm run build        # type-check + Vite production build → dist/
npm run preview      # serve the production build at :4173
```

### Lint and test

```bash
npm run lint             # ESLint with strict TypeScript rules
npm test                 # run all tests once
npm run test:watch       # re-run tests on file changes
npm run test:coverage    # run with V8 coverage report → coverage/index.html
```

Run a single test file:

```bash
npx vitest run server/features/session/sessionService.test.ts
```

### Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + TypeScript, Vite |
| Backend | Node.js + Express 5 + TypeScript |
| Database | SQLite via `better-sqlite3` (single `.db` file, no server process) |
| Validation | Zod |
| Testing | Vitest + Testing Library |

The frontend proxies `/api/*` requests to the Express server in development (no CORS issues).
Domain types shared between frontend and backend live in `shared/types/` — neither side defines its own copy.

For deeper architectural detail see [PROJECT-PLAN.md](./PROJECT-PLAN.md).

---

## For Users

### What is Vocabion?

Vocabion helps you memorize German–English vocabulary using **spaced repetition** — a proven technique that shows you words less often as you get better at them, and more often when you keep getting them wrong. You practice in short sessions, and the app tracks your progress automatically.

---

### The Bucket System

Every word lives in a numbered **bucket** that reflects how well you know it:

| Bucket | Meaning | Review frequency |
|--------|---------|-----------------|
| 0 | New — never seen | Every session |
| 1 | Seen, still shaky | Every session |
| 2 | Getting there | Every session |
| 3 | Fairly solid | Every session |
| 4 | Long-term memory | Once per day (22 h) |
| 5 | Long-term memory | Once per week |
| 6 | Long-term memory | Once per 2 weeks |
| 7+ | Long-term memory | Once per (N − 4) weeks |

**Correct answer** → word moves up one bucket.
**Wrong answer** → word is reset to bucket 1 (never back to 0).
**Partially correct answer** (one of two required translations) → word stays in its current bucket.

Bucket 0 is reserved for words you've never seen. Getting one wrong won't send you back there.

There is no upper limit on buckets — the longer you practice a word without mistakes, the higher it can go.

---

### Session Types

The app picks the session type automatically each time you start a new session. There are four types, chosen in this priority order:

#### 1. Discovery Session (highest priority)

When your active pool — words in buckets 1–4 — falls below **80 words**, the app injects a **Discovery Session** to replenish it. This session contains exactly **24 words**, all drawn from bucket 0 (new words you haven't practiced yet). Manually added words are drawn first, then sorted by priority score.

**Special rules for Discovery Sessions:**
- **Once per day** — at most one discovery session per calendar day. If a discovery session was already completed today, the next one will be offered no earlier than the following day.
- **No credit costs** — wrong answers never deduct credits.
- **Hints are free and automatic** — the first 1–2 characters of each answer are always revealed; no paid hint button is shown.
- **Push back** — a "Push back (N left)" button lets you skip a word and keep it in bucket 0 for a future session. You have **10 free push-backs per session**; the button is disabled once the budget is exhausted.
- **Perfect session bonus: +100 credits** — awarded if you answer all words correctly with no push-backs (replaces the standard +10 bonus).

#### 2. Focus Session (once per day)

If you have at least 5 words with a **priority score of 2 or higher** (see [Word Priority Score](#word-priority-score) below), the day's first session is a **Focus Session** targeting your most problematic words.

- Only words from buckets 1 and above are eligible (bucket 0 is excluded).
- The top-scoring words fill the session first; if fewer than 10 qualify, the remaining slots are filled with other high-scoring words from buckets 1+.
- If fewer than 5 words qualify, the focus session is skipped.
- Only one focus session per calendar day.

#### 3. Repetition Session

After a normal session, the next session is a **Repetition Session** — an intensive review of time-based words (buckets 4+) that are currently overdue.

- Contains up to 24 words, all from due time-based buckets (4 and above).
- No frequency bucket words (0–3) are included.
- If fewer than 24 due words exist across all time-based buckets, the repetition session is skipped and a normal session runs instead. The next session will try repetition again.

#### 4. Normal (Learning) Session

The default session type. It draws from both frequency buckets and time-based buckets:

- **Bucket 0**: 1 or 2 new words (random). Words you added manually via the UI are always drawn first.
- **Buckets 1–3**: the remaining slots are distributed proportionally — a bucket with more words receives more session slots. This is self-tuning as your vocabulary grows.
- **Time-based buckets (4+)**: up to 1 due word per occupied bucket is added on top.
- If the session is still short of the target size, additional due time-based words are added (lowest bucket first), then non-due time-based words.

Within every candidate pool, words are picked highest-score first (ties broken randomly).

**Session type sequence summary:**

| Situation | Session type |
|---|---|
| Active pool (buckets 1–4) < 80 words and ≥ 24 bucket-0 words exist | Discovery |
| 5+ high-score words exist and no focus session today | Focus |
| Last session was normal (and enough due words) | Repetition |
| Last session was repetition | Normal |
| Last session was focus | Picks up the normal/repetition alternation where it left off |

---

### Second-Chance Flow (Time-Based Words)

When you answer a time-based word (bucket 4+) **fully wrong**, the app gives you a second chance:

1. A different word from the same bucket is inserted immediately after the current one.
2. How you answer that second word affects the original:
   - **Second word correct** → original word drops one bucket (not back to 1). If the new bucket is still time-based (≥ 4), the word is scheduled to be due again within 24 hours — so it will appear in the next day's repetition session for quick consolidation.
   - **Second word wrong or partial** → original word is reset to bucket 1.

The second word itself is never affected — it only exists to give the original word a lifeline.

---

### Answer Validation

- **Case-insensitive** — `Table` and `table` are both accepted.
- **Compound words** — hyphens and spaces are interchangeable (`well-known` = `well known`).
- **Multiple translations** — if a word has two or more valid translations, you must provide two correct ones (in any order). Getting only one right counts as a partial answer.
- **Typo tolerance** — small spelling mistakes are forgiven. Short words (under 8 characters) allow 1 edit; longer words allow up to 15% relative distance. A typo match is treated as correct for SRS purposes, but the app shows you the correct spelling.
- **Partial answer** — one of two required translations is right. The word stays in its current bucket. No second-chance word is drawn.

---

### Word Priority Score

Every word has a persistent **score** that reflects how urgently it needs practice. Words with higher scores are drawn first within their bucket pool.

```
score = recent errors + (starred ? 2 : 0) + max(peak bucket − current bucket − 2, 0)
```

- **Recent errors** — how many of the last 10 sessions (globally) contained a wrong or partial answer for this word.
- **Starred** — +2 if you have starred the word (see below). A +2 bonus guarantees a score of at least 2, which automatically qualifies the word for Focus Sessions.
- **Fall from peak** — if a word was once in bucket 6 but has fallen to bucket 2, it contributes `6 − 2 − 2 = 2` points. A grace of 2 buckets means small regressions don't immediately affect the score.

The score is recalculated after every answer and whenever you star or unstar a word.

---

### Starring Words

You can **star** (mark) a word to give it a permanent +2 score boost. This is useful for words you find particularly tricky and want to see more often — the +2 bonus also guarantees the word qualifies for Focus Sessions regardless of its recent error history. Stars can be toggled at any time from the vocabulary list.

---

### The Credit System

Credits are the in-app currency that tracks your long-term progress and lets you use premium features.

**Earning credits:**

| How | Amount |
|---|---|
| Word reaches a new highest bucket for the first time (bucket < 4) | +1 per bucket level |
| Word reaches a new highest bucket for the first time (bucket ≥ 4) | +5 per bucket level |
| Perfect session — normal/repetition/focus (no mistakes, no hints, no second-chance words) | +10 |
| Perfect discovery session (all correct, no push-backs) | +100 |
| Daily streak bonus (streak ≥ 2 days) | +1 |
| Streak milestone reached | +10 to +1 000 (see Streaks) |
| First time any word globally reaches a bucket never seen before (≥ 6) | +(N−5)×100 (bucket 6 → +100, bucket 7 → +200, …) |

Each word only earns the credit for a given bucket level once — falling back and climbing again pays nothing extra.

**Spending credits:**

| How | Cost |
|---|---|
| Hint during a session | 10–(n−2)×10 credits depending on bucket |
| Wrong answer (deducted automatically; free in discovery sessions) | 1 credit |
| Save a streak (see Streaks) | 50 credits |

Your balance is shown in the header on every screen and updated after each answer.

---

### Hints

During a session you can reveal a hint for the current word. The hint shows the first 1–2 characters of each required answer, with the rest replaced by dots.

- Bucket 0: hint is free and shown automatically — reveals the first **2 characters** per word. No paid hint button is available.
- Bucket 1: hint is free and shown automatically — reveals the first **1 character** per word. You can also pay **10 credits** to upgrade to a 2-character hint.
- Buckets 2–3: 10 credits.

- Buckets 4+: cost increases with bucket level, capped at **30 credits**.
- Using a hint disqualifies the session from the perfect-session bonus.
- The hint resets with every new word.

---

### Streaks

A **streak** counts how many consecutive calendar days you have completed at least one session.

- The streak increments when you complete a session on a day you haven't practiced yet.
- Missing a day **breaks** the streak (resets to 1 on your next session).
- The streak counter is shown on the Home screen.

**Daily streak bonus:** completing your first session of the day awards +1 credit — but only when your streak reaches 2 or more. Starting a fresh streak (day 1) or resuming after a gap earns no bonus.

**Evening warning:** if your last session was yesterday and it is now 20:00 or later, the Home screen shows a warning reminding you to practice before the day ends.

**Save-streak:** if you missed exactly one day, you can spend **50 credits** to bridge the gap and keep your streak alive. This is only available when the streak is saveable (the missed day is exactly yesterday − 1).

---

### Streak Milestones

Reaching certain streak lengths triggers a **milestone reward** — a larger credit bonus that replaces the normal +1 daily credit for that day:

| Milestone | Streak length | Credits |
|---|---|---|
| 1 Week | 7 days | +10 |
| 2 Weeks | 14 days | +20 |
| Month 1, 2, 3… | Each completed calendar month | +200 |
| Year 1 (month 12) | 12 months | +500 |
| Year 2 (month 24) | 24 months | +1 000 |
| Year 3+ | Every 12th month thereafter | +1 000 |

Monthly milestones follow a calendar rule: if you started your streak on day 1–7 of a month, that partial month counts as month 1 (reward paid on the last day of that month). If you started on day 8 or later, month 1 is the next full calendar month.

When a milestone is reached, the session summary shows a celebration line instead of the regular streak bonus line (e.g. _"Streak milestone: 2 Weeks! +20 credits"_). The Home screen also shows your next upcoming milestone and how many days away it is.

---

### Vocabulary List

The vocabulary list groups all your words by bucket. Each bucket section is collapsed by default and can be expanded. Within each bucket, words are sorted alphabetically. Time-based words (bucket 4+) show a "Due in" column indicating when they will next appear in a repetition session.
