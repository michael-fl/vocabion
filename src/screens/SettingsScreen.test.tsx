/**
 * Tests for the SettingsScreen component.
 */
import { render, screen, fireEvent } from '@testing-library/react'

import { SettingsScreen } from './SettingsScreen.tsx'
import type { Theme } from '../hooks/useTheme.ts'

describe('SettingsScreen', () => {
  it('renders all three theme options', () => {
    render(<SettingsScreen theme="scholar" onThemeChange={() => undefined} />)

    expect(screen.getByLabelText('Select Scholar theme')).toBeInTheDocument()
    expect(screen.getByLabelText('Select Slate theme')).toBeInTheDocument()
    expect(screen.getByLabelText('Select Forest theme')).toBeInTheDocument()
  })

  it('marks the current theme as active', () => {
    render(<SettingsScreen theme="slate" onThemeChange={() => undefined} />)

    expect(screen.getByLabelText('Select Slate theme')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Select Scholar theme')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('Select Forest theme')).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onThemeChange when a theme card is clicked', () => {
    const onThemeChange = vi.fn<(theme: Theme) => void>()

    render(<SettingsScreen theme="scholar" onThemeChange={onThemeChange} />)

    fireEvent.click(screen.getByLabelText('Select Forest theme'))

    expect(onThemeChange).toHaveBeenCalledWith('forest')
  })

  it('shows the settings heading', () => {
    render(<SettingsScreen theme="scholar" onThemeChange={() => undefined} />)

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })
})
