import { describe, expect, it } from 'vitest'
import {
  CLEANUP_ALARM_PERIOD_MINUTES,
  DEFAULT_CLEANUP_AGE_DAYS,
  MAX_CLEANUP_AGE_DAYS,
  MIN_CLEANUP_AGE_DAYS,
  clampCleanupAgeDays,
  cleanupAlarmAction,
  cleanupEligibility,
  filterConfirmedTargets,
  formatCleanupAgeLabel,
  normalizeProtectDomains,
  normalizeProtectGroupIds,
  normalizeProtectUrlPatterns,
  normalizeUrlPattern,
  pruneProtectGroupIds,
  selectCleanupTargets,
  siteKeyForCleanupTab,
  urlMatchesProtectPattern,
  type ProtectLists,
} from './tab-cleanup.js'

const NOW = 1_700_000_000_000
const AGE_DAYS = 30
const AGE_MS = AGE_DAYS * 24 * 60 * 60_000

const emptyProtect: ProtectLists = { domains: [], groupIds: [], urlPatterns: [], groups: [] }

function tab(
  partial: Partial<Parameters<typeof cleanupEligibility>[0]> & { id?: number } = {},
): Parameters<typeof cleanupEligibility>[0] {
  return {
    id: 1,
    active: false,
    pinned: false,
    audible: false,
    incognito: false,
    lastAccessed: NOW - AGE_MS - 1,
    url: 'https://example.com/page',
    groupId: -1,
    ...partial,
  }
}

describe('clampCleanupAgeDays', () => {
  it('defaults non-finite values', () => {
    expect(clampCleanupAgeDays(undefined)).toBe(DEFAULT_CLEANUP_AGE_DAYS)
    expect(clampCleanupAgeDays('nope')).toBe(DEFAULT_CLEANUP_AGE_DAYS)
  })

  it('clamps to the allowed range', () => {
    expect(clampCleanupAgeDays(0)).toBe(MIN_CLEANUP_AGE_DAYS)
    expect(clampCleanupAgeDays(999)).toBe(MAX_CLEANUP_AGE_DAYS)
    expect(clampCleanupAgeDays(45.6)).toBe(46)
  })
})

describe('normalizeProtectDomains', () => {
  it('canonicalizes hosts and drops duplicates', () => {
    expect(normalizeProtectDomains(['WWW.GitHub.com', 'github.com', 'https://news.ycombinator.com'])).toEqual([
      'github.com',
      'ycombinator.com',
    ])
  })

  it('accepts a comma/newline string', () => {
    expect(normalizeProtectDomains('gmail.com\n, youtube.com')).toEqual(['gmail.com', 'youtube.com'])
  })
})

describe('normalizeProtectGroupIds', () => {
  it('keeps unique non-negative integers', () => {
    expect(normalizeProtectGroupIds([3, -1, 3, 1.5, 'x', 7])).toEqual([3, 7])
  })
})

describe('normalizeUrlPattern / urlMatchesProtectPattern', () => {
  it('strips query and hash', () => {
    expect(normalizeUrlPattern('https://example.com/a/b?q=1#hash')).toBe('https://example.com/a/b')
  })

  it('matches exact and path-prefix pages', () => {
    expect(urlMatchesProtectPattern('https://example.com/docs/guide', 'https://example.com/docs')).toBe(true)
    expect(urlMatchesProtectPattern('https://example.com/docs', 'https://example.com/docs')).toBe(true)
    expect(urlMatchesProtectPattern('https://example.com/docsx', 'https://example.com/docs')).toBe(false)
  })
})

describe('normalizeProtectUrlPatterns', () => {
  it('dedupes and normalizes', () => {
    expect(
      normalizeProtectUrlPatterns(['https://a.com/x/', 'https://a.com/x?q=1', 'https://b.com/y']),
    ).toEqual(['https://a.com/x', 'https://b.com/y'])
  })
})

describe('pruneProtectGroupIds', () => {
  it('drops ids that are no longer live', () => {
    expect(pruneProtectGroupIds([1, 2, 3], new Set([2, 9]))).toEqual([2])
  })
})

describe('cleanupEligibility', () => {
  const opts = { now: NOW, ageDays: AGE_DAYS, protect: emptyProtect }

  it('allows an old background https tab', () => {
    expect(cleanupEligibility(tab(), opts)).toEqual({
      ok: true,
      siteKey: 'example.com',
      urlPattern: 'https://example.com/page',
    })
  })

  it('skips active, pinned, audible, and non-http tabs', () => {
    expect(cleanupEligibility(tab({ active: true }), opts).reason).toBe('active')
    expect(cleanupEligibility(tab({ pinned: true }), opts).reason).toBe('pinned')
    expect(cleanupEligibility(tab({ audible: true }), opts).reason).toBe('audible')
    expect(cleanupEligibility(tab({ url: 'chrome://settings' }), opts).reason).toBe('not-http')
    expect(cleanupEligibility(tab({ url: '', pendingUrl: '' }), opts).reason).toBe('not-http')
  })

  it('skips protected domains, groups, urls, and not-yet-old tabs', () => {
    expect(
      cleanupEligibility(tab(), {
        ...opts,
        protect: { ...emptyProtect, domains: ['example.com'] },
      }).reason,
    ).toBe('protected-domain')
    expect(
      cleanupEligibility(tab({ groupId: 42 }), {
        ...opts,
        protect: { ...emptyProtect, groupIds: [42] },
      }).reason,
    ).toBe('protected-group')
    expect(
      cleanupEligibility(tab({ url: 'https://example.com/docs/a' }), {
        ...opts,
        protect: { ...emptyProtect, urlPatterns: ['https://example.com/docs'] },
      }).reason,
    ).toBe('protected-url')
    expect(
      cleanupEligibility(tab({ lastAccessed: NOW - 60_000 }), opts).reason,
    ).toBe('not-old')
  })

  it('uses pendingUrl when url is blank', () => {
    const result = cleanupEligibility(
      tab({ url: '', pendingUrl: 'https://github.com/org/repo' }),
      opts,
    )
    expect(result.ok).toBe(true)
    expect(result.siteKey).toBe('github.com')
  })

  it('skips incognito and missing id', () => {
    expect(cleanupEligibility(tab({ incognito: true }), opts).reason).toBe('incognito')
    expect(cleanupEligibility(tab({ id: undefined }), opts).reason).toBe('no-id')
  })

  it('does not treat a missing or zero lastAccessed as unused since 1970', () => {
    expect(cleanupEligibility(tab({ lastAccessed: undefined }), opts).reason).toBe('unknown-age')
    expect(cleanupEligibility(tab({ lastAccessed: 0 }), opts).reason).toBe('unknown-age')
    expect(cleanupEligibility(tab({ lastAccessed: Number.NaN }), opts).ok).toBe(false)
  })
})

describe('manual confirmation and the cleanup alarm', () => {
  it('closes only ids the user confirmed', () => {
    const targets = selectCleanupTargets(
      [tab({ id: 11 }), tab({ id: 13 })],
      { now: NOW, ageDays: AGE_DAYS, protect: emptyProtect },
    )
    expect(filterConfirmedTargets(targets, [13, 99]).map((row) => row.tabId)).toEqual([13])
  })

  it('keeps an alarm that is already scheduled at the right period', () => {
    expect(cleanupAlarmAction(undefined, false)).toBe('keep')
    expect(cleanupAlarmAction({ periodInMinutes: 60 }, false)).toBe('clear')
    expect(cleanupAlarmAction(undefined, true)).toBe('create')
    expect(cleanupAlarmAction({ periodInMinutes: CLEANUP_ALARM_PERIOD_MINUTES }, true)).toBe('keep')
    expect(cleanupAlarmAction({ periodInMinutes: 1 }, true)).toBe('create')
  })
})

describe('selectCleanupTargets', () => {
  it('returns only eligible candidates in order', () => {
    const targets = selectCleanupTargets(
      [
        tab({ id: 10, active: true }),
        tab({ id: 11 }),
        tab({ id: 12, url: 'chrome://extensions' }),
        tab({ id: 13, lastAccessed: NOW - AGE_MS - 5 }),
      ],
      { now: NOW, ageDays: AGE_DAYS, protect: emptyProtect },
    )
    expect(targets.map((row) => row.tabId)).toEqual([11, 13])
  })
})

describe('siteKeyForCleanupTab / formatCleanupAgeLabel', () => {
  it('reads registrable domain from http url', () => {
    expect(siteKeyForCleanupTab({ url: 'https://www.reddit.com/r/all' })).toBe('reddit.com')
  })

  it('formats age labels', () => {
    expect(formatCleanupAgeLabel(1)).toBe('1 day')
    expect(formatCleanupAgeLabel(30)).toBe('30 days')
  })
})
