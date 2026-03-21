/**
 * Top-level application shell layout.
 *
 * Composes the full page grid: fixed header, left navigation sidebar,
 * scrollable main content area, optional right panel, and fixed footer.
 *
 * The right panel is conditionally rendered based on `rightPanelOpen`.
 * The CSS grid column for the panel collapses to 0 when it is hidden.
 *
 * @example
 * ```tsx
 * <AppLayout
 *   credits={420}
 *   streak={streakInfo}
 *   activeNav="home"
 *   rightPanelOpen={false}
 *   onToggleRightPanel={() => setOpen(o => !o)}
 *   onNavigate={(item) => setScreen(item)}
 *   version="0.1.0"
 * >
 *   <HomeScreen ... />
 * </AppLayout>
 * ```
 */
import type { ReactNode } from 'react'

import type { StreakInfo } from '../../api/streakApi.ts'
import { Header } from './Header.tsx'
import { Sidebar, type NavItem } from './Sidebar.tsx'
import { RightPanel } from './RightPanel.tsx'
import { Footer } from './Footer.tsx'
import styles from './AppLayout.module.css'

export interface AppLayoutProps {
  children: ReactNode
  credits: number | null
  stars: number | null
  streak: StreakInfo | null
  activeNav: NavItem
  rightPanelOpen: boolean
  onToggleRightPanel: () => void
  onNavigate: (item: NavItem) => void
  version: string
}

/** Renders the full app shell with header, sidebar, main area, optional right panel, and footer. */
export function AppLayout({
  children,
  credits,
  stars,
  streak,
  activeNav,
  rightPanelOpen,
  onToggleRightPanel,
  onNavigate,
  version,
}: AppLayoutProps) {
  return (
    <div className={`${styles.shell}${rightPanelOpen ? ` ${styles.panelOpen}` : ''}`}>
      <Header
        credits={credits}
        stars={stars}
        streak={streak}
        rightPanelOpen={rightPanelOpen}
        onToggleRightPanel={onToggleRightPanel}
      />

      <Sidebar activeNav={activeNav} onNavigate={onNavigate} />

      <main className={styles.main}>
        {children}
      </main>

      {rightPanelOpen && <RightPanel />}

      <Footer version={version} />
    </div>
  )
}
