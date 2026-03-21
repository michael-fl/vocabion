/**
 * Persistent application header.
 *
 * Displays the app name on the left, credit balance and streak info in the
 * centre-right, and a toggle button for the right panel on the far right.
 *
 * @example
 * ```tsx
 * <Header
 *   credits={420}
 *   streak={{ count: 7, ... }}
 *   rightPanelOpen={false}
 *   onToggleRightPanel={() => setOpen(o => !o)}
 * />
 * ```
 */
import type { StreakInfo } from '../../api/streakApi.ts'
import styles from './Header.module.css'

export interface HeaderProps {
  credits: number | null
  stars: number | null
  streak: StreakInfo | null
  rightPanelOpen: boolean
  onToggleRightPanel: () => void
}

/** Renders the fixed top header of the app shell. */
export function Header({ credits, stars, streak, rightPanelOpen, onToggleRightPanel }: HeaderProps) {
  return (
    <header className={styles.header}>
      <span className={styles.title}>Vocabion</span>

      <div className={styles.status}>
        {stars !== null && stars > 0 && (
          <span className={styles.stars} aria-label={`${stars} ${stars === 1 ? 'star' : 'stars'} earned`}>
            {'★'.repeat(stars)}
          </span>
        )}

        {streak?.nextMilestone !== null && streak?.nextMilestone !== undefined && (
          <span className={styles.milestone}>
            Next: {streak.nextMilestone.label} (+{streak.nextMilestone.credits}) in {streak.nextMilestone.daysUntil} {streak.nextMilestone.daysUntil === 1 ? 'day' : 'days'}
          </span>
        )}

        {streak !== null && (
          <span className={styles.statusItem}>
            Streak: <span className={styles.statusValue}>{streak.count} {streak.count === 1 ? 'day' : 'days'}</span>
          </span>
        )}

        {credits !== null && (
          <span className={styles.statusItem}>
            Credits: <span className={styles.statusValue}>{credits.toLocaleString()}</span>
          </span>
        )}
      </div>

      <button
        className={`${styles.panelToggle}${rightPanelOpen ? ` ${styles.panelToggleActive}` : ''}`}
        onClick={onToggleRightPanel}
        aria-pressed={rightPanelOpen}
        aria-label={rightPanelOpen ? 'Close side panel' : 'Open side panel'}
      >
        {rightPanelOpen ? 'Close panel' : 'Side panel'}
      </button>
    </header>
  )
}
