/**
 * Tests for the useTheme hook.
 */
import { renderHook, act } from '@testing-library/react'

import { useTheme, THEMES } from './useTheme.ts'

const STORAGE_KEY = 'vocabion-theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('useTheme', () => {
  it('defaults to scholar when localStorage is empty', () => {
    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('scholar')
  })

  it('reads an existing valid theme from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'slate')

    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('slate')
  })

  it('falls back to scholar for an unknown stored value', () => {
    localStorage.setItem(STORAGE_KEY, 'unknown-theme')

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

    expect(localStorage.getItem(STORAGE_KEY)).toBe('slate')
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
