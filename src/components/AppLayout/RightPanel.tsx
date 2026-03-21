/**
 * Toggleable right panel.
 *
 * Hidden by default. When open it shows a "Coming soon…" placeholder,
 * reserving the area for a future dict.leo.org iframe integration.
 *
 * Rendered only when `open` is true — the parent controls visibility.
 *
 * @example
 * ```tsx
 * {rightPanelOpen && <RightPanel />}
 * ```
 */
import styles from './RightPanel.module.css'

/** Renders the right panel content (shown when toggled open). */
export function RightPanel() {
  return (
    <aside className={styles.panel} aria-label="Side panel">
      <p className={styles.placeholder}>Coming soon&hellip;</p>
    </aside>
  )
}
