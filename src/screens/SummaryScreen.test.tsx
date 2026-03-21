/**
 * Tests for the SummaryScreen component.
 */
import { render, screen, fireEvent } from '@testing-library/react'

import { SummaryScreen } from './SummaryScreen.tsx'
import type { Session } from '../../shared/types/Session.ts'

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    direction: 'DE_TO_EN',
    words: [],
    status: 'completed',
    createdAt: '2026-01-01T00:00:00Z',
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
