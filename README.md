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

| Bucket | Group | Review frequency |
|--------|-------|-----------------|
| 0 | New | Every session |
| 1 | Beginner | Every session |
| 2–3 | Learning | Every session |
| 4 | Established | Once per day |
| 5 | Established | Once per week |
| 6–9 | Veteran | Once per (N − 4) weeks (2–5 weeks) |
| 10 | Master | Once per 6 weeks |
| 11 | Master | Once per 8 weeks |
| 12–13 | Master | Once per 12 weeks |
| 14+ | Legend | Once per 12 weeks (cap) |

**Correct answer** → word moves up one bucket.
**Wrong answer** → word is reset to bucket 1 (never back to 0).
**Partially correct answer** (one of two required translations) → word stays in its current bucket.

Bucket 0 is reserved for words you've never seen. Getting one wrong won't send you back there.

There is no upper limit on buckets — the longer you practice a word without mistakes, the higher it can go. The review interval is capped at 12 weeks from bucket 12 onwards.

#### Minimum time to reach a status group

The table below shows the earliest possible time to reach each group, assuming every answer is correct and words are reviewed exactly when due (starting from bucket 4):

| Status | Enters at bucket | Min. time from bucket 4 | Approx. |
|--------|-----------------|------------------------|---------|
| Established | 4 | immediately | — |
| Veteran | 6 | 8 days | ~1 week |
| Master | 10 | 106 days | ~15 weeks |
| Legend | 14 | 372 days | ~1 year |

---

### Session Types

The app picks the session type automatically each time you start a new session. There are seven automatic types drawn from a **shuffled round-robin rotation**: the app cycles through all seven types in a random order, skipping any that aren't eligible, and reshuffles when all seven have been considered. An eighth type — the **★ Session** — can be started manually at any time via a dedicated button on the Home screen.

#### Stress Session (weekly)

A **Stress Session** is a high-stakes timed challenge that fires automatically at most once per week when all of the following conditions are met:

- Your credit balance is **500 or higher**
- At least **5 words** exist in buckets 2 and above
- The stress session is **due** (at least a week has passed since the last one)

If you have never had a stress session and your balance reaches 500 for the first time, the first session will be scheduled to trigger within the next **48 hours**.

**Session rules:**
- Up to **24 words** are selected across three difficulty tiers (each tier is randomly shuffled internally):
  - **Tier A (up to 8 words):** difficulty ≥ 4
  - **Tier B (up to 8 words):** difficulty ≥ 2 (excluding tier A picks)
  - **Tier C (remaining slots):** any word (excluding prior picks)
  Words are selected regardless of whether they are due. Any unfilled tier slots carry forward to tier C, so the session always reaches up to 24 words.
- **No hints** — the hint button is not available.
- **No second chance** — a wrong answer on a time-based word does not generate a second-chance word.
- **Time limit per question** — 15 seconds for one answer field, 25 seconds for two. The timer resets on every new question. When it runs out, whatever is typed is submitted automatically (empty fields count as wrong).

The timer and your current credit balance are displayed prominently during the session so you are always aware of the pressure.

**Scoring:**

| Outcome | Credit effect | Bucket effect |
|---|---|---|
| Fully correct | none | promoted one bucket if due; unchanged if not yet due |
| Partially correct | −½ × fee | stays in current bucket |
| Wrong or timed out | −1 × fee | reset to bucket 1 |

The **per-answer fee** is `floor(500 ÷ session size)`, rounded down to the nearest even number. For the maximum session size of 24 words this is **20 credits per wrong answer** (10 for partial).

**Perfect session:** if every answer in the session is fully correct, a **+100 credit bonus** is awarded. This is the only way to earn credits during a stress session.

After each stress session completes, the next one is scheduled for **7 days + up to 48 random hours** later.

---

#### Discovery Session

When your active pool — words in buckets 1–4 — falls below **80 words**, the app injects a **Discovery Session** to replenish it. Up to **24 words** are drawn from bucket 0 (new words you haven't practiced yet). Manually added words are drawn first, then sorted by priority score. At least **10 bucket-0 words** must exist for the session to fire; if fewer than 24 exist, a shorter session is created with however many are available.

**Special rules for Discovery Sessions:**
- **Once per day** — at most one discovery session per calendar day. If a discovery session was already completed today, the type is skipped in the rotation until the following day.
- **No credit costs** — wrong answers never deduct credits.
- **Hints are free and automatic** — the first 1–2 characters of each answer are always revealed; no paid hint button is shown.
- **Push back** — a "Push back (N left)" button lets you skip a word and keep it in bucket 0 for a future session. You have **10 free push-backs per session**; the button is disabled once the budget is exhausted.
- **Perfect session bonus: +100 credits** — awarded if you answer all words correctly with no push-backs (replaces the standard +20 bonus).

#### Focus Session

If you have at least **10 words** with a **priority score of 2 or higher** (see [Word Priority Score](#word-priority-score) below), a **Focus Session** is eligible, targeting your most problematic words.

- Contains up to **12 words**.
- Only words from **buckets 1–5** are eligible as primary candidates (bucket 0 and buckets 6+ are excluded — high-bucket words are considered well-learned regardless of their score).
- The top-scoring words fill the session first; if fewer than 12 qualify, the remaining slots are filled with other high-scoring words from buckets 1+.
- If fewer than 10 words qualify, the focus session is skipped in the current rotation cycle.

#### Focus Replay

After completing a Focus Session with enough errors, the session summary screen offers a **"Play again"** button for up to two additional attempts.

- The replay contains the **exact same words** as the original, reshuffled into a random new order.
- It is treated as a fully independent Focus Session: earns credits, perfect bonus, bucket promotions, and streak credit exactly like any other session. Exception: a word that was already promoted into a time-based bucket (4+) during the original session or a previous replay is no longer due, so it will appear for practice but cannot be promoted further until its normal due date arrives.
- **Up to two replays per session:**
  - **Replay 1** is offered after the original Focus Session if **25% or more** of answers were wrong or partial.
  - **Replay 2** is offered after Replay 1 if **at least 1** answer was wrong or partial.
  - After Replay 2, no further replay is offered.
- If you decline (or navigate away), the offer is gone permanently for that session.
- The normal session-type rotation is unaffected either way.

#### Veteran Session (weekly, once ≥ 50 words reach bucket 6+)

A **Veteran Session** is a periodic review of your most-mastered words — those that have reached bucket 6 or higher. It fires automatically roughly once a week when all of the following conditions are met:

- At least **50 words** exist in buckets 6 and above
- At least **10 of those words** have a **difficulty ≥ 2**
- The veteran session is **due** (at least 6 days have passed since the last one)

If your bucket-6+ count first reaches 50, the initial session is scheduled to trigger within the next **48 hours**.

**Session rules:**
- Up to **24 words** drawn from buckets 6+ with **difficulty ≥ 2**, sorted by difficulty descending (ties broken randomly) — your hardest veteran words come first.
- SRS promotion rules mirror the Focus Session: words that are not yet due are not promoted.
- If fewer than 10 qualifying words can be selected, the session is skipped.

After each veteran session completes, the next one is scheduled for **6 days + up to 48 random hours** later.

#### Breakthrough Session (weekly, once ≥ 10 qualifying words exist)

A **Breakthrough Session** focuses on words that are **one correct answer away from a bucket milestone** — promoting them in a single targeted run. It fires automatically roughly once a week when all of the following conditions are met:

- At least **10 qualifying words** exist across the three categories below
- The breakthrough session is **due** (at least 6 days have passed since the last one)

If qualifying words first reach 10 and no session is scheduled yet, the initial session is scheduled to trigger within the next **48 hours**.

**Word pool — three categories, deduplicated (first match wins):**
1. **Bucket 3** — one step from entering the time-based SRS system. Always eligible (frequency bucket, no due-date check).
2. **Due bucket-5 words** — one step from veteran territory (bucket 6). Only due words are included.
3. **Words in the highest occupied bucket** — one step from setting a new personal `maxBucket` record. Time-based words must be due; frequency words are always eligible.

**Session rules:**
- Up to **24 words**, slots distributed proportionally across the three categories.
- Within each category, words are sorted by score descending (ties broken randomly).
- SRS promotion rules are identical to normal sessions.

After each breakthrough session completes, the next one is scheduled for **6 days + up to 48 random hours** later.

#### Recovery Session

A **Recovery Session** targets words that were once genuinely mastered but have since regressed — words you used to know well but have apparently forgotten again.

**Eligibility (per word — both conditions must hold):**
- `maxBucket ≥ 6` — the word once reached veteran territory (genuinely mastered)
- `maxBucket − bucket ≥ 2` — it has since fallen back by at least 2 full bucket levels

**Trigger condition:** at least **10 qualifying words** exist. The session is part of the normal shuffled rotation and fires whenever the threshold is met — no weekly timer or scheduling involved.

**Session rules:**
- Up to **12 words**, selected regardless of due date — the point is targeted re-consolidation, not SRS scheduling.
- Words are sorted by **regression gap descending** (`maxBucket − bucket`), with score descending as the tiebreaker — the biggest regressions come first.
- Hints are available; second-chance flow applies for time-based wrong answers; credit rules are identical to a normal session.

#### Repetition Session

A **Repetition Session** is an intensive review of time-based words (buckets 4+) that are currently overdue.

- Contains up to 24 words, all from due time-based buckets (4 and above).
- No frequency bucket words (0–3) are included.
- At least **10 due words** must exist across all time-based buckets for the session to fire; if fewer than 24 due words exist, a shorter session is created with however many are available.

#### Normal (Learning) Session

The default session type, containing up to **12 words**. It draws from both frequency buckets and time-based buckets:

- **Bucket 0**: 1 or 2 new words (random). Words you added manually via the UI are always drawn first.
- **Buckets 1–3**: the remaining slots are distributed proportionally — a bucket with more words receives more session slots. This is self-tuning as your vocabulary grows.
- **Time-based buckets (4+)**: up to 1 due word per occupied bucket is added on top.
- If the session is still short of the target size, additional due time-based words are added (lowest bucket first), then non-due time-based words.

Within every candidate pool, words are picked highest-score first (ties broken randomly).

#### Second Chance Session (highest priority, at most once per day)

When a time-based word (bucket 4+) goes through the in-session second-chance flow and the second-chance word is answered **fully correctly**, the word enters the **second chance bucket** — a holding state where it waits for a dedicated session before being restored or demoted.

- Words in the second chance bucket are excluded from all regular session types while they wait.
- They appear in a **"Second Chance (pending)"** section on the vocabulary list page.
- A word becomes eligible for a Second Chance Session at the earliest the next calendar day (or 12 hours after entering the bucket, whichever is later).
- If the second-chance word is answered **incorrectly or partially**, the word goes to bucket 1 immediately — the second chance bucket is only awarded on a fully correct second-chance pass.

**Session rules:**
- **Highest priority** — fires before all other automatic session types.
- **Trigger:** at least 1 word in the second chance bucket is due, and no Second Chance Session has been played today.
- **Daily limit:** at most one per calendar day.
- **Word pool:** all due second-chance-bucket words, up to **24**, sorted by score descending.
- **No hints** available.
- **Correct answer** → word is restored to its original bucket and removed from the second chance bucket.
- **Incorrect or partial answer** → word is moved to bucket 1 and removed from the second chance bucket.

**Session type eligibility at a glance:**

| Session type | Priority | Eligible when… |
|---|---|---|
| Second Chance | Highest (pre-rotation) | ≥ 1 due second-chance-bucket word AND not already played today |
| Stress | Rotation | Due date reached, ≥ 500 credits, ≥ 5 qualifying words (buckets 2+) |
| Discovery | Rotation | Active pool (buckets 1–4) < 80 words, ≥ 10 bucket-0 words, not already done today |
| Focus | Rotation | 10+ words with score ≥ 2 exist in buckets 1–5 |
| Veteran | Rotation | Due date reached, ≥ 50 words in buckets 6+, ≥ 10 of those with difficulty ≥ 2 |
| Breakthrough | Rotation | Due date reached, ≥ 10 qualifying words across bucket-3, due bucket-5, and due highest-bucket words |
| Repetition | Rotation | ≥ 10 due time-based words (buckets 4+) exist |
| Normal | Rotation (fallback) | Always eligible — at least one word in vocabulary |

#### ★ Session (manual, once per day)

A **★ Session** lets you practice all your starred (★) words in one focused run. It is started manually via the **"Start ★ session"** button on the Home screen and is available at most once per calendar day.

- Contains all words you have starred, up to a maximum of **100**.
- Words are sorted highest-score first (ties broken randomly) — your trickiest starred words come first.
- SRS rules are the same as a Focus Session: words in time-based buckets (4+) that are not yet due will not be promoted to the next bucket.
- The button is disabled if you have no starred words, if a ★ session was already completed today, or if another session is currently in progress.

---

### Second-Chance Flow (Time-Based Words)

When you answer a time-based word (bucket 4+) **fully wrong**, the app gives you a second chance:

1. A second word (W2) is inserted immediately after the current one, chosen from the full vocabulary (excluding words already in the session). Selection is biased toward harder words: each candidate is scored as `difficulty × 2 + bucket`; the top 25% (or top 5, whichever is larger) form a pool, and one is picked at random.
2. How you answer W2 affects the original word (W1):
   - **W2 correct** → W1 enters the **second chance bucket** and is excluded from regular sessions until a dedicated Second Chance Session resolves it (see [Second Chance Session](#second-chance-session-highest-priority-at-most-once-per-day) above).
   - **W2 wrong or partial** → W1 is reset to bucket 1 immediately.

W2 itself is never affected — it only exists to give W1 a lifeline.

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

### Word Difficulty

Every word has a permanent **difficulty** score that captures how intrinsically hard it is to learn, independent of your current practice state. Unlike the priority score, difficulty never resets — it only grows over time.

```
difficulty = spaceBonus + multipleBonus + lengthBonus + maxScore
```

- **spaceBonus** — +1 if any target translation is a genuine multi-word phrase — meaning it contains a space after stripping a leading "to " prefix (so "to fill up" qualifies, but "to replenish" does not).
- **multipleBonus** — +1 if the word has more than one target translation.
- **lengthBonus** — +1 if there is one target and it is ≥ 10 characters, or if there are multiple targets and more than one is ≥ 10 characters.
- **maxScore** — the highest priority score this word has ever had (never decreases).

The difficulty is recalculated whenever the target translations change or whenever the priority score reaches a new all-time high.

---

### Starring Words

You can **star** (mark) a word to give it a permanent +2 score boost. This is useful for words you find particularly tricky and want to see more often — the +2 bonus also guarantees the word qualifies for Focus Sessions regardless of its recent error history. Stars can be toggled at any time from the vocabulary list.

---

### The Credit System

Credits are the in-app currency that tracks your long-term progress and lets you use premium features.

**Earning credits:**

| How | Amount |
|---|---|
| Word reaches a new highest bucket for the first time | +5 per bucket level |
| Perfect session — normal/repetition/focus/veteran/★ (no mistakes, no hints, no second-chance words) | +20 |
| Perfect discovery session (all correct, no push-backs) | +100 |
| Perfect stress session (all answers fully correct) | +100 |
| Daily streak bonus (streak ≥ 2 days) | +1 |
| Streak milestone reached | +10 to +1 000 (see Streaks) |
| First time any word globally reaches a bucket never seen before (≥ 6) | min((N−5)×100, 500) — bucket 6 → +100, …, bucket 10+ → +500 (cap) |

Each word only earns the credit for a given bucket level once — falling back and climbing again pays nothing extra.

**Spending credits:**

| How | Cost |
|---|---|
| Hint during a session | 10–(n−2)×10 credits depending on bucket |
| Wrong answer (free in discovery sessions and for virgin words — see below) | 1 credit |
| Wrong answer in a stress session | floor(500 ÷ session size) credits, rounded to nearest even number |
| Partially correct answer in a stress session | Half of the per-answer fee |
| Save a streak (see Streaks) | 50 credits |

**Virgin words are free:** a word is considered a *virgin word* when its current bucket is ≤ 1 **and** it has never reached a higher bucket (`maxBucket ≤ 1`). Wrong answers on virgin words never deduct a credit — this protects newly introduced words that haven't yet proven themselves. Once a word has ever climbed to bucket 2 or above, it is no longer virgin and wrong answers cost the usual 1 credit, even if it has since fallen back.

Your balance is shown in the header on every screen and updated after each answer.

---

### Earned Stars

Stars are a permanent achievement displayed in the header. Once earned, a star can never be lost.

You earn **+1 star** the first time any word globally enters a new named group. Stars are permanent and additive — once earned, they are never lost.

| First word ever enters | Stars |
|---|---|
| Established (bucket 4) | +1 |
| Veteran (bucket 6) | +1 |
| Master (bucket 10) | +1 |
| Legend (bucket 14) | +1 |

#### Buying Stars

Stars can also be purchased with credits. When your balance reaches **500 or more**, the app offers you the chance to buy up to **3 stars**, at **500 credits each**. The offer is shown automatically — you can buy as many as your balance allows (up to the 3-star cap), or decline to keep your credits.

After any interaction with the offer dialog — whether you buy, decline, or close it — the offer is **snoozed for 7 days** before it reappears.

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

The vocabulary list groups all your words by bucket. Each bucket section is collapsed by default and can be expanded. Within each bucket, words are sorted alphabetically. The table shows each word's current priority **Score** and **Difficulty** score. Time-based words (bucket 4+) also show a "Due in" column indicating when they will next appear in a repetition session.
