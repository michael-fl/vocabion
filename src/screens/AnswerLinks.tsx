/**
 * Small presentational component that renders a list of vocabulary words
 * as comma-separated dictionary links, used in multiple-choice quiz feedback banners.
 */
import { dictUrl } from '../utils/dictUrl.ts'

/** Renders a list of answer words as comma-separated dictionary links. */
export function AnswerLinks({ words }: { words: string[] }) {
  return (
    <>
      {words.map((w, i) => (
        <span key={w}>
          {i > 0 && ', '}
          <a href={dictUrl(w)} target="_blank" rel="noreferrer">{w}</a>
        </span>
      ))}
    </>
  )
}
