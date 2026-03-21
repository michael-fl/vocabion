/**
 * Settings screen.
 *
 * Provides a colour scheme picker (Scholar / Slate / Forest) and a
 * Light / Dark mode toggle. Both choices are applied instantly and
 * persisted across page loads.
 *
 * @example
 * ```tsx
 * <SettingsScreen theme={theme} onThemeChange={setTheme} mode={mode} onModeChange={setMode} />
 * ```
 */
import type { Theme, Mode } from '../hooks/useTheme.ts'
import styles from './SettingsScreen.module.css'

export interface SettingsScreenProps {
  theme: Theme
  onThemeChange: (theme: Theme) => void
  mode: Mode
  onModeChange: (mode: Mode) => void
}

interface ThemeOption {
  key: Theme
  name: string
  subtitle: string
  chromeColor: string
  contentColorLight: string
  contentColorDark: string
  accentColor: string
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    key: 'scholar',
    name: 'Scholar',
    subtitle: 'Navy + Amber',
    chromeColor: '#1e2d5a',
    contentColorLight: '#f8f9fa',
    contentColorDark:  '#0c1625',
    accentColor: '#f59e0b',
  },
  {
    key: 'slate',
    name: 'Slate',
    subtitle: 'Dark Slate + Indigo',
    chromeColor: '#1e293b',
    contentColorLight: '#f1f5f9',
    contentColorDark:  '#0f172a',
    accentColor: '#6366f1',
  },
  {
    key: 'forest',
    name: 'Forest',
    subtitle: 'Deep Green + Gold',
    chromeColor: '#1a3a2a',
    contentColorLight: '#fafaf7',
    contentColorDark:  '#0a150d',
    accentColor: '#c9a227',
  },
]

/** Renders the settings screen with a colour scheme picker and a light/dark toggle. */
export function SettingsScreen({ theme, onThemeChange, mode, onModeChange }: SettingsScreenProps) {
  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>Settings</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Colour Scheme</h2>

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
                  style={{ backgroundColor: mode === 'dark' ? option.contentColorDark : option.contentColorLight }}
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

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Brightness</h2>

        <div className={styles.modeToggle} role="group" aria-label="Colour mode">
          <button
            className={`${styles.modeBtn}${mode === 'light' ? ` ${styles.modeBtnActive}` : ''}`}
            aria-pressed={mode === 'light'}
            onClick={() => { onModeChange('light') }}
          >
            Light
          </button>
          <button
            className={`${styles.modeBtn}${mode === 'dark' ? ` ${styles.modeBtnActive}` : ''}`}
            aria-pressed={mode === 'dark'}
            onClick={() => { onModeChange('dark') }}
          >
            Dark
          </button>
        </div>
      </section>
    </div>
  )
}
