/**
 * Tests for the useTheme hook.
 */
import { renderHook, act } from '@testing-library/react'

import { useTheme, THEMES, MODES } from './useTheme.ts'

const STORAGE_KEY_THEME = 'vocabion-theme'
const STORAGE_KEY_MODE  = 'vocabion-mode'

// Stub matchMedia — jsdom does not implement it.
const mockMatchMedia = (dark: boolean) => {
  const listeners: (() => void)[] = []

  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' && dark,
    addEventListener: (_: string, fn: () => void) => { listeners.push(fn) },
    removeEventListener: (_: string, fn: () => void) => {
      const idx = listeners.indexOf(fn)
      if (idx !== -1) { listeners.splice(idx, 1) }
    },
  }))

  return { triggerChange: () => { listeners.forEach((fn) => { fn() }) } }
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-mode')
  mockMatchMedia(false) // default: OS is light
})

describe('useTheme — theme', () => {
  it('defaults to scholar when localStorage is empty', () => {
    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('scholar')
  })

  it('reads an existing valid theme from localStorage', () => {
    localStorage.setItem(STORAGE_KEY_THEME, 'slate')

    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('slate')
  })

  it('falls back to scholar for an unknown stored value', () => {
    localStorage.setItem(STORAGE_KEY_THEME, 'unknown-theme')

    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('scholar')
  })

  it('exposes all three themes', () => {
    const { result } = renderHook(() => useTheme())

    expect(result.current.themes).toEqual(THEMES)
  })

  it('setTheme updates the state', () => {
    const { result } = renderHook(() => useTheme())

    act(() => { result.current.setTheme('forest') })

    expect(result.current.theme).toBe('forest')
  })

  it('setTheme persists the choice to localStorage', () => {
    const { result } = renderHook(() => useTheme())

    act(() => { result.current.setTheme('slate') })

    expect(localStorage.getItem(STORAGE_KEY_THEME)).toBe('slate')
  })

  it('setTheme applies data-theme on the html element', () => {
    const { result } = renderHook(() => useTheme())

    act(() => { result.current.setTheme('forest') })

    expect(document.documentElement.dataset.theme).toBe('forest')
  })

  it('setTheme can switch between all themes', () => {
    const { result } = renderHook(() => useTheme())

    for (const t of THEMES) {
      act(() => { result.current.setTheme(t) })
      expect(result.current.theme).toBe(t)
      expect(document.documentElement.dataset.theme).toBe(t)
    }
  })
})

describe('useTheme — mode', () => {
  it('defaults to auto when localStorage is empty', () => {
    const { result } = renderHook(() => useTheme())

    expect(result.current.mode).toBe('auto')
  })

  it('reads an existing valid mode from localStorage', () => {
    localStorage.setItem(STORAGE_KEY_MODE, 'dark')

    const { result } = renderHook(() => useTheme())

    expect(result.current.mode).toBe('dark')
  })

  it('falls back to auto for an unknown stored mode', () => {
    localStorage.setItem(STORAGE_KEY_MODE, 'night')

    const { result } = renderHook(() => useTheme())

    expect(result.current.mode).toBe('auto')
  })

  it('exposes all three modes', () => {
    const { result } = renderHook(() => useTheme())

    expect(result.current.modes).toEqual(MODES)
  })

  it('setMode updates the state', () => {
    const { result } = renderHook(() => useTheme())

    act(() => { result.current.setMode('dark') })

    expect(result.current.mode).toBe('dark')
  })

  it('setMode persists the choice to localStorage', () => {
    const { result } = renderHook(() => useTheme())

    act(() => { result.current.setMode('dark') })

    expect(localStorage.getItem(STORAGE_KEY_MODE)).toBe('dark')
  })

  it('setMode("light") applies data-mode="light"', () => {
    const { result } = renderHook(() => useTheme())

    act(() => { result.current.setMode('light') })

    expect(document.documentElement.dataset.mode).toBe('light')
  })

  it('setMode("dark") applies data-mode="dark"', () => {
    const { result } = renderHook(() => useTheme())

    act(() => { result.current.setMode('dark') })

    expect(document.documentElement.dataset.mode).toBe('dark')
  })

  it('setMode("auto") applies data-mode="light" when OS is light', () => {
    mockMatchMedia(false)

    const { result } = renderHook(() => useTheme())

    act(() => { result.current.setMode('auto') })

    expect(document.documentElement.dataset.mode).toBe('light')
  })

  it('setMode("auto") applies data-mode="dark" when OS is dark', () => {
    mockMatchMedia(true)

    const { result } = renderHook(() => useTheme())

    act(() => { result.current.setMode('auto') })

    expect(document.documentElement.dataset.mode).toBe('dark')
  })

  it('auto mode updates data-mode when the OS preference changes', () => {
    const { triggerChange } = mockMatchMedia(false)

    localStorage.setItem(STORAGE_KEY_MODE, 'auto')

    renderHook(() => useTheme())

    expect(document.documentElement.dataset.mode).toBe('light')

    mockMatchMedia(true)
    act(() => { triggerChange() })

    expect(document.documentElement.dataset.mode).toBe('dark')
  })

  it('switching away from auto removes the OS listener', () => {
    const { result } = renderHook(() => useTheme())

    act(() => { result.current.setMode('auto') })
    act(() => { result.current.setMode('light') })

    // After switching to light, OS changes should no longer affect data-mode.
    mockMatchMedia(true)
    expect(document.documentElement.dataset.mode).toBe('light')
  })
})
