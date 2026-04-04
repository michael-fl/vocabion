/**
 * Tests for the useOnVisible hook.
 */
import { renderHook } from '@testing-library/react'
import { useOnVisible } from './useOnVisible.ts'

function fireVisibilityChange(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useOnVisible', () => {
  it('calls the callback when the tab becomes visible', () => {
    const callback = vi.fn()

    renderHook(() => { useOnVisible(callback) })

    fireVisibilityChange('visible')

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('does not call the callback when the tab becomes hidden', () => {
    const callback = vi.fn()

    renderHook(() => { useOnVisible(callback) })

    fireVisibilityChange('hidden')

    expect(callback).not.toHaveBeenCalled()
  })

  it('calls the callback multiple times on repeated tab switches', () => {
    const callback = vi.fn()

    renderHook(() => { useOnVisible(callback) })

    fireVisibilityChange('hidden')
    fireVisibilityChange('visible')
    fireVisibilityChange('hidden')
    fireVisibilityChange('visible')

    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('calls the callback when the browser window gains focus', () => {
    const callback = vi.fn()

    renderHook(() => { useOnVisible(callback) })

    window.dispatchEvent(new Event('focus'))

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('removes both listeners on unmount', () => {
    const callback = vi.fn()

    const { unmount } = renderHook(() => { useOnVisible(callback) })

    unmount()
    fireVisibilityChange('visible')
    window.dispatchEvent(new Event('focus'))

    expect(callback).not.toHaveBeenCalled()
  })
})
