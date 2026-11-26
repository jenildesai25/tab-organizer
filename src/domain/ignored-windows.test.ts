import { describe, expect, it } from 'vitest'
import {
  isWindowIgnored,
  normalizeIgnoredWindowIds,
  pruneIgnoredWindowIds,
  setWindowIgnored,
} from './ignored-windows.js'

describe('ignored windows', () => {
  it('normalizes and toggles ids', () => {
    expect(normalizeIgnoredWindowIds([1, 1, -1, 2.5, 3])).toEqual([1, 3])
    expect(setWindowIgnored([1], 2, true)).toEqual([1, 2])
    expect(setWindowIgnored([1, 2], 1, false)).toEqual([2])
    expect(isWindowIgnored([1, 2], 2)).toBe(true)
  })

  it('prunes closed windows', () => {
    expect(pruneIgnoredWindowIds([1, 2, 3], new Set([2]))).toEqual([2])
  })
})
