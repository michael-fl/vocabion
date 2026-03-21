/**
 * Theme management hook for Vocabion.
 *
 * Reads the active theme from `localStorage`, applies it as a
 * `data-theme` attribute on `<html>`, and exposes a setter that
 * persists and applies any theme change instantly.
 *
 * The anti-flash inline script in `index.html` sets `data-theme`
 * before React starts — this hook stays in sync with that value.
 *
 * @example
 * ```tsx
 * const { theme, setTheme, themes } = useTheme()
 * // theme: 'scholar' | 'slate' | 'forest'
 * // setTheme('slate') — persists and applies immediately
 * // themes — readonly array of all available theme names
 * ```
 */
import { useState, useCallback } from 'react'

export const THEMES = ['scholar', 'slate', 'forest'] as const

export type Theme = (typeof THEMES)[number]

const STORAGE_KEY = 'vocabion-theme'
const DEFAULT_THEME: Theme = 'scholar'

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)

  return (THEMES as readonly string[]).includes(stored ?? '')
    ? (stored as Theme)
    : DEFAULT_THEME
}

/**
 * Returns the current theme name, a setter, and the full list of themes.
 * Applying the theme is a side-effect-free operation on the DOM and
 * localStorage — no context provider is required.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme)

  const setTheme = useCallback((newTheme: Theme) => {
    document.documentElement.dataset.theme = newTheme
    localStorage.setItem(STORAGE_KEY, newTheme)
    setThemeState(newTheme)
  }, [])

  return { theme, setTheme, themes: THEMES }
}
