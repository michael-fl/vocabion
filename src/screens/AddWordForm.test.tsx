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
    source: 'Auto',
    target: ['car'],
    bucket: 0,
    lastAskedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    maxBucket: 0,
    marked: false,
    manuallyAdded: false,
    score: 0,
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

    expect(screen.getByLabelText('Source:')).toBeInTheDocument()
    expect(screen.getByLabelText('Target:')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('shows an error when submitted with empty fields', async () => {
    render(<AddWordForm onSuccess={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please enter at least one source and one target word.',
    )
  })

  it('shows an error when only DE is filled', async () => {
    render(<AddWordForm onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Source:'), { target: { value: 'Auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please enter at least one source and one target word.',
    )
  })

  it('calls addOrMergeVocab with parsed DE array and EN array on submit', async () => {
    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue([{ entry: makeEntry(), merged: false }])

    render(<AddWordForm onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Source:'), { target: { value: 'bessern, revidieren' } })
    fireEvent.change(screen.getByLabelText('Target:'), { target: { value: 'amend' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(vocabApi.addOrMergeVocab).toHaveBeenCalledWith(['bessern', 'revidieren'], ['amend'])
    })
  })

  it('shows "Word added" status when a single new entry is created', async () => {
    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue([{ entry: makeEntry(), merged: false }])

    render(<AddWordForm onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Source:'), { target: { value: 'Auto' } })
    fireEvent.change(screen.getByLabelText('Target:'), { target: { value: 'car' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Word added: Auto — car')
  })

  it('shows "Merged" status when a single entry is merged', async () => {
    const merged = makeEntry({ source: 'Auto', target: ['car', 'automobile'] })

    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue([{ entry: merged, merged: true }])

    render(<AddWordForm onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Source:'), { target: { value: 'Auto' } })
    fireEvent.change(screen.getByLabelText('Target:'), { target: { value: 'automobile' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Merged into existing entry: Auto — car, automobile',
    )
  })

  it('shows summary when multiple words are submitted', async () => {
    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue([
      { entry: makeEntry({ source: 'bessern' }), merged: false },
      { entry: makeEntry({ source: 'revidieren' }), merged: false },
    ])

    render(<AddWordForm onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Source:'), { target: { value: 'bessern, revidieren' } })
    fireEvent.change(screen.getByLabelText('Target:'), { target: { value: 'amend' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('status')).toHaveTextContent('2 words saved (2 added)')
  })

  it('clears the inputs after a successful submit', async () => {
    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue([{ entry: makeEntry(), merged: false }])

    render(<AddWordForm onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Source:'), { target: { value: 'Auto' } })
    fireEvent.change(screen.getByLabelText('Target:'), { target: { value: 'car' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Source:')).toHaveValue('')
      expect(screen.getByLabelText('Target:')).toHaveValue('')
    })
  })

  it('calls onSuccess after a successful submit', async () => {
    vi.mocked(vocabApi.addOrMergeVocab).mockResolvedValue([{ entry: makeEntry(), merged: false }])

    const onSuccess = vi.fn()

    render(<AddWordForm onSuccess={onSuccess} />)

    fireEvent.change(screen.getByLabelText('Source:'), { target: { value: 'Auto' } })
    fireEvent.change(screen.getByLabelText('Target:'), { target: { value: 'car' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledOnce()
    })
  })

  it('shows an error when the API call fails', async () => {
    vi.mocked(vocabApi.addOrMergeVocab).mockRejectedValue(new Error('Network error'))

    render(<AddWordForm onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Source:'), { target: { value: 'Auto' } })
    fireEvent.change(screen.getByLabelText('Target:'), { target: { value: 'car' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Network error')
  })
})
