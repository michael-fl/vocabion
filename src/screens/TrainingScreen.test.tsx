/**
 * Tests for the TrainingScreen component.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { TrainingScreen } from './TrainingScreen.tsx'
import * as sessionApi from '../api/sessionApi.ts'
import * as vocabApi from '../api/vocabApi.ts'
import * as creditsApi from '../api/creditsApi.ts'
import type { Session } from '../../shared/types/Session.ts'
import type { VocabEntry } from '../../shared/types/VocabEntry.ts'

vi.mock('../api/sessionApi.ts', () => ({
  DISCOVERY_PUSHBACK_BUDGET: 10,
  submitAnswer: vi.fn(),
  markWordCorrect: vi.fn(),
  pushBackWord: vi.fn(),
}))

vi.mock('../api/vocabApi.ts', () => ({
  addOrMergeVocab: vi.fn(),
  setVocabBucket: vi.fn(),
  setVocabMarked: vi.fn(),
}))

vi.mock('../api/creditsApi.ts', () => ({
  spendCredits: vi.fn(),
  refundCredits: vi.fn(),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<VocabEntry> = {}): VocabEntry {
  return {
    id: 'entry-1',
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
  return {
    id: 'session-1',
    direction: 'SOURCE_TO_TARGET',
    type: 'normal',
    words: [{ vocabId: 'entry-1', status: 'pending' }],
    status: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    firstAnsweredAt: null,
    ...overrides,
  }
}

function makeVocabMap(...entries: VocabEntry[]): Map<string, VocabEntry> {
  return new Map(entries.map((e) => [e.id, e]))
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TrainingScreen', () => {
  it('shows "Learning Session" title for a normal session', () => {
    const entry = makeEntry()
    const session = makeSession({ type: 'normal' })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByRole('heading', { name: 'Learning Session' })).toBeInTheDocument()
  })

  it('shows "★ Session" title for a starred session', () => {
    const entry = makeEntry()
    const session = makeSession({ type: 'starred' })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByRole('heading', { name: '★ Session' })).toBeInTheDocument()
  })

  it('shows "Review Session" title for a review session', () => {
    const entry = makeEntry()
    const session = makeSession({ type: 'review' })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByRole('heading', { name: 'Review Session' })).toBeInTheDocument()
  })

  it('shows the prompt word', () => {
    const entry = makeEntry({ source: 'Hund', target: ['dog'] })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByText('Hund')).toBeInTheDocument()
  })

  it('shows a single answer input for a word with one translation', () => {
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession()

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByLabelText('Your answer:')).toBeInTheDocument()
  })

  it('shows two answer inputs for a word with two translations', () => {
    const entry = makeEntry({ target: ['vegetable', 'vegetables'] })
    const session = makeSession()

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getAllByRole('textbox')).toHaveLength(2)
    expect(screen.getByLabelText('Answer 1:')).toBeInTheDocument()
    expect(screen.getByLabelText('Answer 2:')).toBeInTheDocument()
  })

  it('shows "Correct!" status after a correct answer', async () => {
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession()
    const completedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'correct' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: true,
      outcome: 'correct',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: completedSession,
      newBucket: 1,
    })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'table' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Correct! → bucket 1')
  })

  it('shows partially correct status when outcome is partial', async () => {
    const entry = makeEntry({ target: ['bicycle', 'bike'] })
    const session = makeSession()
    const updatedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'partial',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: updatedSession,
      newBucket: 1,
    })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Answer 1:'), { target: { value: 'bicycle' } })
    fireEvent.change(screen.getByLabelText('Answer 2:'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Partially correct. Correct answers: bicycle, bike — → bucket 1')
  })

  it('does not re-submit when the form is submitted again after the session is completed', async () => {
    // After the last word is answered, the session transitions to a 2-second
    // status banner before navigating to the summary. Pressing Enter or clicking
    // Submit during that window must not produce a second backend call — that
    // would resubmit an already-resolved word and trigger a 400.
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession()
    const completedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'incorrect',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: completedSession,
      newBucket: 1,
    })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={5000} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
    })

    // Re-clicking after the response has been processed must be a no-op.
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    // Form-level submit (e.g. Enter key) must also be ignored.
    const form = screen.getByLabelText('Your answer:').closest('form')

    if (form !== null) {
      fireEvent.submit(form)
    }

    expect(vi.mocked(sessionApi.submitAnswer)).toHaveBeenCalledOnce()
  })

  it('shows incorrect status with the correct answer after a wrong answer', async () => {
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession()
    const updatedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'incorrect',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: updatedSession,
      newBucket: 1,
    })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Incorrect. Correct answer: table — → bucket 1')
  })

  it('calls onComplete automatically after a correct answer on the last word', async () => {
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession()
    const completedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'correct' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: true,
      outcome: 'correct',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: completedSession,
      newBucket: 1,
    })

    const onComplete = vi.fn()

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={onComplete} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'table' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(completedSession, 0, 0, 0, 0, 0, undefined, 0, undefined)
    })
  })

  it('advances the form immediately to the next word after a wrong answer', async () => {
    const entry1 = makeEntry({ id: 'e1', source: 'Tisch', target: ['table'] })
    const entry2 = makeEntry({ id: 'e2', source: 'Stuhl', target: ['chair'] })
    const session = makeSession({
      words: [
        { vocabId: 'e1', status: 'pending' },
        { vocabId: 'e2', status: 'pending' },
      ],
    })
    const sessionAfterFirst: Session = {
      ...session,
      words: [
        { vocabId: 'e1', status: 'incorrect' },
        { vocabId: 'e2', status: 'pending' },
      ],
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'incorrect',
      sessionCompleted: false,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: sessionAfterFirst,
      newBucket: 1,
    })

    render(
      <TrainingScreen
        session={session}
        vocabMap={makeVocabMap(entry1, entry2)}
        onComplete={vi.fn()}
        correctFeedbackDelayMs={0}
      />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    // Next word appears immediately, wrong banner still visible
    await waitFor(() => {
      expect(screen.getByText('Stuhl')).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('Incorrect. Correct answer: table — → bucket 1')
    })
  })

  it('clears the wrong status banner when the next answer is submitted', async () => {
    const entry1 = makeEntry({ id: 'e1', source: 'Tisch', target: ['table'] })
    const entry2 = makeEntry({ id: 'e2', source: 'Stuhl', target: ['chair'] })
    const session = makeSession({
      words: [
        { vocabId: 'e1', status: 'pending' },
        { vocabId: 'e2', status: 'pending' },
      ],
    })
    const sessionAfterFirst: Session = {
      ...session,
      words: [{ vocabId: 'e1', status: 'incorrect' }, { vocabId: 'e2', status: 'pending' }],
    }
    const completedSession: Session = {
      ...session,
      words: [{ vocabId: 'e1', status: 'incorrect' }, { vocabId: 'e2', status: 'correct' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer)
      .mockResolvedValueOnce({ correct: false, outcome: 'incorrect', sessionCompleted: false, answerCost: 0, creditsEarned: 0, perfectBonus: 0, bucketMilestoneBonus: 0, streakCredit: 0, session: sessionAfterFirst, newBucket: 1 })
      .mockResolvedValueOnce({ correct: true, outcome: 'correct', sessionCompleted: true, answerCost: 0, creditsEarned: 0, perfectBonus: 0, bucketMilestoneBonus: 0, streakCredit: 0, session: completedSession, newBucket: 1 })

    render(
      <TrainingScreen
        session={session}
        vocabMap={makeVocabMap(entry1, entry2)}
        onComplete={vi.fn()}
        correctFeedbackDelayMs={0}
      />,
    )

    // Answer first word wrong
    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => { expect(screen.getByText('Stuhl')).toBeInTheDocument() })

    // Answer second word — wrong banner should clear
    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'chair' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toHaveTextContent('Incorrect')
    })
  })

  it('advances to the next word automatically after a correct answer', async () => {
    const entry1 = makeEntry({ id: 'e1', source: 'Tisch', target: ['table'] })
    const entry2 = makeEntry({ id: 'e2', source: 'Stuhl', target: ['chair'] })
    const session = makeSession({
      words: [
        { vocabId: 'e1', status: 'pending' },
        { vocabId: 'e2', status: 'pending' },
      ],
    })
    const sessionAfterFirst: Session = {
      ...session,
      words: [
        { vocabId: 'e1', status: 'correct' },
        { vocabId: 'e2', status: 'pending' },
      ],
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: true,
      outcome: 'correct',
      sessionCompleted: false,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: sessionAfterFirst,
      newBucket: 1,
    })

    render(
      <TrainingScreen
        session={session}
        vocabMap={makeVocabMap(entry1, entry2)}
        onComplete={vi.fn()}
        correctFeedbackDelayMs={0}
      />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'table' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(screen.getByText('Stuhl')).toBeInTheDocument()
    })
  })

  it('shows a second-chance notice when outcome is second_chance', async () => {
    const entry1 = makeEntry({ id: 'e1', source: 'Tisch', target: ['table'], bucket: 4 })
    const entry2 = makeEntry({ id: 'e2', source: 'Stuhl', target: ['chair'], bucket: 4 })
    const session = makeSession({ words: [{ vocabId: 'e1', status: 'pending' }] })
    const sessionWithSecondChance: Session = {
      ...session,
      words: [
        { vocabId: 'e1', status: 'incorrect' },
        { vocabId: 'e2', status: 'pending', secondChanceFor: 'e1' },
      ],
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'second_chance',
      sessionCompleted: false,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: sessionWithSecondChance,
      newBucket: 4,
    })

    render(
      <TrainingScreen
        session={session}
        vocabMap={makeVocabMap(entry1, entry2)}
        onComplete={vi.fn()}
        correctFeedbackDelayMs={0}
      />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(screen.getByText(/Second Chance/)).toBeInTheDocument()
    })
  })

  it('shows an error when submitAnswer fails', async () => {
    const entry = makeEntry()
    const session = makeSession()

    vi.mocked(sessionApi.submitAnswer).mockRejectedValue(new Error('Network error'))

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'table' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Network error')
  })
})

// ── Auto-hint (bucket 0 and 1) ────────────────────────────────────────────────

describe('auto-hint', () => {
  it('shows a hint placeholder for a bucket-0 word (up to 2 chars revealed)', () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], bucket: 0 })
    const session = makeSession()

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    // 'table' → 'ta...' (2 chars shown for a 5-char word)
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'ta...')
  })

  it('shows a hint placeholder for a bucket-1 word (only 1 char revealed)', () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], bucket: 1 })
    const session = makeSession()

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    // 'table' → 't....' (1 char shown for a 5-char word)
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 't....')
  })

  it('shows "Hint (auto)" button label and disables it for bucket-0 word', () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], bucket: 0 })
    const session = makeSession()

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    const btn = screen.getByRole('button', { name: 'Hint (auto)' })
    expect(btn).toBeDisabled()
  })

  it('shows "Hint (10 credits)" button label and enables it for bucket-1 word', () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], bucket: 1 })
    const session = makeSession()

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} credits={100} correctFeedbackDelayMs={0} />,
    )

    const btn = screen.getByRole('button', { name: 'Hint (10 credits)' })
    expect(btn).toBeEnabled()
  })

  it('shows "Hint (free)" in a review session and enables it even with zero balance', () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], bucket: 1 })
    const session = makeSession({ type: 'review' })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} credits={0} correctFeedbackDelayMs={0} />,
    )

    const btn = screen.getByRole('button', { name: 'Hint (free)' })
    expect(btn).toBeEnabled()
  })

  it('does not spend credits when the hint button is clicked in a review session', async () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], bucket: 1 })
    const session = makeSession({ type: 'review' })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} credits={0} correctFeedbackDelayMs={0} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Hint (free)' }))

    // No backend spend call; the answer field is reset and the hint placeholder appears.
    await waitFor(() => {
      expect(vi.mocked(creditsApi.spendCredits)).not.toHaveBeenCalled()
    })
  })
})

// ── Add alternative button ────────────────────────────────────────────────────

describe('add alternative button', () => {
  beforeEach(() => {
    // Default mock: markWordCorrect resolves successfully. Tests that need a
    // specific returned session can override this with mockResolvedValueOnce.
    vi.mocked(sessionApi.markWordCorrect).mockResolvedValue(makeSession())
  })

  it('shows the add-alternative button after an incorrect answer', async () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'] })
    const session = makeSession()
    const updatedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'incorrect',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: updatedSession,
      newBucket: 1,
    })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add "auto" as alternative' })).toBeInTheDocument()
    })
  })

  it('shows the add-alternative button after a partial answer', async () => {
    const entry = makeEntry({ source: 'Akku', target: ['battery', 'rechargeable battery'] })
    const session = makeSession()
    const updatedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'partial',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: updatedSession,
      newBucket: 1,
    })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Answer 1:'), { target: { value: 'battery' } })
    fireEvent.change(screen.getByLabelText('Answer 2:'), { target: { value: 'accumulator' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add "accumulator" as alternative' })).toBeInTheDocument()
    })
  })

  it('prepends "to " to the suggested alternative when the existing translations are verb forms', async () => {
    const entry = makeEntry({ source: 'gewinnen', target: ['to win'] })
    const session = makeSession()
    const updatedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'incorrect',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: updatedSession,
      newBucket: 1,
    })
    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue({
      entry: { ...entry, target: ['to win', 'to triumph'] },
      merged: true,
    })
    vi.mocked(vocabApi.setVocabBucket).mockResolvedValue(undefined)

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'triumph' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add "to triumph" as alternative' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add "to triumph" as alternative' }))

    await waitFor(() => {
      expect(vocabApi.addOrMergeVocab).toHaveBeenCalledWith(['gewinnen'], ['to triumph'])
    })
  })

  it('does not double-prepend "to " when the user already typed it', async () => {
    const entry = makeEntry({ source: 'gewinnen', target: ['to win'] })
    const session = makeSession()
    const updatedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'incorrect',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: updatedSession,
      newBucket: 1,
    })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'to triumph' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add "to triumph" as alternative' })).toBeInTheDocument()
    })
  })

  it('does not prepend "to " when no existing translation is a verb form', async () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'] })
    const session = makeSession()
    const updatedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'incorrect',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: updatedSession,
      newBucket: 1,
    })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'desk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add "desk" as alternative' })).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: 'Add "to desk" as alternative' })).not.toBeInTheDocument()
  })

  it('does not show the add-alternative button after a correct answer', async () => {
    const entry = makeEntry({ target: ['table'] })
    const session = makeSession()
    const completedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'correct' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: true,
      outcome: 'correct',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: completedSession,
      newBucket: 1,
    })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'table' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Add .* as alternative/ })).not.toBeInTheDocument()
    })
  })

  it('calls addOrMergeVocab with the entry DE and the typed answer', async () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'] })
    const session = makeSession()
    const updatedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'incorrect',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: updatedSession,
      newBucket: 1,
    })
    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue({
      entry: { ...entry, target: ['table', 'auto'] },
      merged: true,
    })
    vi.mocked(vocabApi.setVocabBucket).mockResolvedValue(undefined)

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => screen.getByRole('button', { name: 'Add "auto" as alternative' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add "auto" as alternative' }))

    await waitFor(() => {
      expect(vocabApi.addOrMergeVocab).toHaveBeenCalledWith(['Tisch'], ['auto'])
    })
  })

  it('shows "Alternative added. Word restored to bucket X." after a successful add', async () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], bucket: 3 })
    const session = makeSession()
    const updatedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'incorrect',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: updatedSession,
      newBucket: 1,
    })
    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue({
      entry: { ...entry, target: ['table', 'auto'] },
      merged: true,
    })
    vi.mocked(vocabApi.setVocabBucket).mockResolvedValue(undefined)

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => screen.getByRole('button', { name: 'Add "auto" as alternative' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add "auto" as alternative' }))

    expect(await screen.findByText('Alternative added. Word restored to bucket 4.')).toBeInTheDocument()
  })

  it('hides the add button and shows confirmation after adding', async () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'] })
    const session = makeSession()
    const updatedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'incorrect',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: updatedSession,
      newBucket: 1,
    })
    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue({
      entry: { ...entry, target: ['table', 'auto'] },
      merged: true,
    })
    vi.mocked(vocabApi.setVocabBucket).mockResolvedValue(undefined)

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => screen.getByRole('button', { name: 'Add "auto" as alternative' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add "auto" as alternative' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Add "auto" as alternative' })).not.toBeInTheDocument()
      expect(screen.getByText('Alternative added. Word restored to bucket 1.')).toBeInTheDocument()
    })
  })

  it('calls setVocabBucket with originalBucket + 1 after adding an alternative', async () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], bucket: 2 })
    const session = makeSession()
    const updatedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'incorrect',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: updatedSession,
      newBucket: 1,
    })
    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue({ entry, merged: true })
    vi.mocked(vocabApi.setVocabBucket).mockResolvedValue(undefined)

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => screen.getByRole('button', { name: 'Add "auto" as alternative' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add "auto" as alternative' }))

    await waitFor(() => {
      expect(vocabApi.setVocabBucket).toHaveBeenCalledWith(entry.id, 3)
    })
  })

  it('refunds 1 credit when adding an alternative that had answerCost = 1', async () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], bucket: 1 })
    const session = makeSession()
    const updatedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'incorrect',
      sessionCompleted: true,
      answerCost: 1,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      session: updatedSession,
      newBucket: 1,
    })
    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue({ entry, merged: true })
    vi.mocked(vocabApi.setVocabBucket).mockResolvedValue(undefined)
    vi.mocked(creditsApi.refundCredits).mockResolvedValue(1)

    const onAnswerSubmitted = vi.fn()

    render(
      <TrainingScreen
        session={session}
        vocabMap={makeVocabMap(entry)}
        onComplete={vi.fn()}
        onAnswerSubmitted={onAnswerSubmitted}
        correctFeedbackDelayMs={0}
      />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => screen.getByRole('button', { name: 'Add "auto" as alternative' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add "auto" as alternative' }))

    await waitFor(() => {
      expect(creditsApi.refundCredits).toHaveBeenCalledWith(1)
      expect(onAnswerSubmitted).toHaveBeenCalled()
    })
  })

  it('does not call refundCredits when answerCost is 0', async () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], bucket: 1 })
    const session = makeSession()
    const updatedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'incorrect',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      session: updatedSession,
      newBucket: 1,
    })
    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue({ entry, merged: true })
    vi.mocked(vocabApi.setVocabBucket).mockResolvedValue(undefined)

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => screen.getByRole('button', { name: 'Add "auto" as alternative' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add "auto" as alternative' }))

    await waitFor(() => {
      expect(screen.getByText(/Alternative added/)).toBeInTheDocument()
    })

    expect(creditsApi.refundCredits).not.toHaveBeenCalled()
  })

  it('calls markWordCorrect so the session summary counts the word as correct', async () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], bucket: 1 })
    const session = makeSession()
    const updatedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' }],
      status: 'completed',
    }
    const correctedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'correct' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'incorrect',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      session: updatedSession,
      newBucket: 1,
    })
    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue({ entry, merged: true })
    vi.mocked(vocabApi.setVocabBucket).mockResolvedValue(undefined)
    vi.mocked(sessionApi.markWordCorrect).mockResolvedValue(correctedSession)

    const onComplete = vi.fn()

    render(
      <TrainingScreen
        session={session}
        vocabMap={makeVocabMap(entry)}
        onComplete={onComplete}
        correctFeedbackDelayMs={100}
      />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => screen.getByRole('button', { name: 'Add "auto" as alternative' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add "auto" as alternative' }))

    await waitFor(() => {
      expect(sessionApi.markWordCorrect).toHaveBeenCalledWith(session.id, entry.id)
    })

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ words: [{ vocabId: entry.id, status: 'correct' }] }),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        undefined,
        expect.anything(),
      )
    })
  })

  it('clears the add button when the next answer is submitted', async () => {
    const entry1 = makeEntry({ id: 'e1', source: 'Tisch', target: ['table'] })
    const entry2 = makeEntry({ id: 'e2', source: 'Stuhl', target: ['chair'] })
    const session = makeSession({
      words: [
        { vocabId: 'e1', status: 'pending' },
        { vocabId: 'e2', status: 'pending' },
      ],
    })
    const sessionAfterFirst: Session = {
      ...session,
      words: [
        { vocabId: 'e1', status: 'incorrect' },
        { vocabId: 'e2', status: 'pending' },
      ],
    }
    const completedSession: Session = {
      ...session,
      words: [
        { vocabId: 'e1', status: 'incorrect' },
        { vocabId: 'e2', status: 'correct' },
      ],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer)
      .mockResolvedValueOnce({ correct: false, outcome: 'incorrect', sessionCompleted: false, answerCost: 0, creditsEarned: 0, perfectBonus: 0, bucketMilestoneBonus: 0, streakCredit: 0, session: sessionAfterFirst, newBucket: 1 })
      .mockResolvedValueOnce({ correct: true, outcome: 'correct', sessionCompleted: true, answerCost: 0, creditsEarned: 0, perfectBonus: 0, bucketMilestoneBonus: 0, streakCredit: 0, session: completedSession, newBucket: 1 })

    render(
      <TrainingScreen
        session={session}
        vocabMap={makeVocabMap(entry1, entry2)}
        onComplete={vi.fn()}
        correctFeedbackDelayMs={0}
      />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => screen.getByRole('button', { name: 'Add "auto" as alternative' }))

    // Submit the next word
    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'chair' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Add "auto" as alternative' })).not.toBeInTheDocument()
    })
  })
})


// ── Typo feedback ─────────────────────────────────────────────────────────────

describe('TrainingScreen — typo feedback', () => {
  it('shows a spelling correction message for a correct_typo outcome', async () => {
    const entry = makeEntry({ target: ['machine'] })
    const session = makeSession()
    const completedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'correct' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: true,
      outcome: 'correct_typo',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: completedSession,
      newBucket: 1,
      typos: [{ typed: 'machone', correct: 'machine' }],
    })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'machone' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Correct! (Spelling: "machone" → "machine") → bucket 1',
    )
  })

  it('does not show the add-alternative button for a correct_typo outcome', async () => {
    const entry = makeEntry({ target: ['machine'] })
    const session = makeSession()
    const completedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'correct' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: true,
      outcome: 'correct_typo',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: completedSession,
      newBucket: 1,
      typos: [{ typed: 'machone', correct: 'machine' }],
    })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'machone' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await screen.findByRole('status')

    expect(screen.queryByRole('button', { name: /as alternative/i })).not.toBeInTheDocument()
  })
})

// ── Mark word (star) ──────────────────────────────────────────────────────────

describe('mark word', () => {
  it('shows an unstarred mark button for an unmarked word', () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], marked: false })
    const session = makeSession()

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByRole('button', { name: 'Mark word' })).toHaveTextContent('☆')
  })

  it('shows a filled star for an already-marked word', () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], marked: true })
    const session = makeSession()

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByRole('button', { name: 'Unmark word' })).toHaveTextContent('★')
  })

  it('calls setVocabMarked with true when clicking the unstarred button', async () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], marked: false })
    const session = makeSession()

    vi.mocked(vocabApi.setVocabMarked).mockResolvedValue({ ...entry, marked: true })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mark word' }))

    await waitFor(() => {
      expect(vocabApi.setVocabMarked).toHaveBeenCalledWith(entry.id, true)
    })
  })

  it('toggles the star to filled after marking', async () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], marked: false })
    const session = makeSession()

    vi.mocked(vocabApi.setVocabMarked).mockResolvedValue({ ...entry, marked: true })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mark word' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Unmark word' })).toHaveTextContent('★')
    })
  })

  it('calls setVocabMarked with false when clicking the filled star', async () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], marked: true })
    const session = makeSession()

    vi.mocked(vocabApi.setVocabMarked).mockResolvedValue({ ...entry, marked: false })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Unmark word' }))

    await waitFor(() => {
      expect(vocabApi.setVocabMarked).toHaveBeenCalledWith(entry.id, false)
    })
  })
})

// ── Mark word from wrong-answer line ─────────────────────────────────────────

describe('mark word from wrong-answer line', () => {
  function makeWrongAnswerResult(entry: ReturnType<typeof makeEntry>, session: ReturnType<typeof makeSession>) {
    const updatedSession = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' as const }],
      status: 'completed' as const,
    }
    return {
      correct: false as const,
      outcome: 'incorrect' as const,
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      session: updatedSession,
      newBucket: 1,
    }
  }

  it('shows an unstarred mark button on the wrong-answer line for an unmarked word', async () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], marked: false })
    const session = makeSession()

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue(makeWrongAnswerResult(entry, session))

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => screen.getByRole('button', { name: 'Mark "Tisch"' }))
    expect(screen.getByRole('button', { name: 'Mark "Tisch"' })).toHaveTextContent('☆')
  })

  it('shows a filled star on the wrong-answer line for an already-marked word', async () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], marked: true })
    const session = makeSession()

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue(makeWrongAnswerResult(entry, session))

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => screen.getByRole('button', { name: 'Unmark "Tisch"' }))
    expect(screen.getByRole('button', { name: 'Unmark "Tisch"' })).toHaveTextContent('★')
  })

  it('calls setVocabMarked when clicking the star on the wrong-answer line', async () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], marked: false })
    const session = makeSession()

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue(makeWrongAnswerResult(entry, session))
    vi.mocked(vocabApi.setVocabMarked).mockResolvedValue({ ...entry, marked: true })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => screen.getByRole('button', { name: 'Mark "Tisch"' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark "Tisch"' }))

    await waitFor(() => {
      expect(vocabApi.setVocabMarked).toHaveBeenCalledWith(entry.id, true)
    })
  })

  it('toggles the wrong-answer star to filled after marking', async () => {
    const entry = makeEntry({ source: 'Tisch', target: ['table'], marked: false })
    const session = makeSession()

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue(makeWrongAnswerResult(entry, session))
    vi.mocked(vocabApi.setVocabMarked).mockResolvedValue({ ...entry, marked: true })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => screen.getByRole('button', { name: 'Mark "Tisch"' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark "Tisch"' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Unmark "Tisch"' })).toHaveTextContent('★')
    })
  })
})

// ── Star button on partial answer (no new answers to add) ─────────────────────

describe('mark word on partial answer without new alternatives', () => {
  function makePartialResult(entry: ReturnType<typeof makeEntry>, session: ReturnType<typeof makeSession>) {
    const updatedSession = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' as const }],
      status: 'completed' as const,
    }
    return {
      correct: false as const,
      outcome: 'partial' as const,
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      session: updatedSession,
      newBucket: 1,
    }
  }

  it('shows a star button even when the typed answer already exists (no Add button)', async () => {
    // entry has two translations; user typed one of them → newAnswers is empty
    const entry = makeEntry({ source: 'Feierabend', target: ['end of shift', 'knock-off time'], marked: false })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue(makePartialResult(entry, session))

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Answer 1:'), { target: { value: 'end of shift' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => screen.getByRole('button', { name: 'Mark "Feierabend"' }))
    expect(screen.getByRole('button', { name: 'Mark "Feierabend"' })).toHaveTextContent('☆')
  })

  it('does not show an "Add" button when there are no new answers', async () => {
    const entry = makeEntry({ source: 'Feierabend', target: ['end of shift', 'knock-off time'], marked: false })
    const session = makeSession({ words: [{ vocabId: entry.id, status: 'pending' }] })

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue(makePartialResult(entry, session))

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    fireEvent.change(screen.getByLabelText('Answer 1:'), { target: { value: 'end of shift' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => screen.getByRole('button', { name: 'Mark "Feierabend"' }))
    expect(screen.queryByRole('button', { name: /Add ".*" as alternative/ })).not.toBeInTheDocument()
  })
})

// ── Stress session ────────────────────────────────────────────────────────────

describe('stress session', () => {
  it('shows "Stress Session" title', () => {
    const entry = makeEntry({ bucket: 3 })
    const session = makeSession({ type: 'stress' })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByRole('heading', { name: 'Stress Session' })).toBeInTheDocument()
  })

  it('hides the hint button', () => {
    const entry = makeEntry({ bucket: 3 })
    const session = makeSession({ type: 'stress' })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} credits={1000} correctFeedbackDelayMs={0} />,
    )

    expect(screen.queryByRole('button', { name: /Hint/ })).not.toBeInTheDocument()
  })

  it('shows the timer bar with initial time for a single-field word', () => {
    const entry = makeEntry({ bucket: 3, target: ['table'] })
    const session = makeSession({ type: 'stress' })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} credits={1000} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByLabelText('Time remaining: 10 seconds')).toBeInTheDocument()
  })

  it('shows the timer bar with initial time for a two-field word', () => {
    const entry = makeEntry({ bucket: 3, target: ['bicycle', 'bike'] })
    const session = makeSession({ type: 'stress' })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} credits={1000} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByLabelText('Time remaining: 15 seconds')).toBeInTheDocument()
  })

  it('shows the credit balance in the timer bar', () => {
    const entry = makeEntry({ bucket: 3 })
    const session = makeSession({ type: 'stress' })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} credits={750} correctFeedbackDelayMs={0} />,
    )

    expect(screen.getByText('Balance: 750 credits')).toBeInTheDocument()
  })

  it('does not show a timer bar for a normal session', () => {
    const entry = makeEntry({ bucket: 3 })
    const session = makeSession({ type: 'normal' })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} credits={1000} correctFeedbackDelayMs={0} />,
    )

    expect(screen.queryByLabelText(/Time remaining/)).not.toBeInTheDocument()
  })

  it('auto-submits when the timer reaches zero', async () => {
    vi.useFakeTimers()

    const entry = makeEntry({ bucket: 3, target: ['table'] })
    const session = makeSession({ type: 'stress' })
    const completedSession: Session = {
      ...session,
      words: [{ vocabId: entry.id, status: 'incorrect' }],
      status: 'completed',
    }

    vi.mocked(sessionApi.submitAnswer).mockResolvedValue({
      correct: false,
      outcome: 'incorrect',
      sessionCompleted: true,
      answerCost: 0,
      creditsEarned: 0,
      perfectBonus: 0,
      bucketMilestoneBonus: 0,
      streakCredit: 0,
      creditsSpent: 0,
      session: completedSession,
      newBucket: 2,
    })

    render(
      <TrainingScreen session={session} vocabMap={makeVocabMap(entry)} onComplete={vi.fn()} correctFeedbackDelayMs={0} />,
    )

    // Advance past the 10-second limit; the interval callback fires synchronously.
    vi.advanceTimersByTime(11000)

    // Restore real timers before waitFor so its internal polling works.
    vi.useRealTimers()

    await waitFor(() => {
      expect(sessionApi.submitAnswer).toHaveBeenCalledTimes(1)
    })
  })
})
