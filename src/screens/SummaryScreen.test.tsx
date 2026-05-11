/**
 * Tests for the SummaryScreen component.
 */
import { render, screen, fireEvent } from '@testing-library/react'

import { SummaryScreen } from './SummaryScreen.tsx'
import type { Session } from '../../shared/types/Session.ts'

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    direction: 'SOURCE_TO_TARGET',
    words: [],
    status: 'completed',
    createdAt: '2026-01-01T00:00:00Z',
    firstAnsweredAt: null,
    ...overrides,
  }
}

describe('SummaryScreen', () => {
  it('shows the session complete heading', () => {
    render(<SummaryScreen session={makeSession()} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Session complete' })).toBeInTheDocument()
  })

  it('shows correct and incorrect counts for original words', () => {
    const session = makeSession({
      words: [
        { vocabId: 'w1', status: 'correct' },
        { vocabId: 'w2', status: 'correct' },
        { vocabId: 'w3', status: 'incorrect' },
      ],
    })

    render(<SummaryScreen session={session} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} />)

    expect(screen.getByText('Correct: 2 / 3')).toBeInTheDocument()
    expect(screen.getByText('Incorrect: 1 / 3')).toBeInTheDocument()
  })

  it('does not show second-chance section when there are no second-chance words', () => {
    const session = makeSession({
      words: [{ vocabId: 'w1', status: 'correct' }],
    })

    render(<SummaryScreen session={session} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} />)

    expect(screen.queryByText('Second-chance words')).not.toBeInTheDocument()
  })

  it('shows second-chance section when second-chance words are present', () => {
    const session = makeSession({
      words: [
        { vocabId: 'w1', status: 'incorrect' },
        { vocabId: 'w2', status: 'correct', secondChanceFor: 'w1' },
      ],
    })

    render(<SummaryScreen session={session} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Second-chance words' })).toBeInTheDocument()
    expect(screen.getByText('Correct: 1 / 1')).toBeInTheDocument()
  })

  it('calls onBack when "Back to home" is clicked', () => {
    const onBack = vi.fn()

    render(<SummaryScreen session={makeSession()} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={onBack} />)

    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }))

    expect(onBack).toHaveBeenCalledOnce()
  })

  it('shows the perfect session celebration banner when perfectBonus > 0', () => {
    render(<SummaryScreen session={makeSession()} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={10} streakCredit={0} onBack={vi.fn()} />)

    expect(screen.getByText('Perfect session!')).toBeInTheDocument()
    expect(screen.getByText('+10 bonus credits')).toBeInTheDocument()
  })

  it('does not show the perfect session banner when perfectBonus is 0', () => {
    render(<SummaryScreen session={makeSession()} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} />)

    expect(screen.queryByText('Perfect session!')).not.toBeInTheDocument()
  })

  it('includes the perfect bonus in the Total', () => {
    render(<SummaryScreen session={makeSession()} sessionCost={2} creditsEarned={3} creditsSpent={1} perfectBonus={10} streakCredit={0} onBack={vi.fn()} />)

    // 3 earned - 1 spent - 2 cost + 10 bonus = 10
    expect(screen.getByText('Total: 10 credits')).toBeInTheDocument()
  })

  it('shows the daily streak bonus line when streakCredit > 0', () => {
    render(<SummaryScreen session={makeSession()} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={10} onBack={vi.fn()} />)

    expect(screen.getByText('Daily streak bonus: +10 credits')).toBeInTheDocument()
  })

  it('does not show the streak bonus line when streakCredit is 0', () => {
    render(<SummaryScreen session={makeSession()} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} />)

    expect(screen.queryByText(/Daily streak bonus/)).not.toBeInTheDocument()
  })

  it('includes the streak credit in the Total', () => {
    render(<SummaryScreen session={makeSession()} sessionCost={1} creditsEarned={2} creditsSpent={0} perfectBonus={0} streakCredit={10} onBack={vi.fn()} />)

    // 2 earned - 0 spent - 1 cost + 0 bonus + 10 streak = 11
    expect(screen.getByText('Total: 11 credits')).toBeInTheDocument()
  })

  it('shows the milestone celebration line when milestoneLabel is set', () => {
    render(<SummaryScreen session={makeSession()} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={10} milestoneLabel="Week 1" onBack={vi.fn()} />)

    expect(screen.getByText('Streak milestone: Week 1! +10 credits')).toBeInTheDocument()
    expect(screen.queryByText(/Daily streak bonus/)).not.toBeInTheDocument()
  })

  it('shows the daily streak bonus (not milestone) when milestoneLabel is absent', () => {
    render(<SummaryScreen session={makeSession()} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={1} onBack={vi.fn()} />)

    expect(screen.getByText('Daily streak bonus: +1 credits')).toBeInTheDocument()
    expect(screen.queryByText(/Streak milestone/)).not.toBeInTheDocument()
  })
})

// ── Focus Replay offer ────────────────────────────────────────────────────────

describe('Focus Replay offer', () => {
  function makeFocusSession(totalWords: number, incorrectCount: number): Session {
    const words: Session['words'] = Array.from({ length: totalWords }, (_, i) => ({
      vocabId: `w${i}`,
      status: i < incorrectCount ? ('incorrect' as const) : ('correct' as const),
    }))

    return makeSession({ type: 'focus', words })
  }

  it('shows the replay offer when error rate >= 25% on a focus session', () => {
    // 3 out of 12 = 25%
    const session = makeFocusSession(12, 3)

    render(<SummaryScreen session={session} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} onReplay={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Play again' })).toBeInTheDocument()
  })

  it('does not show the replay offer when error rate < 25%', () => {
    // 2 out of 12 ≈ 16.7%
    const session = makeFocusSession(12, 2)

    render(<SummaryScreen session={session} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} onReplay={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Play again' })).not.toBeInTheDocument()
  })

  it('does not show the replay offer for non-focus sessions even with high error rate', () => {
    const words = Array.from({ length: 4 }, (_, i) => ({
      vocabId: `w${i}`,
      status: 'incorrect' as const,
    }))
    const session = makeSession({ type: 'normal', words })

    render(<SummaryScreen session={session} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} onReplay={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Play again' })).not.toBeInTheDocument()
  })

  it('does not show the replay offer when replayCount is 2 (maximum replays reached)', () => {
    const session = makeFocusSession(12, 3)

    render(<SummaryScreen session={session} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} onReplay={vi.fn()} replayCount={2} />)

    expect(screen.queryByRole('button', { name: 'Play again' })).not.toBeInTheDocument()
  })

  it('shows Replay 2 offer when replayCount is 1 and there is at least 1 incorrect answer', () => {
    // 1 incorrect out of 12 — below 25% threshold, but qualifies for Replay 2
    const session = makeFocusSession(12, 1)

    render(<SummaryScreen session={session} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} onReplay={vi.fn()} replayCount={1} />)

    expect(screen.getByRole('button', { name: 'Play again' })).toBeInTheDocument()
  })

  it('does not show Replay 2 offer when replayCount is 1 and all answers were correct', () => {
    const session = makeFocusSession(12, 0)

    render(<SummaryScreen session={session} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} onReplay={vi.fn()} replayCount={1} />)

    expect(screen.queryByRole('button', { name: 'Play again' })).not.toBeInTheDocument()
  })

  it('does not show the replay offer when onReplay is not provided', () => {
    const session = makeFocusSession(12, 3)

    render(<SummaryScreen session={session} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Play again' })).not.toBeInTheDocument()
  })

  it('calls onReplay when "Play again" is clicked', () => {
    const onReplay = vi.fn()
    const session = makeFocusSession(12, 3)

    render(<SummaryScreen session={session} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} onReplay={onReplay} />)

    fireEvent.click(screen.getByRole('button', { name: 'Play again' }))

    expect(onReplay).toHaveBeenCalledOnce()
  })

  it('excludes second-chance words when computing the error rate', () => {
    // 2 original words incorrect, 1 correct + 1 second-chance word
    // error rate = 2/3 ≈ 67% → offer should show
    const session = makeSession({
      type: 'focus',
      words: [
        { vocabId: 'w1', status: 'incorrect' },
        { vocabId: 'w2', status: 'incorrect' },
        { vocabId: 'w3', status: 'correct' },
        { vocabId: 'w4', status: 'correct', secondChanceFor: 'w2' },
      ],
    })

    render(<SummaryScreen session={session} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} onReplay={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Play again' })).toBeInTheDocument()
  })
})

// ── Review session ────────────────────────────────────────────────────────────

describe('SummaryScreen — review session', () => {
  function makeReviewSession(): Session {
    return makeSession({
      type: 'review',
      words: [
        { vocabId: 'w1', status: 'correct' },
        { vocabId: 'w2', status: 'incorrect' },
      ],
    })
  }

  it('shows a "Review Session complete" heading', () => {
    render(<SummaryScreen session={makeReviewSession()} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Review Session complete' })).toBeInTheDocument()
  })

  it('does not show the "Credits earned", "Credits spent", or "Session cost" rows', () => {
    render(<SummaryScreen session={makeReviewSession()} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} />)

    expect(screen.queryByText(/Credits earned/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Credits spent/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Session cost/)).not.toBeInTheDocument()
  })

  it('does not show the perfect-session bonus row even when perfectBonus > 0', () => {
    render(<SummaryScreen session={makeReviewSession()} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={20} streakCredit={0} onBack={vi.fn()} />)

    expect(screen.queryByText(/Perfect session bonus/)).not.toBeInTheDocument()
  })

  it('shows an explanatory line stating review sessions pay no credits', () => {
    render(<SummaryScreen session={makeReviewSession()} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} />)

    expect(screen.getByText(/No credit bonus for a review session/)).toBeInTheDocument()
  })

  it('does not show the daily streak bonus row for a review session', () => {
    // Backend should never send streakCredit > 0 for a review session; defend
    // the UI from accidentally bragging about a streak bonus that didn't happen.
    render(<SummaryScreen session={makeReviewSession()} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} />)

    expect(screen.queryByText(/Daily streak bonus/)).not.toBeInTheDocument()
  })

  it('does not show the replay-on-summary offer for a review session even when onReplay is given', () => {
    render(<SummaryScreen session={makeReviewSession()} sessionCost={0} creditsEarned={0} creditsSpent={0} perfectBonus={0} streakCredit={0} onBack={vi.fn()} onReplay={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Play again' })).not.toBeInTheDocument()
  })
})
