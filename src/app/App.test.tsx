/**
 * Smoke tests for the App component.
 *
 * Verifies that the application renders with the app shell and that the
 * home screen content is shown on load.
 */
import { render, screen } from '@testing-library/react'

import App from './App.tsx'
import * as sessionApi from '../api/sessionApi.ts'

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' && false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
})

vi.mock('../api/sessionApi.ts', () => ({
  getOpenSession: vi.fn(),
  createSession: vi.fn(),
}))

vi.mock('../api/vocabApi.ts', () => ({
  listVocab: vi.fn(),
}))

describe('App', () => {
  it('renders the app shell with the Vocabion title', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(<App />)

    expect(await screen.findByText('Vocabion')).toBeInTheDocument()
  })

  it('renders the Start new session button on the home screen', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(<App />)

    expect(await screen.findByRole('button', { name: 'Start new session' })).toBeInTheDocument()
  })
})
