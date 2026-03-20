import { describe, it, expect } from 'vitest'
import { generateHint, getHintCost, countSignificantChars } from './hint.ts'

describe('countSignificantChars', () => {
  it('counts all chars in a single word', () => {
    expect(countSignificantChars('table')).toBe(5)
  })

  it('excludes spaces', () => {
    expect(countSignificantChars('soft drink')).toBe(9)
  })

  it('excludes hyphens', () => {
    expect(countSignificantChars('well-known')).toBe(9)
  })

  it('excludes both spaces and hyphens', () => {
    expect(countSignificantChars('up-to date')).toBe(8)
  })
})

describe('getHintCost', () => {
  it('returns 1 for bucket 0', () => { expect(getHintCost(0)).toBe(1) })
  it('returns 10 for bucket 1', () => { expect(getHintCost(1)).toBe(10) })
  it('returns 10 for bucket 2', () => { expect(getHintCost(2)).toBe(10) })
  it('returns 10 for bucket 3', () => { expect(getHintCost(3)).toBe(10) })
  it('returns 20 for bucket 4', () => { expect(getHintCost(4)).toBe(20) })
  it('returns 30 for bucket 5', () => { expect(getHintCost(5)).toBe(30) })
  it('returns 30 for bucket 6 (capped)', () => { expect(getHintCost(6)).toBe(30) })
  it('returns 30 for bucket 7 (capped)', () => { expect(getHintCost(7)).toBe(30) })
})

describe('generateHint', () => {
  describe('single word', () => {
    it('shows 1 char for a 1-character word', () => {
      expect(generateHint('a')).toBe('a')
    })

    it('shows 1 char + dots for a 2-character word', () => {
      expect(generateHint('to')).toBe('t.')
    })

    it('shows 1 char + dots for a 3-character word', () => {
      expect(generateHint('car')).toBe('c..')
    })

    it('shows 2 chars + dots for a 4-character word', () => {
      expect(generateHint('have')).toBe('ha..')
    })

    it('shows 2 chars + dots for a 5-character word', () => {
      expect(generateHint('lunch')).toBe('lu...')
    })

    it('shows 2 chars + dots for a long word', () => {
      expect(generateHint('automobile')).toBe('au........')
    })
  })

  describe('multiple words', () => {
    it('applies hint to each word individually', () => {
      expect(generateHint('to have lunch')).toBe('t. ha.. lu...')
    })

    it('handles two short words', () => {
      expect(generateHint('to go')).toBe('t. g.')
    })

    it('handles two long words', () => {
      expect(generateHint('fast food')).toBe('fa.. fo..')
    })

    it('handles three words of mixed lengths', () => {
      expect(generateHint('go to school')).toBe('g. t. sc....')
    })
  })

  describe('maxShown = 1', () => {
    it('shows only 1 char for a word with 4+ characters', () => {
      expect(generateHint('have', 1)).toBe('h...')
    })

    it('still shows 1 char for a short word (behaviour unchanged)', () => {
      expect(generateHint('car', 1)).toBe('c..')
    })

    it('applies 1-char limit to each word in a multi-word string', () => {
      expect(generateHint('fast food', 1)).toBe('f... f...')
    })

    it('shows 1 char for a long word', () => {
      expect(generateHint('automobile', 1)).toBe('a.........')
    })
  })
})
