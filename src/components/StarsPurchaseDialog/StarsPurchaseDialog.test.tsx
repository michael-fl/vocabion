/**
 * Tests for StarsPurchaseDialog.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { StarsPurchaseDialog } from './StarsPurchaseDialog.tsx'
import type { StarsOffer } from '../../api/starsApi.ts'

const offer: StarsOffer = { shouldOffer: true, maxBuyable: 3, costPerStar: 500 }

const noop = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Step 1: confirm ───────────────────────────────────────────────────────────

describe('StarsPurchaseDialog — confirm step', () => {
  it('shows the credit balance and max buyable count', () => {
    render(<StarsPurchaseDialog offer={offer} credits={1545} onPurchase={noop} onSnooze={noop} />)

    expect(screen.getByText(/1[.,]545 credits/)).toBeInTheDocument()
    expect(screen.getByText(/up to 3 stars/)).toBeInTheDocument()
  })

  it('renders "Yes" and "No" buttons', () => {
    render(<StarsPurchaseDialog offer={offer} credits={1000} onPurchase={noop} onSnooze={noop} />)

    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument()
  })

  it('advances to the select step when "Yes" is clicked', async () => {
    render(<StarsPurchaseDialog offer={offer} credits={1000} onPurchase={noop} onSnooze={noop} />)

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))

    expect(await screen.findByText('How many stars?')).toBeInTheDocument()
  })

  it('calls onSnooze when "No" is clicked', async () => {
    const onSnooze = vi.fn().mockResolvedValue(undefined)

    render(<StarsPurchaseDialog offer={offer} credits={1000} onPurchase={noop} onSnooze={onSnooze} />)

    fireEvent.click(screen.getByRole('button', { name: 'No' }))

    await waitFor(() => {
      expect(onSnooze).toHaveBeenCalledOnce()
    })
  })

  it('uses singular "star" when maxBuyable is 1', () => {
    const singleOffer: StarsOffer = { shouldOffer: true, maxBuyable: 1, costPerStar: 500 }

    render(<StarsPurchaseDialog offer={singleOffer} credits={500} onPurchase={noop} onSnooze={noop} />)

    expect(screen.getByText(/up to 1 star for/)).toBeInTheDocument()
  })
})

// ── Step 2: select ────────────────────────────────────────────────────────────

describe('StarsPurchaseDialog — select step', () => {
  function renderAtSelectStep(buyable = 3) {
    const o: StarsOffer = { shouldOffer: true, maxBuyable: buyable, costPerStar: 500 }

    render(<StarsPurchaseDialog offer={o} credits={buyable * 500} onPurchase={noop} onSnooze={noop} />)

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
  }

  it('shows one button per buyable count', async () => {
    renderAtSelectStep(3)

    await screen.findByText('How many stars?')

    expect(screen.getByRole('button', { name: /★ 1 star/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /★★ 2 stars/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /★★★ 3 stars/ })).toBeInTheDocument()
  })

  it('shows the correct credit cost on each option', async () => {
    renderAtSelectStep(3)

    await screen.findByText('How many stars?')

    expect(screen.getByRole('button', { name: /1 star/ })).toHaveTextContent('500')
    expect(screen.getByRole('button', { name: /2 stars/ })).toHaveTextContent(/1[.,]000/)
    expect(screen.getByRole('button', { name: /3 stars/ })).toHaveTextContent(/1[.,]500/)
  })

  it('calls onPurchase with the correct count when a star option is clicked', async () => {
    const onPurchase = vi.fn().mockResolvedValue(undefined)

    render(<StarsPurchaseDialog offer={offer} credits={1500} onPurchase={onPurchase} onSnooze={noop} />)

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))

    await screen.findByText('How many stars?')

    fireEvent.click(screen.getByRole('button', { name: /2 stars/ }))

    await waitFor(() => {
      expect(onPurchase).toHaveBeenCalledWith(2)
    })
  })

  it('calls onSnooze when "Cancel" is clicked', async () => {
    const onSnooze = vi.fn().mockResolvedValue(undefined)

    render(<StarsPurchaseDialog offer={offer} credits={1500} onPurchase={noop} onSnooze={onSnooze} />)

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))

    await screen.findByText('How many stars?')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(onSnooze).toHaveBeenCalledOnce()
    })
  })

  it('renders a "Cancel" button', async () => {
    renderAtSelectStep(2)

    await screen.findByText('How many stars?')

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })
})
