import { describe, expect, it } from 'vitest'
import type { ChromeTabLike } from './chrome-tab.js'
import { countSweep, describeSweep, formatSweepDiag } from './summary.js'
import { sweepChromeWindow } from './sweep-chrome.js'
import type { Action, TabState } from './types.js'

function tab(partial: Partial<TabState> & Pick<TabState, 'id'>): TabState {
  return {
    active: false,
    pinned: false,
    incognito: false,
    http: true,
    browserPage: false,
    sticky: false,
    openedInsideGroup: false,
    candidate: false,
    status: 'complete',
    titleStableSince: 0,
    groupId: null,
    lastFiledDomain: null,
    advisorPending: false,
    card: { domain: 'github.com', title: 'PR', titleWords: ['pr'], pathWords: [], openerDomain: null },
    ...partial,
  }
}

describe('countSweep partitioning', () => {
  it('does not label already-grouped https tabs as skipped browser/pinned', () => {
    // Reproduces the misleading "Eligible 0 / Skipped 82 browser/pinned" report when
    // the buggy formula was skipped = looked - ungroupedEligible (or eligible required
    // groupId===null and skipped absorbed everything else under the browser/pinned label).
    const tabs: TabState[] = []
    for (let i = 1; i <= 80; i += 1) {
      tabs.push(tab({ id: i, groupId: 7, card: { domain: 'github.com', title: `PR ${i}`, titleWords: [], pathWords: [], openerDomain: null } }))
    }
    tabs.push(
      tab({
        id: 81,
        http: false,
        browserPage: true,
        card: { domain: '', title: 'Extensions', titleWords: [], pathWords: [], openerDomain: null },
      }),
    )
    tabs.push(
      tab({
        id: 82,
        http: false,
        browserPage: true,
        card: { domain: '', title: 'Settings', titleWords: [], pathWords: [], openerDomain: null },
      }),
    )

    const actions: Action[] = []
    const counts = countSweep(tabs, actions)

    // Buggy labeling would claim skipped=82 under "browser/pinned".
    const buggySkipped = counts.looked - counts.eligible
    expect(buggySkipped).toBe(82)

    expect(counts.looked).toBe(82)
    expect(counts.alreadyGrouped).toBe(80)
    expect(counts.eligible).toBe(0)
    expect(counts.skipped).toBe(2)
    expect(counts.browser).toBe(2)
    expect(counts.hidden).toBe(0)

    const summary = describeSweep(tabs, actions)
    expect(summary).toBe('All 80 http tabs are already in groups. Skipped 2 browser/pinned. Hidden 0.')
    expect(summary).not.toMatch(/Skipped 82 browser\/pinned/)
  })

  it('counts 80 ungrouped https as eligible beside 2 chrome pages', () => {
    const tabs: TabState[] = []
    for (let i = 1; i <= 80; i += 1) {
      tabs.push(
        tab({
          id: i,
          groupId: null,
          card: { domain: 'github.com', title: `PR ${i}`, titleWords: [], pathWords: [], openerDomain: null },
        }),
      )
    }
    tabs.push(
      tab({
        id: 81,
        http: false,
        browserPage: true,
        card: { domain: '', title: 'Extensions', titleWords: [], pathWords: [], openerDomain: null },
      }),
    )
    tabs.push(
      tab({
        id: 82,
        pinned: true,
        http: true,
        browserPage: false,
        card: { domain: 'github.com', title: 'Inbox', titleWords: [], pathWords: [], openerDomain: null },
      }),
    )

    const counts = countSweep(tabs, [])
    expect(counts.looked).toBe(82)
    expect(counts.eligible).toBe(80)
    expect(counts.alreadyGrouped).toBe(0)
    expect(counts.skipped).toBe(2)
    expect(counts.hidden).toBe(0)

    const summary = describeSweep(tabs, [])
    expect(summary).toContain('Eligible 80')
    expect(summary).toContain('Already grouped 0')
    expect(summary).toContain('Skipped 2 browser/pinned')
  })
})

describe('formatSweepDiag', () => {
  it('lists class counts and hostname-only samples (no full paths)', () => {
    const chromeTabs: ChromeTabLike[] = [
      { id: 1, url: 'https://github.com/acme/pr', title: 'PR' },
      { id: 2, url: 'chrome://extensions', title: 'Extensions' },
      { id: 3, url: 'https://nvidia.com', title: 'NVIDIA', pinned: true },
      { id: 4, url: 'about:blank', title: '' },
    ]
    expect(formatSweepDiag(chromeTabs)).toBe(
      'diag: http=1 browser=1 pinned=1 unknown=1 | github.com[http], chrome://extensions[browser], nvidia.com[pinned]',
    )
  })
})

describe('sweep summary with live chrome-shaped tabs', () => {
  it('files ungrouped https and reports already-grouped separately when a GitHub group exists', () => {
    const groupId = 42
    const tabs: ChromeTabLike[] = []
    for (let i = 1; i <= 40; i += 1) {
      tabs.push({
        id: i,
        url: `https://github.com/acme/pr/${i}`,
        title: `Pull request ${i}`,
        status: 'complete',
        groupId,
      })
    }
    for (let i = 41; i <= 80; i += 1) {
      tabs.push({
        id: i,
        url: `https://www.youtube.com/watch?v=${i}`,
        title: `Video ${i}`,
        status: 'complete',
        groupId: -1,
      })
    }
    tabs.push({ id: 81, url: 'chrome://extensions', title: 'Extensions', status: 'complete', active: true, groupId: -1 })
    tabs.push({ id: 82, url: 'https://github.com/notifications', title: 'Inbox', pinned: true, status: 'complete', groupId: -1 })

    const result = sweepChromeWindow({
      tabs,
      groups: [{ id: groupId, title: 'GitHub' }],
      noneGroupId: -1,
    })
    const counts = countSweep(result.tabs, result.actions)

    expect(counts.alreadyGrouped).toBe(40)
    expect(counts.eligible).toBe(40)
    expect(counts.skipped).toBe(2)
    expect(result.summary).toContain('Already grouped 40')
    expect(result.summary).toContain('Eligible 40')
    expect(result.summary).toContain('Skipped 2 browser/pinned')
    expect(result.summary).toMatch(/^[\s\S]*\ndiag: http=\d+ browser=\d+ pinned=\d+ unknown=\d+ \| /)
    expect(result.actions.some((action) => action.type === 'file')).toBe(true)
  })
})
