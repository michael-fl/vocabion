/**
 * Hook that fires a callback whenever the app becomes active again.
 *
 * Listens to two complementary browser events:
 * - `document visibilitychange` — fires when the user switches browser tabs.
 * - `window focus` — fires when the browser window regains focus from another
 *   OS application (e.g. the user comes back to a browser that was left open
 *   overnight while another app was in front).
 *
 * Either event alone is insufficient: `visibilitychange` does not fire when
 * only the OS-level focus changes, and `window focus` may not fire on a plain
 * tab switch. Together they cover both cases.
 *
 * The `callback` may be invoked twice in quick succession (once per event) in
 * rare edge cases — callers should be idempotent. Wrap the callback in
 * `useCallback` to keep the listener stable across renders.
 *
 * @example
 * ```ts
 * const refresh = useCallback(() => { void loadData() }, [])
 * useOnVisible(refresh)
 * ```
 */
import { useEffect } from 'react'

/**
 * Registers listeners on `document.visibilitychange` and `window.focus`,
 * calling `callback` whenever either signals that the app is active again.
 * Listeners are removed when the component unmounts.
 */
export function useOnVisible(callback: () => void): void {
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        callback()
      }
    }

    function handleWindowFocus() {
      callback()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [callback])
}
