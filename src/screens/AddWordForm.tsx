/**
 * Form for adding a new vocabulary entry or merging translations into an existing one.
 *
 * The user enters comma-separated German and English variants. On submit:
 * - If no existing entry shares a German word, a new entry is created.
 * - If a match is found, the new variants are merged in (duplicates removed).
 *
 * @example
 * ```tsx
 * <AddWordForm onSuccess={() => reloadEntries()} />
 * ```
 */
import { useState } from 'react'

import * as vocabApi from '../api/vocabApi.ts'

export interface AddWordFormProps {
  /** Called after a successful add or merge so the parent can refresh its list. */
  onSuccess: () => void
}

/** Splits a comma-separated string into a trimmed, non-empty array of values. */
function parseVariants(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Form for adding or merging a vocabulary entry. */
export function AddWordForm({ onSuccess }: AddWordFormProps) {
  const [de, setDe] = useState('')
  const [en, setEn] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setSuccessMessage(null)
    setError(null)

    const deVariants = parseVariants(de)
    const enVariants = parseVariants(en)

    if (deVariants.length === 0 || enVariants.length === 0) {
      setError('Please enter at least one German and one English word.')
      return
    }

    setSubmitting(true)

    try {
      const result = await vocabApi.addOrMergeVocab(deVariants, enVariants)

      setSuccessMessage(
        result.merged
          ? `Merged into existing entry: ${result.entry.de.join(', ')} — ${result.entry.en.join(', ')}`
          : `Word added: ${result.entry.de.join(', ')} — ${result.entry.en.join(', ')}`,
      )
      setDe('')
      setEn('')
      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save word')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      <h2>Add word</h2>

      <div>
        <label>
          DE:
          <input
            type="text"
            value={de}
            placeholder="e.g. Auto, Automobil"
            onChange={(e) => { setDe(e.target.value) }}
          />
        </label>
      </div>

      <div>
        <label>
          EN:
          <input
            type="text"
            value={en}
            placeholder="e.g. car, auto"
            onChange={(e) => { setEn(e.target.value) }}
          />
        </label>
      </div>

      {error !== null && <p role="alert">{error}</p>}

      {successMessage !== null && <p role="status">{successMessage}</p>}

      <button type="submit" disabled={submitting}>
        Add
      </button>
    </form>
  )
}
