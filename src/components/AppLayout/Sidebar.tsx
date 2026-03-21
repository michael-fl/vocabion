/**
 * Left navigation sidebar.
 *
 * Renders navigation items for Home, Vocabulary, and Settings.
 * The active item is highlighted using the theme's accent colour.
 *
 * @example
 * ```tsx
 * <Sidebar activeNav="home" onNavigate={setScreen} />
 * ```
 */
import styles from './Sidebar.module.css'

export type NavItem = 'home' | 'vocab' | 'settings'

export interface SidebarProps {
  activeNav: NavItem
  onNavigate: (item: NavItem) => void
}

interface NavEntry {
  key: NavItem
  label: string
}

const NAV_ITEMS: NavEntry[] = [
  { key: 'home',     label: 'Home' },
  { key: 'vocab',    label: 'Vocabulary' },
  { key: 'settings', label: 'Settings' },
]

/** Renders the fixed left sidebar navigation. */
export function Sidebar({ activeNav, onNavigate }: SidebarProps) {
  return (
    <nav className={styles.sidebar} aria-label="Main navigation">
      <ul className={styles.nav} role="list">
        {NAV_ITEMS.map((item, index) => (
          <>
            {index === NAV_ITEMS.length - 1 && (
              <li key="divider" aria-hidden="true">
                <div className={styles.divider} />
              </li>
            )}
            <li key={item.key}>
              <button
                className={`${styles.navItem}${activeNav === item.key ? ` ${styles.navItemActive}` : ''}`}
                onClick={() => { onNavigate(item.key) }}
                aria-current={activeNav === item.key ? 'page' : undefined}
              >
                {item.label}
              </button>
            </li>
          </>
        ))}
      </ul>
    </nav>
  )
}
