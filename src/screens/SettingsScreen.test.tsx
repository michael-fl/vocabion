/**
 * Tests for the SettingsScreen component.
 */
import { render, screen, fireEvent } from '@testing-library/react'

import { SettingsScreen } from './SettingsScreen.tsx'
import type { Theme, Mode } from '../hooks/useTheme.ts'

const defaultProps = {
  theme: 'scholar' as Theme,
  onThemeChange: () => undefined,
  mode: 'light' as Mode,
  onModeChange: () => undefined,
}

describe('SettingsScreen — theme picker', () => {
  it('renders all three theme options', () => {
    render(<SettingsScreen {...defaultProps} />)

    expect(screen.getByLabelText('Select Scholar theme')).toBeInTheDocument()
    expect(screen.getByLabelText('Select Slate theme')).toBeInTheDocument()
    expect(screen.getByLabelText('Select Forest theme')).toBeInTheDocument()
  })

  it('marks the current theme as active', () => {
    render(<SettingsScreen {...defaultProps} theme="slate" />)

    expect(screen.getByLabelText('Select Slate theme')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Select Scholar theme')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('Select Forest theme')).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onThemeChange when a theme card is clicked', () => {
    const onThemeChange = vi.fn<(theme: Theme) => void>()

    render(<SettingsScreen {...defaultProps} onThemeChange={onThemeChange} />)

    fireEvent.click(screen.getByLabelText('Select Forest theme'))

    expect(onThemeChange).toHaveBeenCalledWith('forest')
  })

  it('shows the settings heading', () => {
    render(<SettingsScreen {...defaultProps} />)

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })
})

describe('SettingsScreen — mode toggle', () => {
  it('renders Light and Dark buttons', () => {
    render(<SettingsScreen {...defaultProps} />)

    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument()
  })

  it('marks the current mode as active', () => {
    render(<SettingsScreen {...defaultProps} mode="dark" />)

    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onModeChange when Dark is clicked', () => {
    const onModeChange = vi.fn<(mode: Mode) => void>()

    render(<SettingsScreen {...defaultProps} onModeChange={onModeChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))

    expect(onModeChange).toHaveBeenCalledWith('dark')
  })

  it('calls onModeChange when Light is clicked', () => {
    const onModeChange = vi.fn<(mode: Mode) => void>()

    render(<SettingsScreen {...defaultProps} mode="dark" onModeChange={onModeChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Light' }))

    expect(onModeChange).toHaveBeenCalledWith('light')
  })
})
