import { describe, expect, it } from 'vitest'
import type { ChromeTabLike } from './chrome-tab.js'
import { buildSweepDiag } from './sweep-diag.js'
import type { TabState } from './types.js'

function state(partial: Partial<TabState> & Pick<TabState, 'id'>): TabState {
  return {
    active: false,
    http: true,
    pinned: false,
    incognito: false,
    browserPage: false,
    groupId: null,
    status: 'complete',
    openedInsideGroup: false,
    sticky: false,
    candidate: false,
    titleStableSince: null,
    lastFiledDomain: null,
    advisorPending: false,
    card: {
      domain: 'github.com',
      title: 'PR',
      titleWords: ['PR'],
      pathWords: [],
      openerDomain: null,
    },
    ...partial,
  }
}

describe('buildSweepDiag', () => {
  const chromeTabs: ChromeTabLike[] = [
    { id: 1, url: 'https://github.com/acme/secret-pr', title: 'PR', status: 'complete' },
    { id: 2, url: 'chrome://extensions', title: 'Extensions' },
  ]
  const states = [state({ id: 1 }), state({ id: 2, http: false, browserPage: true })]

  it('omits samples by default for production client responses', () => {
    const diag = buildSweepDiag('0.3.21', 9, chromeTabs, states)
    expect(diag.samples).toBeUndefined()
    expect(diag.looked).toBe(2)
    expect(diag.line).toContain('github.com[http]')
    expect(diag.line).not.toContain('/acme/secret-pr')
  })

  it('attaches hostname-only samples when includeSamples is true', () => {
    const diag = buildSweepDiag('0.3.21', 9, chromeTabs, states, -1, { includeSamples: true })
    expect(diag.samples).toEqual([
      {
        id: 1,
        host: 'github.com',
        kind: 'http',
        groupId: null,
        discarded: false,
        status: 'complete',
      },
      {
        id: 2,
        host: 'chrome://extensions',
        kind: 'browser',
        groupId: null,
        discarded: false,
        status: '',
      },
    ])
    expect(JSON.stringify(diag.samples)).not.toContain('secret-pr')
  })
})
