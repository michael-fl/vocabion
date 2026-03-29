/**
 * Tests for the FocusQuizScreen component.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { FocusQuizScreen } from './FocusQuizScreen.tsx'
import * as sessionApi from '../api/sessionApi.ts'
import * as vocabApi from '../api/vocabApi.ts'
import type { Session } from '../../shared/types/Session.ts'
import type { VocabEntry } from '../../shared/types/VocabEntry.ts'

vi.mock('../api/sessionApi.ts', () => ({
  submitAnswer: vi.fn(),
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
    bucket: 1,
    lastAskedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    secondChanceDueAt: null,
    maxBucket: 1,
    maxScore: 0,
    difficulty: 0,
    marked: false,
    manuallyAdded: false,
    score: 2,
    ...overrides,
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  idCounter++
  return {
    id: `session-${idCounter}`,
    direction: 'SOURCE_TO_TARGET',
    type: 'focus_quiz',
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

/** Builds a minimal mock AnswerResult. */
function makeAnswerResult(overrides: Partial<sessionApi.AnswerResult> = {}): sessionApi.AnswerResult {
  return {
    correct: true,
    outcome: 'correct',
    sessionCompleted: false,
    session: makeSession(),
    newBucket: 2,
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

describe('FocusQuizScreen', () => {
  it('shows "Focus Quiz" heading', () => {
    const entry = makeEntry()
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    render(
      <FocusQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByRole('heading', { name: 'Focus Quiz' })).toBeInTheDocument()
  })

  it('shows the source word as the prompt', () => {
    const entry = makeEntry({ source: 'Hund', target: ['dog'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    render(
      <FocusQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByText('Hund')).toBeInTheDocument()
  })

  it('shows "Select 1 answer" hint for a single-translation word', () => {
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    render(
      <FocusQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByText('Select 1 answer')).toBeInTheDocument()
  })

  it('shows "Select 2 answers" hint for a two-translation word', () => {
    const entry = makeEntry({ target: ['bicycle', 'bike'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    render(
      <FocusQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByText('Select 2 answers')).toBeInTheDocument()
  })

  it('includes all correct translations as option buttons', () => {
    const entry = makeEntry({ source: 'Fahrrad', target: ['bicycle', 'bike'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    render(
      <FocusQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByRole('button', { name: 'bicycle' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'bike' })).toBeInTheDocument()
  })

  it('disables the Submit button until the required number of options are selected', () => {
    // Use a 2-translation word: selecting only 1 never auto-submits (need both)
    const entry = makeEntry({ target: ['bicycle', 'bike'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    render(
      <FocusQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'bicycle' }))

    // 1 of 2 selected — still disabled
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  })

  it('deselects an option when clicked a second time', () => {
    // Use a 2-translation word so a single click does not trigger auto-submit
    const entry = makeEntry({ target: ['bicycle', 'bike'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    render(
      <FocusQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    const optionBtn = screen.getByRole('button', { name: 'bicycle' })

    fireEvent.click(optionBtn)
    expect(optionBtn).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(optionBtn)
    expect(optionBtn).toHaveAttribute('aria-pressed', 'false')
  })

  it('submits the selected option labels as answers', async () => {
    const entry = makeEntry({ source: 'Hund', target: ['dog'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue(makeAnswerResult({
      session: { ...session, words: [{ vocabId: entry.id, status: 'correct' }], status: 'open' },
    }))

    render(
      <FocusQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
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
      newBucket: 2,
      session: { ...session, words: [{ vocabId: entry.id, status: 'correct' }], status: 'open' },
    }))

    render(
      <FocusQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'table' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Correct! → bucket 2')
  })

  it('shows an incorrect status banner after a wrong answer', async () => {
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue(makeAnswerResult({
      correct: false,
      outcome: 'incorrect',
      newBucket: 1,
      session: { ...session, words: [{ vocabId: entry.id, status: 'incorrect' }], status: 'open' },
    }))

    render(
      <FocusQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'table' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Incorrect')
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
      <FocusQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={onComplete} correctFeedbackDelayMs={0} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'table' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(completedSession, expect.any(Number), expect.any(Number), 0, expect.any(Number), expect.any(Number), undefined, expect.any(Number))
    })
  })

  it('shows "Select 1 answer" for a second-chance word regardless of the original word\'s translation count', () => {
    const w1 = makeEntry({ target: ['bicycle', 'bike'] })
    const w2 = makeEntry({ id: 'w2', target: ['bicycle', 'bike'] })
    const session = makeSession({
      words: [
        { vocabId: w1.id, status: 'incorrect' },
        { vocabId: w2.id, status: 'pending', secondChanceFor: w1.id },
      ],
    })

    render(
      <FocusQuizScreen session={session} vocabMap={makeVocabMap(w1, w2)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByText('Select 1 answer')).toBeInTheDocument()
  })

  it('toggles the star button', async () => {
    vi.mocked(vocabApi.setVocabMarked).mockResolvedValue(undefined)

    const entry = makeEntry({ marked: false })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    render(
      <FocusQuizScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    const starBtn = screen.getByRole('button', { name: 'Star word' })

    fireEvent.click(starBtn)

    await waitFor(() => {
      expect(vocabApi.setVocabMarked).toHaveBeenCalledWith(entry.id, true)
    })
  })
})
