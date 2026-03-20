/**
 * HTTP client for the credits endpoint (`/api/v1/vocab/credits`).
 *
 * @example
 * ```ts
 * import { getCredits, spendCredits, refundCredits } from './creditsApi.ts'
 * const credits = await getCredits()
 * await spendCredits(10)
 * await refundCredits(1)
 * ```
 */

const BASE = '/api/v1/vocab'

/** Fetches the total credit count for all vocabulary entries. */
export async function getCredits(): Promise<number> {
  const res = await fetch(`${BASE}/credits`)

  if (!res.ok) {
    throw new Error(`Failed to fetch credits: ${res.status}`)
  }

  const data = (await res.json()) as { credits: number }

  return data.credits
}

/**
 * Spends the given number of credits.
 * Returns the new balance after deduction.
 * @throws if the server returns an error (e.g. 402 Insufficient credits).
 */
export async function spendCredits(amount: number): Promise<number> {
  const res = await fetch(`${BASE}/credits/spend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  })

  if (!res.ok) {
    throw new Error(`Failed to spend credits: ${res.status}`)
  }

  const data = (await res.json()) as { credits: number }

  return data.credits
}

/**
 * Refunds the given number of credits back to the balance.
 * Used when an answer is accepted as a valid alternative after being marked wrong.
 * Returns the new balance after the refund.
 */
export async function refundCredits(amount: number): Promise<number> {
  const res = await fetch(`${BASE}/credits/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  })

  if (!res.ok) {
    throw new Error(`Failed to refund credits: ${res.status}`)
  }

  const data = (await res.json()) as { credits: number }

  return data.credits
}
