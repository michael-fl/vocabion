/**
 * Smoke tests for the App component.
 *
 * Verifies that the application renders and the home screen is shown on load.
 */
import { render, screen } from '@testing-library/react'

import App from './App.tsx'
import * as sessionApi from '../api/sessionApi.ts'

vi.mock('../api/sessionApi.ts', () => ({
  getOpenSession: vi.fn(),
  createSession: vi.fn(),
}))

vi.mock('../api/vocabApi.ts', () => ({
  listVocab: vi.fn(),
}))

describe('App', () => {
  it('renders the home screen on load', async () => {
    vi.mocked(sessionApi.getOpenSession).mockResolvedValue(null)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Vocabion' })).toBeInTheDocument()
  })
})
