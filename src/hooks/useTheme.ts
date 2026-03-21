/**
 * Theme and colour-mode management hook for Vocabion.
 *
 * Manages two orthogonal preferences:
 * - **theme** (`'scholar' | 'slate' | 'forest'`) — the colour scheme.
 * - **mode** (`'light' | 'dark' | 'auto'`) — light, dark, or follow the OS.
 *
 * When mode is `'auto'` the effective `data-mode` attribute tracks
 * `prefers-color-scheme` and updates automatically whenever the OS
 * switches (e.g. at sunset). Both preferences are persisted to
 * `localStorage` and applied before React hydrates (see the anti-flash
 * script in `index.html`).
 *
 * @example
 * ```tsx
 * const { theme, setTheme, themes, mode, setMode, modes } = useTheme()
 * // setTheme('slate')   — persists and applies immediately
 * // setMode('auto')     — follows OS light/dark preference
 * ```
 */
import { useState, useCallback, useEffect } from 'react'

export const THEMES = ['scholar', 'slate', 'forest'] as const
export const MODES  = ['light', 'dark', 'auto'] as const

export type Theme = (typeof THEMES)[number]
export type Mode  = (typeof MODES)[number]

const STORAGE_KEY_THEME = 'vocabion-theme'
const STORAGE_KEY_MODE  = 'vocabion-mode'
const DEFAULT_THEME: Theme = 'scholar'
const DEFAULT_MODE: Mode   = 'auto'

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

/** Resolves the OS preference to 'light' or 'dark'. */
function osPreference(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Applies the correct data-mode attribute for the given mode choice. */
function applyMode(mode: Mode) {
  document.documentElement.dataset.mode = mode === 'auto' ? osPreference() : mode
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
    applyMode(newMode)
    localStorage.setItem(STORAGE_KEY_MODE, newMode)
    setModeState(newMode)
  }, [])

  // When mode is 'auto', apply the current OS preference and keep data-mode in sync.
  useEffect(() => {
    if (mode !== 'auto') {
      return
    }

    applyMode('auto')

    const mq = window.matchMedia('(prefers-color-scheme: dark)')

    function onOsChange() {
      document.documentElement.dataset.mode = osPreference()
    }

    mq.addEventListener('change', onOsChange)

    return () => { mq.removeEventListener('change', onOsChange) }
  }, [mode])

  return { theme, setTheme, themes: THEMES, mode, setMode, modes: MODES }
}
