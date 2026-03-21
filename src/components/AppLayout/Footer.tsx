/**
 * Persistent application footer.
 *
 * Displays the app version string aligned to the right.
 *
 * @example
 * ```tsx
 * <Footer version="0.1.0" />
 * ```
 */
import styles from './Footer.module.css'

export interface FooterProps {
  version: string
}

/** Renders the fixed bottom footer of the app shell. */
export function Footer({ version }: FooterProps) {
  return (
    <footer className={styles.footer}>
      <span>v{version}</span>
    </footer>
  )
}
