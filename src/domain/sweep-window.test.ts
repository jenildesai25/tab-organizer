import { describe, expect, it } from 'vitest'
import { pickSweepWindowId } from './sweep-window.js'

describe('pickSweepWindowId', () => {
  it('keeps the requested window when it already has http tabs', () => {
    const tabsByWindow = new Map([
      [1, [{ id: 1, url: 'chrome://extensions' }, { id: 2, url: 'https://github.com/acme' }]],
      [2, [{ id: 3, url: 'https://amazon.com' }]],
    ])
    expect(
      pickSweepWindowId(1, [{ id: 1, type: 'normal' }, { id: 2, type: 'normal' }], tabsByWindow),
    ).toBe(1)
  })

  it('falls back to the largest http window when the requested one is chrome-only', () => {
    const tabsByWindow = new Map([
      [1, [{ id: 1, url: 'chrome://extensions' }, { id: 2, url: 'chrome://settings' }]],
      [
        2,
        [
          { id: 3, url: 'https://github.com/a' },
          { id: 4, url: 'https://github.com/b' },
          { id: 5, url: 'https://docs.google.com/x' },
        ],
      ],
      [3, [{ id: 6, url: 'https://amazon.com' }]],
    ])
    expect(
      pickSweepWindowId(
        1,
        [
          { id: 1, type: 'normal' },
          { id: 2, type: 'normal' },
          { id: 3, type: 'normal' },
        ],
        tabsByWindow,
      ),
    ).toBe(2)
  })
})
