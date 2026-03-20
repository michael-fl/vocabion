/**
 * Tests for the dictUrl utility.
 */
import { dictUrl } from './dictUrl.ts'

describe('dictUrl', () => {
  it('returns the correct base URL for a simple German word', () => {
    expect(dictUrl('Haus')).toBe('https://dict.leo.org/englisch-deutsch/Haus')
  })

  it('returns the correct base URL for a simple English word', () => {
    expect(dictUrl('house')).toBe('https://dict.leo.org/englisch-deutsch/house')
  })

  it('URL-encodes words with spaces', () => {
    expect(dictUrl('school bag')).toBe('https://dict.leo.org/englisch-deutsch/school%20bag')
  })

  it('URL-encodes words with special characters', () => {
    expect(dictUrl('Straße')).toBe('https://dict.leo.org/englisch-deutsch/Stra%C3%9Fe')
  })
})
