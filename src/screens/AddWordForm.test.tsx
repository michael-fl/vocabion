/**
 * Tests for the AddWordForm component.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { AddWordForm } from './AddWordForm.tsx'
import * as vocabApi from '../api/vocabApi.ts'
import type { VocabEntry } from '../../shared/types/VocabEntry.ts'

vi.mock('../api/vocabApi.ts', () => ({
  addOrMergeVocab: vi.fn(),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<VocabEntry> = {}): VocabEntry {
  return {
    id: 'entry-1',
    de: ['Auto'],
    en: ['car'],
    bucket: 0,
    lastAskedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    maxBucket: 0,
    marked: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AddWordForm', () => {
  it('renders DE and EN input fields and a submit button', () => {
    render(<AddWordForm onSuccess={vi.fn()} />)

    expect(screen.getByLabelText('DE:')).toBeInTheDocument()
    expect(screen.getByLabelText('EN:')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('shows an error when submitted with empty fields', async () => {
    render(<AddWordForm onSuccess={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please enter at least one German and one English word.',
    )
  })

  it('shows an error when only DE is filled', async () => {
    render(<AddWordForm onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('DE:'), { target: { value: 'Auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please enter at least one German and one English word.',
    )
  })

  it('calls addOrMergeVocab with parsed arrays on submit', async () => {
    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue({ entry: makeEntry(), merged: false })

    render(<AddWordForm onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('DE:'), { target: { value: 'Auto, Automobil' } })
    fireEvent.change(screen.getByLabelText('EN:'), { target: { value: 'car, auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(vocabApi.addOrMergeVocab).toHaveBeenCalledWith(['Auto', 'Automobil'], ['car', 'auto'])
    })
  })

  it('shows "Word added" status on successful create', async () => {
    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue({ entry: makeEntry(), merged: false })

    render(<AddWordForm onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('DE:'), { target: { value: 'Auto' } })
    fireEvent.change(screen.getByLabelText('EN:'), { target: { value: 'car' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Word added: Auto — car')
  })

  it('shows "Merged" status on successful merge', async () => {
    const merged = makeEntry({ de: ['Auto', 'Automobil'], en: ['car', 'automobile'] })

    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue({ entry: merged, merged: true })

    render(<AddWordForm onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('DE:'), { target: { value: 'Auto' } })
    fireEvent.change(screen.getByLabelText('EN:'), { target: { value: 'automobile' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Merged into existing entry: Auto, Automobil — car, automobile',
    )
  })

  it('clears the inputs after a successful submit', async () => {
    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue({ entry: makeEntry(), merged: false })

    render(<AddWordForm onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('DE:'), { target: { value: 'Auto' } })
    fireEvent.change(screen.getByLabelText('EN:'), { target: { value: 'car' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(screen.getByLabelText('DE:')).toHaveValue('')
      expect(screen.getByLabelText('EN:')).toHaveValue('')
    })
  })

  it('calls onSuccess after a successful submit', async () => {
    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue({ entry: makeEntry(), merged: false })

    const onSuccess = vi.fn()

    render(<AddWordForm onSuccess={onSuccess} />)

    fireEvent.change(screen.getByLabelText('DE:'), { target: { value: 'Auto' } })
    fireEvent.change(screen.getByLabelText('EN:'), { target: { value: 'car' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledOnce()
    })
  })

  it('shows an error when the API call fails', async () => {
    vi.mocked(vocabApi.addOrMergeVocab).mockRejectedValue(new Error('Network error'))

    render(<AddWordForm onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('DE:'), { target: { value: 'Auto' } })
    fireEvent.change(screen.getByLabelText('EN:'), { target: { value: 'car' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Network error')
  })
})
