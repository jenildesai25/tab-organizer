import { classifyChromeTab, resolveTabUrl, type ChromeTabLike, type TabClass } from './chrome-tab.js'
import { domainCovered } from './sites.js'
import type { Action, FileAction, GroupState, TabState } from './types.js'

export type SweepCounts = {
  looked: number
  /** Ungrouped http(s) tabs that a sweep can still file. */
  eligible: number
  /** http(s) tabs already sitting in a group. */
  alreadyGrouped: number
  grouped: number
  groups: number
  /** Pinned tabs + non-http browser pages only — never already-grouped https. */
  skipped: number
  browser: number
  pinned: number
  hidden: number
  actions: number
}

export type SweepDiagCounts = {
  http: number
  browser: number
  pinned: number
  unknown: number
}

export function countSweep(tabs: TabState[], actions: Action[]): SweepCounts {
  const files = actions.filter((action): action is FileAction => action.type === 'file')
  const grouped = new Set(files.flatMap((file) => file.tabIds)).size
  const httpOpen = tabs.filter((tab) => tab.http && !tab.pinned && !tab.incognito)
  const eligible = httpOpen.filter((tab) => tab.groupId === null).length
  const alreadyGrouped = httpOpen.filter((tab) => tab.groupId !== null).length
  const pinned = tabs.filter((tab) => tab.pinned).length
  const browser = tabs.filter((tab) => tab.browserPage && !tab.pinned).length
  const skipped = pinned + browser
  const hidden = tabs.filter((tab) => !tab.http && !tab.pinned && !tab.browserPage && !tab.incognito).length
  return {
    looked: tabs.length,
    eligible,
    alreadyGrouped,
    grouped,
    groups: files.length,
    skipped,
    browser,
    pinned,
    hidden,
    actions: files.length,
  }
}

/** Class counts from the raw Chrome tab list (what the API actually returned). */
export function countChromeClasses(chromeTabs: ChromeTabLike[]): SweepDiagCounts {
  const counts: SweepDiagCounts = { http: 0, browser: 0, pinned: 0, unknown: 0 }
  for (const tab of chromeTabs) {
    const kind = classifyChromeTab(tab)
    counts[kind] += 1
  }
  return counts
}

/** Hostname (or chrome-scheme host) for user-visible diag — never full paths/queries. */
export function diagHostLabel(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return '(empty)'
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.hostname || '(empty)'
    }
    if (parsed.hostname) return `${parsed.protocol}//${parsed.hostname}`
    return parsed.protocol.replace(/:$/, '') || '(empty)'
  } catch {
    return '(empty)'
  }
}

/** Temporary user-visible diagnostic: class counts + hostname samples (no full URLs). */
export function formatSweepDiag(chromeTabs: ChromeTabLike[], sampleLimit = 3): string {
  const counts = countChromeClasses(chromeTabs)
  const samples: string[] = []
  for (const tab of chromeTabs) {
    if (samples.length >= sampleLimit) break
    const kind = classifyChromeTab(tab)
    const resolved = resolveTabUrl(tab) || tab.url || tab.pendingUrl || ''
    samples.push(`${diagHostLabel(resolved)}[${kind}]`)
  }
  const sampleText = samples.length > 0 ? samples.join(', ') : '(no tabs)'
  return `diag: http=${counts.http} browser=${counts.browser} pinned=${counts.pinned} unknown=${counts.unknown} | ${sampleText}`
}

export function describeSweep(tabs: TabState[], actions: Action[], chromeTabs?: ChromeTabLike[]): string {
  const counts = countSweep(tabs, actions)
  const parts = [
    `Looked at ${counts.looked}.`,
    `Already grouped ${counts.alreadyGrouped}.`,
    `Eligible ${counts.eligible}.`,
    `Grouped ${counts.grouped} into ${counts.groups} groups.`,
    `Skipped ${counts.skipped} browser/pinned.`,
    `Hidden ${counts.hidden}.`,
  ]
  let summary = parts.join(' ')
  if (counts.eligible === 0 && counts.alreadyGrouped > 0 && counts.grouped === 0) {
    summary = `All ${counts.alreadyGrouped} http tabs are already in groups. Skipped ${counts.skipped} browser/pinned. Hidden ${counts.hidden}.`
  }
  if (chromeTabs) {
    summary = `${summary}\n${formatSweepDiag(chromeTabs)}`
  }
  return summary
}

function sharedCovers(groups: GroupState[], domain: string): boolean {
  return groups.some(
    (group) =>
      group.shared &&
      group.dominantDomain !== null &&
      (domainCovered(domain, group.dominantDomain) || domainCovered(group.dominantDomain, domain)),
  )
}

/** Ordinary ungrouped pages a sweep was supposed to file. */
export function ungroupedPages(tabs: TabState[], groups: GroupState[]): TabState[] {
  return tabs.filter((tab) => {
    if (!tab.http || tab.pinned || tab.incognito || tab.groupId !== null) return false
    if (tab.status !== 'complete' || tab.openedInsideGroup) return false
    // Domain alone is enough — titles are often blank on restored tabs.
    if (tab.card.domain === '') return false
    if (sharedCovers(groups, tab.card.domain)) return false
    return true
  })
}

export function sweepClaimsNothing(tabs: TabState[], actions: Action[], groups: GroupState[]): boolean {
  const filed = actions.some((action) => action.type === 'file')
  return !filed && ungroupedPages(tabs, groups).length > 0
}

export type { TabClass }
