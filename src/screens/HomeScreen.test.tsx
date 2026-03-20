/**
 * Tests for the HomeScreen component.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { HomeScreen } from './HomeScreen.tsx'
import { isEveningStreakWarning } from '../utils/streakWarning.ts'
import * as sessionApi from '../api/sessionApi.ts'
import * as vocabApi from '../api/vocabApi.ts'

vi.mock('../api/sessionApi.ts', () => ({
  getOpenSession: vi.fn(),
  createSession: vi.fn(),
}))

vi.mock('../api/streakApi.ts', () => ({
  saveStreak: vi.fn(),
  activatePause: vi.fn(),
  resumePause: vi.fn(),
  PAUSE_BUDGET_DAYS: 14,
}))

vi.mock('../api/vocabApi.ts', () => ({
  listVocab: vi.fn(),
}))

const mockSession = {
  id: 'session-1',
  direction: 'DE_TO_EN' as const,
  words: [{ vocabId: 'entry-1', status: 'pending' as const }],
  status: 'open' as const,
  createdAt: '2026-01-01T00:00:00Z',
}

// Session where at least one word has been answered — qualifies as "in progress"
const mockSessionInProgress = {
  ...mockSession,
  words: [
    { vocabId: 'entry-1', status: 'correct' as const },
    { vocabId: 'entry-2', status: 'pending' as const },
  ],
}

const mockEntry = {
  id: 'entry-1',
  de: ['Tisch'],
  en: ['table'],
  bucket: 0,
  lastAskedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('HomeScreen', () => {
  it('shows loading state initially', () => {
    vi.mocked(sessionApi.getOpenSession).mockReturnValue(new Promise(() => undefined))

    render(<HomeScreen onStartTraining={vi.fn()} onViewVocab={vi.fn()} />)

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows "Start new session" when no session is open', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(<HomeScreen onStartTraining={vi.fn()} onViewVocab={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Start new session' })).toBeInTheDocument()
  })

  it('shows "Continue session" when a session is in progress (at least one word answered)', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(mockSessionInProgress)

    render(<HomeScreen onStartTraining={vi.fn()} onViewVocab={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Continue session' })).toBeInTheDocument()
  })

  it('shows "Start new session" when the open session has 0 answered words', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(mockSession)

    render(<HomeScreen onStartTraining={vi.fn()} onViewVocab={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Start new session' })).toBeInTheDocument()
  })

  it('reuses the unstarted session without calling createSession when clicking "Start new session"', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(mockSession)
    vi.mocked(vocabApi.listVocab).mockResolvedValue([mockEntry])

    const onStartTraining = vi.fn()

    render(<HomeScreen onStartTraining={onStartTraining} onViewVocab={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Start new session' }))

    await waitFor(() => {
      expect(onStartTraining).toHaveBeenCalledWith(mockSession, expect.any(Map))
    })

    expect(vi.mocked(sessionApi.createSession)).not.toHaveBeenCalled()
  })

  it('treats an open session with no pending words as if no session exists', async () => {
    const staleSession = { ...mockSession, words: [{ vocabId: 'w1', status: 'correct' as const }] }

    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(staleSession)

    render(<HomeScreen onStartTraining={vi.fn()} onViewVocab={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Start new session' })).toBeInTheDocument()
  })

  it('shows an error when getOpenSession fails', async () => {
    vi.mocked(sessionApi.getOpenSession).mockRejectedValue(new Error('Network error'))

    render(<HomeScreen onStartTraining={vi.fn()} onViewVocab={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Network error')
  })

  it('calls onStartTraining with a new session after clicking "Start new session"', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)
    vi.mocked(sessionApi.createSession).mockResolvedValue(mockSession)
    vi.mocked(vocabApi.listVocab).mockResolvedValue([mockEntry])

    const onStartTraining = vi.fn()

    render(<HomeScreen onStartTraining={onStartTraining} onViewVocab={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Start new session' }))

    await waitFor(() => {
      expect(onStartTraining).toHaveBeenCalledWith(
        mockSession,
        new Map([['entry-1', mockEntry]]),
      )
    })
  })

  it('shows a "View vocabulary" button', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(<HomeScreen onStartTraining={vi.fn()} onViewVocab={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'View vocabulary' })).toBeInTheDocument()
  })

  it('calls onViewVocab when "View vocabulary" is clicked', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    const onViewVocab = vi.fn()

    render(<HomeScreen onStartTraining={vi.fn()} onViewVocab={onViewVocab} />)

    fireEvent.click(await screen.findByRole('button', { name: 'View vocabulary' }))

    expect(onViewVocab).toHaveBeenCalledOnce()
  })

  it('calls onStartTraining with the existing session after clicking "Continue session"', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(mockSessionInProgress)
    vi.mocked(vocabApi.listVocab).mockResolvedValue([mockEntry])

    const onStartTraining = vi.fn()

    render(<HomeScreen onStartTraining={onStartTraining} onViewVocab={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Continue session' }))

    await waitFor(() => {
      expect(onStartTraining).toHaveBeenCalledWith(mockSessionInProgress, expect.any(Map))
    })

    expect(vi.mocked(sessionApi.createSession)).not.toHaveBeenCalled()
  })
})

describe('HomeScreen — streak display', () => {
  it('shows the current streak count when streak is provided', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(<HomeScreen onStartTraining={vi.fn()} onViewVocab={vi.fn()} streak={{ count: 7, saveAvailable: false, lastSessionDate: null, nextMilestone: null }} />)

    expect(await screen.findByText('Current streak: 7 days')).toBeInTheDocument()
  })

  it('uses singular "day" when streak count is 1', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(<HomeScreen onStartTraining={vi.fn()} onViewVocab={vi.fn()} streak={{ count: 1, saveAvailable: false, lastSessionDate: null, nextMilestone: null }} />)

    expect(await screen.findByText('Current streak: 1 day')).toBeInTheDocument()
  })

  it('shows next milestone info on the streak line when nextMilestone is set', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(
      <HomeScreen
        onStartTraining={vi.fn()}
        onViewVocab={vi.fn()}
        streak={{ count: 3, saveAvailable: false, lastSessionDate: null, nextMilestone: { label: 'Week 1', credits: 10, daysUntil: 4 } }}
      />,
    )

    expect(await screen.findByText(/Next: Week 1 \(10 credits\) in 4 days/)).toBeInTheDocument()
  })

  it('does not show next milestone info when nextMilestone is null', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(
      <HomeScreen
        onStartTraining={vi.fn()}
        onViewVocab={vi.fn()}
        streak={{ count: 3, saveAvailable: false, lastSessionDate: null, nextMilestone: null }}
      />,
    )

    await screen.findByRole('button', { name: 'Start new session' })

    expect(screen.queryByText(/Next:/)).not.toBeInTheDocument()
  })

  it('does not show streak when streak prop is null', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(<HomeScreen onStartTraining={vi.fn()} onViewVocab={vi.fn()} streak={null} />)

    await screen.findByRole('button', { name: 'Start new session' })

    expect(screen.queryByText(/Current streak/)).not.toBeInTheDocument()
  })

  it('shows the save-streak warning when saveAvailable is true', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(<HomeScreen onStartTraining={vi.fn()} onViewVocab={vi.fn()} streak={{ count: 5, saveAvailable: true, lastSessionDate: null, nextMilestone: null }} credits={100} />)

    expect(await screen.findByRole('status')).toHaveTextContent('Your streak is at risk')
    expect(screen.getByRole('button', { name: /Save streak/ })).toBeInTheDocument()
  })

  it('does not show the save-streak warning when saveAvailable is false', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(<HomeScreen onStartTraining={vi.fn()} onViewVocab={vi.fn()} streak={{ count: 5, saveAvailable: false, lastSessionDate: null, nextMilestone: null }} />)

    await screen.findByRole('button', { name: 'Start new session' })

    expect(screen.queryByText(/streak is at risk/)).not.toBeInTheDocument()
  })

  it('disables the save-streak button when credits are below 50', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(<HomeScreen onStartTraining={vi.fn()} onViewVocab={vi.fn()} streak={{ count: 5, saveAvailable: true, lastSessionDate: null, nextMilestone: null }} credits={40} />)

    const saveBtn = await screen.findByRole('button', { name: /Save streak/ })

    expect(saveBtn).toBeDisabled()
  })
})

// ── isEveningStreakWarning ────────────────────────────────────────────────────

describe('isEveningStreakWarning', () => {
  it('returns false when lastSessionDate is null', () => {
    expect(isEveningStreakWarning(null, new Date(2026, 2, 16, 21, 0, 0))).toBe(false)
  })

  it('returns false when the hour is before 20:00', () => {
    const yesterday = new Date(2026, 2, 15).toLocaleDateString('en-CA')

    expect(isEveningStreakWarning(yesterday, new Date(2026, 2, 16, 19, 59, 59))).toBe(false)
  })

  it('returns true when last session was yesterday and hour is exactly 20:00', () => {
    const yesterday = new Date(2026, 2, 15).toLocaleDateString('en-CA')

    expect(isEveningStreakWarning(yesterday, new Date(2026, 2, 16, 20, 0, 0))).toBe(true)
  })

  it('returns true when last session was yesterday and hour is after 20:00', () => {
    const yesterday = new Date(2026, 2, 15).toLocaleDateString('en-CA')

    expect(isEveningStreakWarning(yesterday, new Date(2026, 2, 16, 22, 30, 0))).toBe(true)
  })

  it('returns false when last session was today', () => {
    const today = new Date(2026, 2, 16).toLocaleDateString('en-CA')

    expect(isEveningStreakWarning(today, new Date(2026, 2, 16, 21, 0, 0))).toBe(false)
  })

  it('returns false when last session was the day before yesterday (saveAvailable territory)', () => {
    const twoDaysAgo = new Date(2026, 2, 14).toLocaleDateString('en-CA')

    expect(isEveningStreakWarning(twoDaysAgo, new Date(2026, 2, 16, 21, 0, 0))).toBe(false)
  })
})

// ── Evening streak warning in HomeScreen ─────────────────────────────────────

describe('HomeScreen — evening streak warning', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the evening warning when last session was yesterday and time is after 20:00', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 16, 21, 0, 0))

    const yesterday = new Date(2026, 2, 15).toLocaleDateString('en-CA')

    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(
      <HomeScreen
        onStartTraining={vi.fn()}
        onViewVocab={vi.fn()}
        streak={{ count: 3, saveAvailable: false, lastSessionDate: yesterday, nextMilestone: null }}
      />,
    )

    expect(await screen.findByRole('status')).toHaveTextContent('Your streak is at risk! Start a session now to save it.')
  })

  it('does not show the evening warning when time is before 20:00', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 16, 19, 30, 0))

    const yesterday = new Date(2026, 2, 15).toLocaleDateString('en-CA')

    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(
      <HomeScreen
        onStartTraining={vi.fn()}
        onViewVocab={vi.fn()}
        streak={{ count: 3, saveAvailable: false, lastSessionDate: yesterday, nextMilestone: null }}
      />,
    )

    await screen.findByRole('button', { name: 'Start new session' })

    expect(screen.queryByText(/Start a session now to save it/)).not.toBeInTheDocument()
  })

  it('does not show the evening warning when saveAvailable is true (pay-to-save banner takes precedence)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 16, 21, 0, 0))

    const yesterday = new Date(2026, 2, 15).toLocaleDateString('en-CA')

    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(
      <HomeScreen
        onStartTraining={vi.fn()}
        onViewVocab={vi.fn()}
        streak={{ count: 3, saveAvailable: true, lastSessionDate: yesterday, nextMilestone: null }}
        credits={100}
      />,
    )

    await screen.findByRole('button', { name: /Save streak/ })

    expect(screen.queryByText(/Start a session now to save it/)).not.toBeInTheDocument()
  })
})

// ── HomeScreen — pause mode ───────────────────────────────────────────────────

import * as streakApi from '../api/streakApi.ts'

const pauseOff: streakApi.PauseInfo = { active: false, startDate: null, daysConsumed: 0, budgetRemaining: 14, daysToCharge: 0 }
const pauseOn: streakApi.PauseInfo = { active: true, startDate: '2026-03-11', daysConsumed: 5, budgetRemaining: 9, daysToCharge: 5 }

describe('HomeScreen — pause mode', () => {
  it('shows the "Pause game" button when streak is active and not paused', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(
      <HomeScreen
        onStartTraining={vi.fn()}
        onViewVocab={vi.fn()}
        streak={{ count: 5, saveAvailable: false, lastSessionDate: '2026-03-15', nextMilestone: null, pause: pauseOff }}
      />,
    )

    expect(await screen.findByRole('button', { name: /Pause game/ })).toBeInTheDocument()
  })

  it('shows retroactive days in the pause button label when days were missed', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)
    const pauseWithRetro: streakApi.PauseInfo = { ...pauseOff, daysToCharge: 2, budgetRemaining: 14 }

    render(
      <HomeScreen
        onStartTraining={vi.fn()}
        onViewVocab={vi.fn()}
        streak={{ count: 5, saveAvailable: false, lastSessionDate: '2026-03-14', nextMilestone: null, pause: pauseWithRetro }}
      />,
    )

    expect(await screen.findByRole('button', { name: /charges 2 days/ })).toBeInTheDocument()
  })

  it('disables the pause button when retroactive days exceed the budget', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)
    const noBudget: streakApi.PauseInfo = { active: false, startDate: null, daysConsumed: 14, budgetRemaining: 0, daysToCharge: 3 }

    render(
      <HomeScreen
        onStartTraining={vi.fn()}
        onViewVocab={vi.fn()}
        streak={{ count: 5, saveAvailable: false, lastSessionDate: '2026-03-13', nextMilestone: null, pause: noBudget }}
      />,
    )

    expect(await screen.findByRole('button', { name: /Pause game/ })).toBeDisabled()
  })

  it('calls activatePause and onStreakRefresh when pause button is clicked', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)
    vi.mocked(streakApi.activatePause).mockResolvedValue(pauseOn)
    const onStreakRefresh = vi.fn()

    render(
      <HomeScreen
        onStartTraining={vi.fn()}
        onViewVocab={vi.fn()}
        onStreakRefresh={onStreakRefresh}
        streak={{ count: 5, saveAvailable: false, lastSessionDate: '2026-03-15', nextMilestone: null, pause: pauseOff }}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /Pause game/ }))

    await waitFor(() => {
      expect(vi.mocked(streakApi.activatePause)).toHaveBeenCalledOnce()
      expect(onStreakRefresh).toHaveBeenCalledOnce()
    })
  })

  it('shows the paused banner and hides start/continue session when paused', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(
      <HomeScreen
        onStartTraining={vi.fn()}
        onViewVocab={vi.fn()}
        streak={{ count: 10, saveAvailable: false, lastSessionDate: '2026-03-10', nextMilestone: null, pause: pauseOn }}
      />,
    )

    await screen.findByRole('status')

    expect(screen.getByRole('status')).toHaveTextContent('Game paused since 2026-03-11')
    expect(screen.queryByRole('button', { name: /Start new session/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Continue session/ })).not.toBeInTheDocument()
  })

  it('shows the "Resume game" button when paused', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(
      <HomeScreen
        onStartTraining={vi.fn()}
        onViewVocab={vi.fn()}
        streak={{ count: 10, saveAvailable: false, lastSessionDate: '2026-03-10', nextMilestone: null, pause: pauseOn }}
      />,
    )

    expect(await screen.findByRole('button', { name: 'Resume game' })).toBeInTheDocument()
  })

  it('calls resumePause and onStreakRefresh when resume button is clicked', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)
    vi.mocked(streakApi.resumePause).mockResolvedValue({ creditsAwarded: 0, milestoneLabels: [] })
    const onStreakRefresh = vi.fn()

    render(
      <HomeScreen
        onStartTraining={vi.fn()}
        onViewVocab={vi.fn()}
        onStreakRefresh={onStreakRefresh}
        streak={{ count: 10, saveAvailable: false, lastSessionDate: '2026-03-10', nextMilestone: null, pause: pauseOn }}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Resume game' }))

    await waitFor(() => {
      expect(vi.mocked(streakApi.resumePause)).toHaveBeenCalledOnce()
      expect(onStreakRefresh).toHaveBeenCalledOnce()
    })
  })
})
