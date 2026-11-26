import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IDLE_MINUTES,
  MAX_IDLE_MINUTES,
  MIN_IDLE_MINUTES,
  clampIdleMinutes,
  discardEligibility,
  normalizeNeverDomains,
  selectDiscardTargets,
  siteKeyForTab,
} from './tab-suspend.js'

const NOW = 1_700_000_000_000
const IDLE_MIN = 30

function tab(
  partial: Partial<Parameters<typeof discardEligibility>[0]> & { id?: number } = {},
): Parameters<typeof discardEligibility>[0] {
  return {
    id: 1,
    active: false,
    pinned: false,
    audible: false,
    discarded: false,
    incognito: false,
    lastAccessed: NOW - IDLE_MIN * 60_000 - 1,
    url: 'https://example.com/page',
    ...partial,
  }
}

describe('clampIdleMinutes', () => {
  it('defaults non-finite values', () => {
    expect(clampIdleMinutes(undefined)).toBe(DEFAULT_IDLE_MINUTES)
    expect(clampIdleMinutes('nope')).toBe(DEFAULT_IDLE_MINUTES)
  })

  it('clamps to the allowed range', () => {
    expect(clampIdleMinutes(1)).toBe(MIN_IDLE_MINUTES)
    expect(clampIdleMinutes(999)).toBe(MAX_IDLE_MINUTES)
    expect(clampIdleMinutes(45.6)).toBe(46)
  })
})

describe('normalizeNeverDomains', () => {
  it('canonicalizes hosts and drops duplicates', () => {
    expect(normalizeNeverDomains(['WWW.GitHub.com', 'github.com', 'https://news.ycombinator.com'])).toEqual([
      'github.com',
      'ycombinator.com',
    ])
  })

  it('accepts a comma/newline string', () => {
    expect(normalizeNeverDomains('gmail.com\n, youtube.com')).toEqual(['gmail.com', 'youtube.com'])
  })
})

describe('discardEligibility', () => {
  const opts = { now: NOW, idleMinutes: IDLE_MIN, neverDomains: [] as string[] }

  it('allows an idle background https tab', () => {
    expect(discardEligibility(tab(), opts)).toEqual({ ok: true, siteKey: 'example.com' })
  })

  it('skips active, pinned, audible, discarded, and non-http tabs', () => {
    expect(discardEligibility(tab({ active: true }), opts).reason).toBe('active')
    expect(discardEligibility(tab({ pinned: true }), opts).reason).toBe('pinned')
    expect(discardEligibility(tab({ audible: true }), opts).reason).toBe('audible')
    expect(discardEligibility(tab({ discarded: true }), opts).reason).toBe('already-discarded')
    expect(discardEligibility(tab({ url: 'chrome://settings' }), opts).reason).toBe('not-http')
    expect(discardEligibility(tab({ url: '', pendingUrl: '' }), opts).reason).toBe('not-http')
  })

  it('skips never-list domains and not-yet-idle tabs', () => {
    expect(
      discardEligibility(tab(), { ...opts, neverDomains: ['example.com'] }).reason,
    ).toBe('never-list')
    expect(
      discardEligibility(tab({ lastAccessed: NOW - 60_000 }), opts).reason,
    ).toBe('not-idle')
  })

  it('uses pendingUrl when url is blank', () => {
    const result = discardEligibility(
      tab({ url: '', pendingUrl: 'https://github.com/org/repo' }),
      opts,
    )
    expect(result).toEqual({ ok: true, siteKey: 'github.com' })
  })

  it('skips incognito and missing id', () => {
    expect(discardEligibility(tab({ incognito: true }), opts).reason).toBe('incognito')
    expect(discardEligibility(tab({ id: undefined }), opts).reason).toBe('no-id')
  })
})

describe('selectDiscardTargets', () => {
  it('returns only eligible ids in order', () => {
    const ids = selectDiscardTargets(
      [
        tab({ id: 10, active: true }),
        tab({ id: 11 }),
        tab({ id: 12, url: 'chrome://extensions' }),
        tab({ id: 13, lastAccessed: NOW - IDLE_MIN * 60_000 - 5 }),
      ],
      { now: NOW, idleMinutes: IDLE_MIN, neverDomains: [] },
    )
    expect(ids).toEqual([11, 13])
  })
})

describe('siteKeyForTab', () => {
  it('reads registrable domain from http url', () => {
    expect(siteKeyForTab({ url: 'https://www.reddit.com/r/all' })).toBe('reddit.com')
  })
})
