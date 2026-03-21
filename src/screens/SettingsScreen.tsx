/**
 * Settings screen.
 *
 * Currently provides a theme picker with three colour scheme options.
 * Additional settings (direction toggle, session size, etc.) will be added
 * in Phase 8.
 *
 * @example
 * ```tsx
 * <SettingsScreen theme={theme} onThemeChange={setTheme} />
 * ```
 */
import type { Theme } from '../hooks/useTheme.ts'
import styles from './SettingsScreen.module.css'

export interface SettingsScreenProps {
  theme: Theme
  onThemeChange: (theme: Theme) => void
}

interface ThemeOption {
  key: Theme
  name: string
  subtitle: string
  chromeColor: string
  contentColor: string
  accentColor: string
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    key: 'scholar',
    name: 'Scholar',
    subtitle: 'Navy + Amber',
    chromeColor: '#1e2d5a',
    contentColor: '#f8f9fa',
    accentColor: '#f59e0b',
  },
  {
    key: 'slate',
    name: 'Slate',
    subtitle: 'Dark Slate + Indigo',
    chromeColor: '#1e293b',
    contentColor: '#f1f5f9',
    accentColor: '#6366f1',
  },
  {
    key: 'forest',
    name: 'Forest',
    subtitle: 'Deep Green + Gold',
    chromeColor: '#1a3a2a',
    contentColor: '#fafaf7',
    accentColor: '#d97706',
  },
]

/** Renders the settings screen with a visual theme picker. */
export function SettingsScreen({ theme, onThemeChange }: SettingsScreenProps) {
  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>Settings</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Colour Theme</h2>

        <div className={styles.themeGrid}>
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.key}
              className={`${styles.themeCard}${theme === option.key ? ` ${styles.themeCardActive}` : ''}`}
              onClick={() => { onThemeChange(option.key) }}
              aria-pressed={theme === option.key}
              aria-label={`Select ${option.name} theme`}
            >
              <div className={styles.themePreview}>
                <div
                  className={styles.previewChrome}
                  style={{ backgroundColor: option.chromeColor }}
                />
                <div
                  className={styles.previewContent}
                  style={{ backgroundColor: option.contentColor }}
                />
              </div>

              <div className={styles.themeCardBody}>
                <span className={styles.themeName}>{option.name}</span>
                <span className={styles.themeSubtitle}>{option.subtitle}</span>
              </div>

              {theme === option.key && (
                <span className={styles.activeCheck} aria-hidden="true">✓</span>
              )}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
