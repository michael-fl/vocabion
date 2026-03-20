/**
 * Tests for the VocabListScreen component.
 */
import { render, screen, fireEvent, within } from '@testing-library/react'

import { VocabListScreen } from './VocabListScreen.tsx'
import * as vocabApi from '../api/vocabApi.ts'
import type { VocabEntry } from '../../shared/types/VocabEntry.ts'

vi.mock('../api/vocabApi.ts', () => ({
  listVocab: vi.fn(),
  setVocabMarked: vi.fn(),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

let idSeq = 0

function makeEntry(overrides: Partial<VocabEntry> = {}): VocabEntry {
  idSeq++
  return {
    id: `entry-${idSeq}`,
    de: 'Tisch',
    en: ['table'],
    bucket: 0,
    lastAskedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    maxBucket: 0,
    marked: false,
    score: 0,
    ...overrides,
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  idSeq = 0
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VocabListScreen', () => {
  it('shows loading state initially', () => {
    vi.mocked(vocabApi.listVocab).mockReturnValue(new Promise(() => undefined))

    render(<VocabListScreen onBack={vi.fn()} />)

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders one collapsible section per bucket', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ bucket: 0 }),
      makeEntry({ bucket: 2 }),
      makeEntry({ bucket: 5 }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    expect(await screen.findByText(/Bucket 0/)).toBeInTheDocument()
    expect(screen.getByText(/Bucket 2/)).toBeInTheDocument()
    expect(screen.getByText(/Bucket 5/)).toBeInTheDocument()
  })

  it('shows word count in the bucket summary', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ bucket: 0 }),
      makeEntry({ bucket: 0 }),
      makeEntry({ bucket: 1 }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    expect(await screen.findByText(/Bucket 0 — 2 words/)).toBeInTheDocument()
    expect(screen.getByText(/Bucket 1 — 1 word/)).toBeInTheDocument()
  })

  it('renders buckets in ascending order', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ bucket: 5 }),
      makeEntry({ bucket: 0 }),
      makeEntry({ bucket: 2 }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    await screen.findByText(/Bucket 0/)

    const summaries = screen.getAllByRole('group').map((el) =>
      el.querySelector('summary')?.textContent ?? '',
    )

    expect(summaries[0]).toMatch(/Bucket 0/)
    expect(summaries[1]).toMatch(/Bucket 2/)
    expect(summaries[2]).toMatch(/Bucket 5/)
  })

  it('bucket sections are collapsed by default', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0 }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    await screen.findByText(/Bucket 0/)

    // The <details> element should not have the open attribute
    const details = document.querySelector('details')

    expect(details).not.toBeNull()
    expect(details?.open).toBe(false)
  })

  it('shows words inside a bucket after expanding it', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0 }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    const summary = await screen.findByText(/Bucket 0/)

    fireEvent.click(summary)

    expect(screen.getByText('Tisch')).toBeInTheDocument()
    expect(screen.getByText('table')).toBeInTheDocument()
  })

  it('sorts words alphabetically within a bucket', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0 }),
      makeEntry({ de: 'Apfel', en: ['apple'], bucket: 0 }),
      makeEntry({ de: 'Buch', en: ['book'], bucket: 0 }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    const summary = await screen.findByText(/Bucket 0/)

    fireEvent.click(summary)

    // 4 columns per row (German, English, star, Score); take every 4th cell starting at 0
    const cells = screen.getAllByRole('cell').filter((_, i) => i % 4 === 0)

    expect(cells.map((c) => c.textContent)).toEqual(['Apfel', 'Buch', 'Tisch'])
  })

  it('renders each German or English variant as a separate dictionary link', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: 'Gemüse', en: ['vegetable', 'vegetables'], bucket: 0 }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    fireEvent.click(await screen.findByText(/Bucket 0/))

    expect(screen.getByRole('link', { name: 'Gemüse' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'vegetable' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'vegetables' })).toBeInTheDocument()
  })

  it('shows a "Due in" column header for time-based buckets (≥ 4)', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ bucket: 4, lastAskedAt: null }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    fireEvent.click(await screen.findByText(/Bucket 4/))

    expect(screen.getByRole('columnheader', { name: 'Due in' })).toBeInTheDocument()
  })

  it('does not show a "Due in" column for frequency buckets (< 4)', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ bucket: 0 }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    fireEvent.click(await screen.findByText(/Bucket 0/))

    expect(screen.queryByRole('columnheader', { name: 'Due in' })).not.toBeInTheDocument()
  })

  it('shows "due now" for a time-based word that has never been asked', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ bucket: 4, lastAskedAt: null }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    fireEvent.click(await screen.findByText(/Bucket 4/))

    expect(screen.getByText('due now')).toBeInTheDocument()
  })

  it('shows remaining time for a time-based word not yet due', async () => {
    // bucket 4 → 22 h interval; asked ~12 hours ago → ~10 hours left
    const sixDaysAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()

    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ bucket: 4, lastAskedAt: sixDaysAgo }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    fireEvent.click(await screen.findByText(/Bucket 4/))

    expect(screen.getByText(/in \d+ (day|hour|minute)/)).toBeInTheDocument()
  })

  it('shows an empty state when no entries exist', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([])

    render(<VocabListScreen onBack={vi.fn()} />)

    expect(await screen.findByText('No vocabulary entries yet.')).toBeInTheDocument()
    expect(document.querySelector('details')).toBeNull()
  })

  it('shows an error message when listVocab fails', async () => {
    vi.mocked(vocabApi.listVocab).mockRejectedValue(new Error('Network error'))

    render(<VocabListScreen onBack={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Network error')
  })

  it('calls onBack when the back button is clicked', () => {
    vi.mocked(vocabApi.listVocab).mockReturnValue(new Promise(() => undefined))

    const onBack = vi.fn()

    render(<VocabListScreen onBack={onBack} />)

    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }))

    expect(onBack).toHaveBeenCalledOnce()
  })
})

// ── Marked section ────────────────────────────────────────────────────────────

describe('Marked section', () => {
  it('shows the Marked section when at least one entry is marked', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0, marked: true }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    expect(await screen.findByText(/^Marked —/)).toBeInTheDocument()
  })

  it('does not show the Marked section when no entries are marked', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0, marked: false }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    await screen.findByText(/Bucket 0/)

    expect(screen.queryByText(/^Marked —/)).not.toBeInTheDocument()
  })

  it('shows word count in the Marked section summary', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0, marked: true }),
      makeEntry({ de: 'Apfel', en: ['apple'], bucket: 1, marked: true }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    expect(await screen.findByText(/^Marked — 2 words/)).toBeInTheDocument()
  })

  it('sorts marked words alphabetically', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0, marked: true }),
      makeEntry({ de: 'Apfel', en: ['apple'], bucket: 1, marked: true }),
      makeEntry({ de: 'Buch', en: ['book'], bucket: 2, marked: true }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    const summary = await screen.findByText(/^Marked —/)

    fireEvent.click(summary)

    // Scope to this section to avoid picking up cells from bucket sections
    const section = summary.closest('details')
    if (section === null) { throw new Error('details element not found') }
    // 6 columns per row in cross-section (German, English, Bucket, Due in, star, Score)
    const germanCells = within(section).getAllByRole('cell').filter((_, i) => i % 6 === 0)

    expect(germanCells.map((c) => c.textContent)).toEqual(['Apfel', 'Buch', 'Tisch'])
  })

  it('shows the Bucket column in the Marked section', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: ['Tisch'], en: ['table'], bucket: 3, marked: true }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    fireEvent.click(await screen.findByText(/^Marked —/))

    expect(screen.getByRole('columnheader', { name: 'Bucket' })).toBeInTheDocument()
  })

  it('shows Due in for time-based words in the Marked section', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: ['Tisch'], en: ['table'], bucket: 4, lastAskedAt: null, marked: true }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    fireEvent.click(await screen.findByText(/^Marked —/))

    expect(screen.getAllByText('due now').length).toBeGreaterThan(0)
  })

  it('shows words in both Marked section and their bucket section', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0, marked: true }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    fireEvent.click(await screen.findByText(/^Marked —/))
    fireEvent.click(screen.getByText(/Bucket 0/))

    // "Tisch" and "table" should each appear twice (once per section)
    expect(screen.getAllByText('Tisch')).toHaveLength(2)
    expect(screen.getAllByText('table')).toHaveLength(2)
  })
})

// ── Scored section ─────────────────────────────────────────────────────────────

describe('Scored section', () => {
  it('shows the Scored section when at least one entry has score > 0', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0, score: 1 }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    expect(await screen.findByText(/^Scored —/)).toBeInTheDocument()
  })

  it('does not show the Scored section when all entries have score 0', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0, score: 0 }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    await screen.findByText(/Bucket 0/)

    expect(screen.queryByText(/^Scored —/)).not.toBeInTheDocument()
  })

  it('shows word count in the Scored section summary', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0, score: 2 }),
      makeEntry({ de: 'Apfel', en: ['apple'], bucket: 1, score: 1 }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    expect(await screen.findByText(/^Scored — 2 words/)).toBeInTheDocument()
  })

  it('sorts scored words by score descending, then alphabetically on ties', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0, score: 1 }),
      makeEntry({ de: 'Apfel', en: ['apple'], bucket: 0, score: 3 }),
      makeEntry({ de: 'Buch', en: ['book'], bucket: 0, score: 1 }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    const summary = await screen.findByText(/^Scored —/)

    fireEvent.click(summary)

    // Scope to this section to avoid picking up cells from bucket sections
    const section = summary.closest('details')
    if (section === null) { throw new Error('details element not found') }
    // 6 columns per row in cross-section
    const germanCells = within(section).getAllByRole('cell').filter((_, i) => i % 6 === 0)

    expect(germanCells.map((c) => c.textContent)).toEqual(['Apfel', 'Buch', 'Tisch'])
  })

  it('shows words in both Scored section and their bucket section', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0, score: 2 }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    fireEvent.click(await screen.findByText(/^Scored —/))
    fireEvent.click(screen.getByText(/Bucket 0/))

    expect(screen.getAllByText('Tisch')).toHaveLength(2)
    expect(screen.getAllByText('table')).toHaveLength(2)
  })
})

// ── Star toggle ───────────────────────────────────────────────────────────────

describe('star toggle', () => {
  it('shows ★ button for a marked entry', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0, marked: true }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    fireEvent.click(await screen.findByText(/Bucket 0/))

    // Marked section also has a button, so there may be multiple — both should show ★
    expect(screen.getAllByRole('button', { name: 'Unmark' }).length).toBeGreaterThanOrEqual(1)
  })

  it('shows ☆ button for an unmarked entry', async () => {
    vi.mocked(vocabApi.listVocab).mockResolvedValue([
      makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0, marked: false }),
    ])

    render(<VocabListScreen onBack={vi.fn()} />)

    fireEvent.click(await screen.findByText(/Bucket 0/))

    expect(screen.getByRole('button', { name: 'Mark' })).toBeInTheDocument()
    expect(screen.queryByText('★')).not.toBeInTheDocument()
  })

  it('calls setVocabMarked(id, true) when clicking ☆', async () => {
    const entry = makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0, marked: false })

    vi.mocked(vocabApi.listVocab).mockResolvedValue([entry])
    vi.mocked(vocabApi.setVocabMarked).mockResolvedValue({ ...entry, marked: true })

    render(<VocabListScreen onBack={vi.fn()} />)

    fireEvent.click(await screen.findByText(/Bucket 0/))
    fireEvent.click(screen.getByRole('button', { name: 'Mark' }))

    expect(vocabApi.setVocabMarked).toHaveBeenCalledWith(entry.id, true)
  })

  it('calls setVocabMarked(id, false) when clicking ★', async () => {
    const entry = makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0, marked: true })

    vi.mocked(vocabApi.listVocab).mockResolvedValue([entry])
    vi.mocked(vocabApi.setVocabMarked).mockResolvedValue({ ...entry, marked: false })

    render(<VocabListScreen onBack={vi.fn()} />)

    fireEvent.click(await screen.findByText(/Bucket 0/))

    const section = screen.getByText(/Bucket 0/).closest('details')
    if (section === null) { throw new Error('details not found') }
    fireEvent.click(within(section).getByRole('button', { name: 'Unmark' }))

    expect(vocabApi.setVocabMarked).toHaveBeenCalledWith(entry.id, false)
  })

  it('updates the star button after a successful toggle', async () => {
    const entry = makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0, marked: false })

    vi.mocked(vocabApi.listVocab).mockResolvedValue([entry])
    vi.mocked(vocabApi.setVocabMarked).mockResolvedValue({ ...entry, marked: true })

    render(<VocabListScreen onBack={vi.fn()} />)

    fireEvent.click(await screen.findByText(/Bucket 0/))
    fireEvent.click(screen.getByRole('button', { name: 'Mark' }))

    // After the API resolves the button(s) should flip to ★ (word may appear in multiple sections)
    expect((await screen.findAllByRole('button', { name: 'Unmark' })).length).toBeGreaterThanOrEqual(1)
  })

  it('disables the star button while the request is in-flight', async () => {
    const entry = makeEntry({ de: ['Tisch'], en: ['table'], bucket: 0, marked: false })

    vi.mocked(vocabApi.listVocab).mockResolvedValue([entry])

    let resolve!: (v: VocabEntry) => void
    vi.mocked(vocabApi.setVocabMarked).mockReturnValue(new Promise((r) => { resolve = r }))

    render(<VocabListScreen onBack={vi.fn()} />)

    fireEvent.click(await screen.findByText(/Bucket 0/))

    const btn = screen.getByRole('button', { name: 'Mark' })

    fireEvent.click(btn)

    expect(btn).toBeDisabled()

    resolve({ ...entry, marked: true })
  })
})
