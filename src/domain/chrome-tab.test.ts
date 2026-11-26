import { describe, expect, it } from 'vitest'
import {
  classifyChromeTab,
  chromeTabSnapshot,
  extractEmbeddedHttpUrl,
  isAboutPlaceholder,
  normalizeGroupId,
  resolveTabUrl,
  type ChromeTabLike,
} from './chrome-tab.js'
import { countHttpTabs, sweepChromeWindow, tabStateFromChrome, windowHasHttpTabs } from './sweep-chrome.js'
import { countSweep, describeSweep } from './summary.js'

describe('classifyChromeTab', () => {
  it('reads pendingUrl when url is empty', () => {
    expect(resolveTabUrl({ url: '', pendingUrl: 'https://github.com/acme' })).toBe('https://github.com/acme')
    expect(classifyChromeTab({ url: '', pendingUrl: 'https://github.com/acme' })).toBe('http')
    expect(chromeTabSnapshot({ url: '', pendingUrl: 'https://github.com/acme', title: 'Pull request' }).http).toBe(
      true,
    )
  })

  it('prefers http pendingUrl over about:blank url', () => {
    expect(resolveTabUrl({ url: 'about:blank', pendingUrl: 'https://github.com/acme/pr' })).toBe(
      'https://github.com/acme/pr',
    )
    expect(classifyChromeTab({ url: 'about:blank', pendingUrl: 'https://docs.google.com/document/d/1' })).toBe('http')
  })

  it('prefers http pendingUrl over about:blank#blocked', () => {
    expect(resolveTabUrl({ url: 'about:blank#blocked', pendingUrl: 'https://github.com/acme/pr' })).toBe(
      'https://github.com/acme/pr',
    )
    expect(classifyChromeTab({ url: 'about:blank#blocked', pendingUrl: 'https://github.com/acme/pr' })).toBe('http')
  })

  it('does not call about:blank#blocked a browser page', () => {
    expect(isAboutPlaceholder('about:blank#blocked')).toBe(true)
    expect(classifyChromeTab({ url: 'about:blank#blocked' })).toBe('unknown')
    expect(chromeTabSnapshot({ url: 'about:blank#blocked', title: 'Suspended' }).browserPage).toBe(false)
  })

  it('treats ordinary https tabs as http', () => {
    expect(classifyChromeTab({ url: 'https://example.com/path', pinned: false })).toBe('http')
  })

  it('treats chrome and extension pages as browser', () => {
    expect(classifyChromeTab({ url: 'chrome://extensions' })).toBe('browser')
    expect(classifyChromeTab({ url: 'chrome-extension://abcdef/dashboard/index.html' })).toBe('browser')
  })

  it('recovers https from tab-suspender extension urls and favicons', () => {
    expect(extractEmbeddedHttpUrl('chrome-extension://abcd/suspend.html#https://github.com/acme/pr')).toBe(
      'https://github.com/acme/pr',
    )
    expect(
      extractEmbeddedHttpUrl('chrome-extension://abcd/suspended.html?url=https%3A%2F%2Fdocs.google.com%2Fdoc'),
    ).toBe('https://docs.google.com/doc')
    expect(resolveTabUrl({ url: 'chrome-extension://abcd/x.html#https://nvidia.com/a' })).toBe('https://nvidia.com/a')
    expect(classifyChromeTab({ url: 'chrome-extension://abcd/x.html#https://nvidia.com/a' })).toBe('http')
    expect(
      classifyChromeTab({
        url: 'chrome-extension://abcd/suspended.html',
        favIconUrl: 'chrome://favicon/size/16@1x/https://github.com/acme',
      }),
    ).toBe('http')
  })

  it('does not call about:blank a browser page', () => {
    expect(classifyChromeTab({ url: 'about:blank' })).toBe('unknown')
    expect(chromeTabSnapshot({ url: 'about:blank', title: 'Suspended' }).browserPage).toBe(false)
  })

  it('treats pinned tabs as pinned even when the url is https', () => {
    expect(classifyChromeTab({ url: 'https://github.com', pinned: true })).toBe('pinned')
  })

  it('does not call an empty url a browser page', () => {
    expect(classifyChromeTab({ url: '', pendingUrl: '' })).toBe('unknown')
    expect(classifyChromeTab({ url: undefined, pendingUrl: undefined })).toBe('unknown')
    const snap = chromeTabSnapshot({ url: '', title: 'Suspended' })
    expect(snap.http).toBe(false)
    expect(snap.browserPage).toBe(false)
  })

  it('normalizes Chrome TAB_GROUP_ID_NONE (-1) to null', () => {
    expect(normalizeGroupId(-1)).toBeNull()
    expect(normalizeGroupId(undefined)).toBeNull()
    expect(normalizeGroupId(12)).toBe(12)
  })
})

describe('sweep from chrome-shaped tabs', () => {
  it('files http tabs and skips pinned or browser pages when some urls are empty', () => {
    const result = sweepChromeWindow({
      tabs: [
        { id: 1, url: 'https://github.com/acme/pr', title: 'Pull request', active: true, status: 'complete', groupId: -1 },
        { id: 2, url: '', pendingUrl: 'https://github.com/acme/issues', title: 'Issue list', status: 'complete', groupId: -1 },
        { id: 3, url: 'https://amazon.com/cable', title: 'USB cable', status: 'complete', groupId: -1 },
        { id: 4, url: '', pendingUrl: '', title: '', discarded: true, status: 'unloaded', groupId: -1 },
        { id: 5, url: 'https://github.com/notifications', title: 'Inbox', pinned: true, status: 'complete', groupId: -1 },
        { id: 6, url: 'chrome://extensions', title: 'Extensions', status: 'complete', groupId: -1 },
      ],
    })

    const files = result.actions.filter((action) => action.type === 'file')
    expect(files.map((file) => (file.type === 'file' ? file.create?.title : null))).toEqual(['GitHub', 'Amazon'])
    expect(files[0] && files[0].type === 'file' ? files[0].tabIds : null).toEqual([1, 2])
    expect(files[1] && files[1].type === 'file' ? files[1].tabIds : null).toEqual([3])

    expect(result.summary.split('\n')[0]).toBe(
      'Looked at 6. Already grouped 0. Eligible 3. Grouped 3 into 2 groups. Skipped 2 browser/pinned. Hidden 1.',
    )
    expect(result.summary).toContain('diag: http=')
    expect(result.claimsNothing).toBe(false)

    const eligible = result.tabs.filter((tab) => tab.http && !tab.pinned && !tab.browserPage)
    expect(eligible.length).toBeGreaterThan(0)
    expect(files.length).toBeGreaterThan(0)
  })

  it('a crowded normal window is organized', () => {
    // Matches the 82-tab chrome://extensions screenshot: many restored / discarded
    // tabs expose about:blank (or empty) on url while pendingUrl still has https.
    const tabs: ChromeTabLike[] = []
    for (let i = 1; i <= 40; i += 1) {
      tabs.push({
        id: i,
        url: 'about:blank',
        pendingUrl: `https://github.com/acme/pr/${i}`,
        title: `Pull request ${i}`,
        discarded: true,
        status: 'unloaded',
        groupId: -1,
      })
    }
    for (let i = 41; i <= 70; i += 1) {
      tabs.push({
        id: i,
        url: 'about:blank',
        pendingUrl: `https://docs.google.com/document/d/${i}`,
        title: `Doc ${i}`,
        discarded: true,
        status: 'unloaded',
        groupId: -1,
      })
    }
    for (let i = 71; i <= 79; i += 1) {
      tabs.push({
        id: i,
        url: '',
        pendingUrl: `https://www.youtube.com/watch?v=${i}`,
        title: `Video ${i}`,
        discarded: true,
        status: 'unloaded',
        groupId: -1,
      })
    }
    tabs.push({
      id: 80,
      url: 'https://github.com/notifications',
      title: 'Inbox',
      pinned: true,
      status: 'complete',
      groupId: -1,
    })
    tabs.push({
      id: 81,
      url: 'chrome://extensions',
      title: 'Extensions',
      status: 'complete',
      active: true,
      groupId: -1,
    })
    tabs.push({
      id: 82,
      url: 'chrome-extension://abcdef/page.html',
      title: 'Ext page',
      status: 'complete',
      groupId: -1,
    })

    expect(windowHasHttpTabs(tabs)).toBe(true)
    expect(countHttpTabs(tabs)).toBe(79)

    const result = sweepChromeWindow({ tabs })
    const files = result.actions.filter((action) => action.type === 'file')
    const skipped = result.tabs.filter((tab) => tab.pinned || tab.browserPage).length
    const grouped = new Set(files.flatMap((file) => (file.type === 'file' ? file.tabIds : []))).size

    expect(files.length).toBeGreaterThan(0)
    expect(grouped).toBeGreaterThan(0)
    expect(skipped).toBe(3)
    expect(result.summary.split('\n')[0]).toBe(
      `Looked at 82. Already grouped 0. Eligible 79. Grouped ${grouped} into ${files.length} groups. Skipped 3 browser/pinned. Hidden 0.`,
    )
    expect(result.summary).toContain('diag: http=')
    expect(result.summary).not.toMatch(/Grouped 0 into 0/)
    expect(result.summary).not.toMatch(/Skipped 80/)
    expect(result.claimsNothing).toBe(false)

    const titles = files.map((file) => (file.type === 'file' ? file.create?.title : null))
    expect(titles).toEqual(['GitHub', 'Google', 'YouTube'])
    expect(describeSweep(result.tabs, result.actions, tabs).split('\n')[0]).toBe(result.summary.split('\n')[0])
  })

  /**
   * Proof test for the remaining live bug.
   * Without the fix: about:blank#blocked → browser (Skipped 80) and/or
   * empty/"New Tab" titles → readyState skip (Grouped 0) even when https urls exist.
   */
  it('restored crowded window files about:blank variants and empty titles', () => {
    const tabs: ChromeTabLike[] = []

    // Chrome session-restore / deferred load often uses about:blank#blocked, not exact about:blank.
    for (let i = 1; i <= 30; i += 1) {
      tabs.push({
        id: i,
        url: 'about:blank#blocked',
        pendingUrl: `https://github.com/acme/pr/${i}`,
        title: '',
        discarded: true,
        status: 'unloaded',
        groupId: -1,
      })
    }
    // Real https urls with placeholder titles (Memory Saver / not yet activated).
    for (let i = 31; i <= 55; i += 1) {
      tabs.push({
        id: i,
        url: `https://docs.google.com/document/d/${i}`,
        title: 'New Tab',
        discarded: true,
        status: 'complete',
        groupId: -1,
      })
    }
    for (let i = 56; i <= 79; i += 1) {
      tabs.push({
        id: i,
        url: `https://www.youtube.com/watch?v=${i}`,
        title: '',
        discarded: true,
        status: 'complete',
        groupId: -1,
      })
    }
    tabs.push({
      id: 80,
      url: 'https://github.com/notifications',
      title: 'Inbox',
      pinned: true,
      status: 'complete',
      groupId: -1,
    })
    tabs.push({
      id: 81,
      url: 'chrome://extensions',
      title: 'Extensions',
      status: 'complete',
      active: true,
      groupId: -1,
    })
    tabs.push({
      id: 82,
      url: 'chrome-extension://abcdef/page.html',
      title: 'Ext page',
      status: 'complete',
      groupId: -1,
    })

    // Same helpers the background uses: classify → TabState → decide → summarize.
    const byId = new Map(tabs.flatMap((tab) => (tab.id == null ? [] : [[tab.id, tab] as const])))
    const states = tabs.flatMap((tab) => {
      const state = tabStateFromChrome(tab, byId, { noneGroupId: -1 })
      return state ? [state] : []
    })

    const browserPages = states.filter((tab) => tab.browserPage).length
    expect(browserPages).toBe(2)

    const aboutBlocked = tabs.filter((tab) => (tab.url || '').startsWith('about:blank#'))
    expect(aboutBlocked.every((tab) => classifyChromeTab(tab) === 'http')).toBe(true)

    const result = sweepChromeWindow({ tabs })
    const files = result.actions.filter((action) => action.type === 'file')
    const counts = countSweep(result.tabs, result.actions)

    expect(counts.looked).toBe(82)
    expect(counts.eligible).toBe(79)
    expect(counts.alreadyGrouped).toBe(0)
    expect(counts.grouped).toBeGreaterThan(0)
    expect(counts.groups).toBeGreaterThan(0)
    expect(counts.skipped).toBe(3)
    expect(counts.hidden).toBe(0)
    expect(files.length).toBeGreaterThan(0)
    expect(result.summary.split('\n')[0]).toBe(
      `Looked at 82. Already grouped 0. Eligible 79. Grouped ${counts.grouped} into ${counts.groups} groups. Skipped 3 browser/pinned. Hidden 0.`,
    )
    expect(result.summary).toContain('diag: http=')
    expect(result.summary).not.toMatch(/Grouped 0/)
    expect(result.summary).not.toMatch(/Skipped 80/)
    expect(result.claimsNothing).toBe(false)

    const titles = files.map((file) => (file.type === 'file' ? file.create?.title : null))
    expect(titles).toEqual(['GitHub', 'Google', 'YouTube'])
  })
})
