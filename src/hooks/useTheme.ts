/**
 * Theme and colour-mode management hook for Vocabion.
 *
 * Manages two orthogonal preferences:
 * - **theme** (`'scholar' | 'slate' | 'forest'`) — the colour scheme.
 * - **mode** (`'light' | 'dark'`) — light or dark variant of that scheme.
 *
 * Both are persisted to `localStorage` and applied as HTML attributes
 * (`data-theme`, `data-mode`) before React hydrates (see the anti-flash
 * script in `index.html`). This hook stays in sync with those values.
 *
 * @example
 * ```tsx
 * const { theme, setTheme, themes, mode, setMode, modes } = useTheme()
 * // setTheme('slate')   — persists and applies immediately
 * // setMode('dark')     — persists and applies immediately
 * ```
 */
import { useState, useCallback } from 'react'

export const THEMES = ['scholar', 'slate', 'forest'] as const
export const MODES  = ['light', 'dark'] as const

export type Theme = (typeof THEMES)[number]
export type Mode  = (typeof MODES)[number]

const STORAGE_KEY_THEME = 'vocabion-theme'
const STORAGE_KEY_MODE  = 'vocabion-mode'
const DEFAULT_THEME: Theme = 'scholar'
const DEFAULT_MODE: Mode   = 'light'

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY_THEME)

  return (THEMES as readonly string[]).includes(stored ?? '')
    ? (stored as Theme)
    : DEFAULT_THEME
}

function readStoredMode(): Mode {
  const stored = localStorage.getItem(STORAGE_KEY_MODE)

  return (MODES as readonly string[]).includes(stored ?? '')
    ? (stored as Mode)
    : DEFAULT_MODE
}

/**
 * Returns the active theme and mode, setters for both, and the full
 * lists of available values. No context provider required.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme)
  const [mode,  setModeState]  = useState<Mode>(readStoredMode)

  const setTheme = useCallback((newTheme: Theme) => {
    document.documentElement.dataset.theme = newTheme
    localStorage.setItem(STORAGE_KEY_THEME, newTheme)
    setThemeState(newTheme)
  }, [])

  const setMode = useCallback((newMode: Mode) => {
    document.documentElement.dataset.mode = newMode
    localStorage.setItem(STORAGE_KEY_MODE, newMode)
    setModeState(newMode)
  }, [])

  return { theme, setTheme, themes: THEMES, mode, setMode, modes: MODES }
}
