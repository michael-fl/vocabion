/**
 * Tests for the useTheme hook.
 */
import { renderHook, act } from '@testing-library/react'

import { useTheme, THEMES, MODES } from './useTheme.ts'

const STORAGE_KEY_THEME = 'vocabion-theme'
const STORAGE_KEY_MODE  = 'vocabion-mode'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-mode')
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
  it('defaults to light when localStorage is empty', () => {
    const { result } = renderHook(() => useTheme())

    expect(result.current.mode).toBe('light')
  })

  it('reads an existing valid mode from localStorage', () => {
    localStorage.setItem(STORAGE_KEY_MODE, 'dark')

    const { result } = renderHook(() => useTheme())

    expect(result.current.mode).toBe('dark')
  })

  it('falls back to light for an unknown stored mode', () => {
    localStorage.setItem(STORAGE_KEY_MODE, 'night')

    const { result } = renderHook(() => useTheme())

    expect(result.current.mode).toBe('light')
  })

  it('exposes both modes', () => {
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

  it('setMode applies data-mode on the html element', () => {
    const { result } = renderHook(() => useTheme())

    act(() => { result.current.setMode('dark') })

    expect(document.documentElement.dataset.mode).toBe('dark')
  })

  it('setMode can switch between all modes', () => {
    const { result } = renderHook(() => useTheme())

    for (const m of MODES) {
      act(() => { result.current.setMode(m) })
      expect(result.current.mode).toBe(m)
      expect(document.documentElement.dataset.mode).toBe(m)
    }
  })
})
