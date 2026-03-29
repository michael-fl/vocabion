/**
 * Tests for the DiscoveryQuizScreen component.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { DiscoveryQuizScreen } from './DiscoveryQuizScreen.tsx'
import * as sessionApi from '../api/sessionApi.ts'
import * as vocabApi from '../api/vocabApi.ts'
import type { Session } from '../../shared/types/Session.ts'
import type { VocabEntry } from '../../shared/types/VocabEntry.ts'

vi.mock('../api/sessionApi.ts', () => ({
  DISCOVERY_PUSHBACK_BUDGET: 10,
  submitAnswer: vi.fn(),
  pushBackWord: vi.fn(),
}))

vi.mock('../api/vocabApi.ts', () => ({
  setVocabMarked: vi.fn(),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

let idCounter = 0

function makeEntry(overrides: Partial<VocabEntry> = {}): VocabEntry {
  idCounter++
  return {
    id: `entry-${idCounter}`,
    source: 'Tisch',
    target: ['table'],
    bucket: 0,
    lastAskedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    secondChanceDueAt: null,
    maxBucket: 0,
    maxScore: 0,
    difficulty: 0,
    marked: false,
    manuallyAdded: false,
    score: 0,
    ...overrides,
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  idCounter++
  return {
    id: `session-${idCounter}`,
    direction: 'SOURCE_TO_TARGET',
    type: 'discovery',
    words: [],
    status: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    firstAnsweredAt: null,
    ...overrides,
  }
}

function makeVocabMap(...entries: VocabEntry[]): Map<string, VocabEntry> {
  return new Map(entries.map((e) => [e.id, e]))
}

function makeAnswerResult(overrides: Partial<sessionApi.AnswerResult> = {}): sessionApi.AnswerResult {
  return {
    correct: true,
    outcome: 'correct',
    sessionCompleted: false,
    session: makeSession(),
    newBucket: 1,
    answerCost: 0,
    creditsEarned: 0,
    perfectBonus: 0,
    bucketMilestoneBonus: 0,
    streakCredit: 0,
    ...overrides,
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  idCounter = 0
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DiscoveryQuizScreen', () => {
  it('shows "Discovery Quiz" heading', () => {
    const entry = makeEntry()
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    render(
      <DiscoveryQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByRole('heading', { name: 'Discovery Quiz' })).toBeInTheDocument()
  })

  it('shows the source word as the prompt', () => {
    const entry = makeEntry({ source: 'Hund', target: ['dog'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    render(
      <DiscoveryQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByText('Hund')).toBeInTheDocument()
  })

  it('includes the correct translation as an option button', () => {
    const entry = makeEntry({ source: 'Hund', target: ['dog'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    render(
      <DiscoveryQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByRole('button', { name: 'dog' })).toBeInTheDocument()
  })

  it('shows a push-back button with the remaining budget', () => {
    const entry = makeEntry()
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    render(
      <DiscoveryQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByRole('button', { name: 'Push back (10 left)' })).toBeInTheDocument()
  })

  it('shows reduced push-back budget when words have already been pushed back', () => {
    const entry = makeEntry()
    const pushed = makeEntry()
    const session = makeSession({
      words: [
        { vocabId: pushed.id, status: 'pushed_back' },
        { vocabId: entry.id, status: 'pending' },
      ],
    })

    render(
      <DiscoveryQuizScreen session={session} vocabMap={makeVocabMap(entry, pushed)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByRole('button', { name: 'Push back (9 left)' })).toBeInTheDocument()
  })

  it('disables the push-back button when the budget is exhausted', () => {
    const entry = makeEntry()
    const pushedWords = Array.from({ length: 10 }, () => makeEntry())
    const session = makeSession({
      words: [
        ...pushedWords.map((e) => ({ vocabId: e.id, status: 'pushed_back' as const })),
        { vocabId: entry.id, status: 'pending' },
      ],
    })

    render(
      <DiscoveryQuizScreen
        session={session}
        vocabMap={makeVocabMap(entry, ...pushedWords)}
        onComplete={vi.fn()}
        correctFeedbackDelayMs={0}
      />,
    )

    expect(screen.getByRole('button', { name: 'Push back (0 left)' })).toBeDisabled()
  })

  it('calls pushBackWord and advances to the next word', async () => {
    const entry1 = makeEntry({ source: 'Hund', target: ['dog'] })
    const entry2 = makeEntry({ source: 'Katze', target: ['cat'] })
    const session = makeSession({
      words: [
        { vocabId: entry1.id, status: 'pending' },
        { vocabId: entry2.id, status: 'pending' },
      ],
    })
    const updatedSession: Session = {
      ...session,
      words: [
        { vocabId: entry1.id, status: 'pushed_back' },
        { vocabId: entry2.id, status: 'pending' },
      ],
    }

    vi.mocked(sessionApi.pushBackWord).mockResolvedValue(updatedSession)

    render(
      <DiscoveryQuizScreen session={session} vocabMap={makeVocabMap(entry1, entry2)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Push back (10 left)' }))

    await waitFor(() => {
      expect(sessionApi.pushBackWord).toHaveBeenCalledWith(session.id, entry1.id)
      expect(screen.getByText('Katze')).toBeInTheDocument()
    })
  })

  it('disables the Submit button until the required number of options are selected', () => {
    // Use a 2-translation word: selecting only 1 never auto-submits (need both)
    const entry = makeEntry({ target: ['bicycle', 'bike'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    render(
      <DiscoveryQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'bicycle' }))

    // 1 of 2 selected — still disabled
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  })

  it('submits the selected option labels as answers', async () => {
    const entry = makeEntry({ source: 'Hund', target: ['dog'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue(makeAnswerResult({
      session: { ...session, words: [{ vocabId: entry.id, status: 'correct' }], status: 'open' },
    }))

    render(
      <DiscoveryQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'dog' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(sessionApi.submitAnswer).toHaveBeenCalledWith(session.id, entry.id, ['dog'], false)
    })
  })

  it('shows a correct status banner after a correct answer', async () => {
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue(makeAnswerResult({
      correct: true,
      outcome: 'correct',
      newBucket: 1,
      session: { ...session, words: [{ vocabId: entry.id, status: 'correct' }], status: 'open' },
    }))

    render(
      <DiscoveryQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'table' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Correct! → bucket 1')
  })

  it('calls onComplete when the session is completed', async () => {
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })
    const completedSession: Session = { ...session, words: [{ vocabId: entry.id, status: 'correct' }], status: 'completed' }
    const onComplete = vi.fn()

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue(makeAnswerResult({
      correct: true,
      outcome: 'correct',
      sessionCompleted: true,
      session: completedSession,
    }))

    render(
      <DiscoveryQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={onComplete} correctFeedbackDelayMs={0} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'table' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(completedSession, expect.any(Number), expect.any(Number), 0, expect.any(Number), expect.any(Number), undefined, expect.any(Number))
    })
  })

  it('calls onComplete when the last word is pushed back', async () => {
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })
    const completedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'pushed_back' }],
      status: 'completed',
    }
    const onComplete = vi.fn()

    vi.mocked(sessionApi.pushBackWord).mockResolvedValue(completedSession)

    render(
      <DiscoveryQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={onComplete} correctFeedbackDelayMs={0} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Push back (10 left)' }))

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled()
    })
  })

  it('toggles the star button', async () => {
    vi.mocked(vocabApi.setVocabMarked).mockResolvedValue(undefined)

    const entry = makeEntry({ marked: false })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    render(
      <DiscoveryQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    const starBtn = screen.getByRole('button', { name: 'Star word' })

    fireEvent.click(starBtn)

    await waitFor(() => {
      expect(vocabApi.setVocabMarked).toHaveBeenCalledWith(entry.id, true)
    })
  })
})
