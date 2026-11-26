import { chromeTabSnapshot, normalizeGroupId, resolveTabUrl, type ChromeTabLike } from './chrome-tab.js'
import { decide } from './decider.js'
import { buildFeatureCard } from './feature-card.js'
import { describeSweep, sweepClaimsNothing } from './summary.js'
import type { Action, DecideInput, GroupState, TabState } from './types.js'

export type ChromeGroupLike = {
  id: number
  title?: string
  collapsed?: boolean
  shared?: boolean
}

export type SweepChromeInput = {
  tabs: ChromeTabLike[]
  groups?: ChromeGroupLike[]
  /** Chrome.tabGroups.TAB_GROUP_ID_NONE, default -1. */
  noneGroupId?: number
  stickyIds?: ReadonlySet<number>
  candidateIds?: ReadonlySet<number>
  filedDomains?: ReadonlyMap<number, string>
  advisorPendingIds?: ReadonlySet<number>
  handRenamedIds?: ReadonlySet<number>
  now?: number
  organizerOn?: boolean
  llmOn?: boolean
  rules?: DecideInput['rules']
  focused?: boolean
}

function tabLoadStatus(tab: ChromeTabLike): 'loading' | 'complete' {
  if (tab.status === 'loading') return 'loading'
  if (tab.status === 'complete' || tab.discarded === true || resolveTabUrl(tab) !== '') return 'complete'
  return 'loading'
}

export function tabStateFromChrome(
  tab: ChromeTabLike,
  byId: Map<number, ChromeTabLike>,
  opts: {
    noneGroupId?: number
    stickyIds?: ReadonlySet<number>
    candidateIds?: ReadonlySet<number>
    filedDomains?: ReadonlyMap<number, string>
    advisorPendingIds?: ReadonlySet<number>
  } = {},
): TabState | null {
  if (tab.id == null) return null
  const noneGroupId = opts.noneGroupId ?? -1
  const opener = tab.openerTabId != null ? byId.get(tab.openerTabId) : undefined
  const snap = chromeTabSnapshot(tab, opener ?? null)
  const groupId = normalizeGroupId(tab.groupId, noneGroupId)
  const openerGroupId = opener ? normalizeGroupId(opener.groupId, noneGroupId) : null
  return {
    id: tab.id,
    active: tab.active === true,
    pinned: tab.pinned === true,
    incognito: tab.incognito === true,
    http: snap.http,
    browserPage: snap.browserPage,
    sticky: opts.stickyIds?.has(tab.id) === true,
    openedInsideGroup: opener != null && groupId !== null && openerGroupId === groupId,
    candidate: opts.candidateIds?.has(tab.id) === true,
    status: tabLoadStatus(tab),
    titleStableSince: null,
    groupId,
    lastFiledDomain: opts.filedDomains?.get(tab.id) ?? null,
    advisorPending: opts.advisorPendingIds?.has(tab.id) === true,
    card: snap.card,
  }
}

export function groupStateFromChrome(
  group: ChromeGroupLike,
  tabs: ChromeTabLike[],
  handRenamedIds?: ReadonlySet<number>,
): GroupState {
  const counts = new Map<string, number>()
  const wordCounts = new Map<string, number>()
  for (const tab of tabs) {
    if (tab.groupId !== group.id) continue
    const card = buildFeatureCard({ url: resolveTabUrl(tab), title: tab.title || '' })
    if (card.domain) counts.set(card.domain, (counts.get(card.domain) ?? 0) + 1)
    for (const word of [...card.titleWords, ...card.pathWords]) {
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1)
    }
  }
  let dominantDomain: string | null = null
  let best = 0
  for (const [domain, count] of counts) {
    if (count > best) {
      dominantDomain = domain
      best = count
    }
  }
  const words = [...wordCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([word]) => word)
  return {
    id: group.id,
    title: group.title ?? '',
    dominantDomain,
    domains: [...counts.keys()],
    words,
    size: tabs.filter((tab) => tab.groupId === group.id).length,
    collapsed: group.collapsed === true,
    shared: group.shared === true,
    handRenamed: handRenamedIds?.has(group.id) === true,
  }
}

/** Same classify → decide → summarize path the service worker uses for a sweep. */
export function sweepChromeWindow(input: SweepChromeInput): {
  tabs: TabState[]
  groups: GroupState[]
  actions: Action[]
  summary: string
  claimsNothing: boolean
} {
  const byId = new Map(input.tabs.flatMap((tab) => (tab.id == null ? [] : [[tab.id, tab] as const])))
  const opts = {
    noneGroupId: input.noneGroupId ?? -1,
    stickyIds: input.stickyIds,
    candidateIds: input.candidateIds,
    filedDomains: input.filedDomains,
    advisorPendingIds: input.advisorPendingIds,
  }
  const tabs = input.tabs.flatMap((tab) => {
    const state = tabStateFromChrome(tab, byId, opts)
    return state ? [state] : []
  })
  const groups = (input.groups ?? []).map((group) => groupStateFromChrome(group, input.tabs, input.handRenamedIds))
  const decideInput: DecideInput = {
    now: input.now ?? 10_000,
    organizerOn: input.organizerOn === true,
    llmOn: input.llmOn === true,
    mode: 'sweep',
    focused: input.focused !== false,
    rules: input.rules ?? [],
    groups,
    tabs,
    suggestion: null,
  }
  const actions = decide(decideInput)
  return {
    tabs,
    groups,
    actions,
    summary: describeSweep(tabs, actions, input.tabs),
    claimsNothing: sweepClaimsNothing(tabs, actions, groups),
  }
}

/** True when a window has at least one ordinary http(s) tab worth organizing. */
export function windowHasHttpTabs(tabs: ChromeTabLike[]): boolean {
  return tabs.some((tab) => {
    if (tab.pinned === true || tab.incognito === true) return false
    const snap = chromeTabSnapshot(tab)
    return snap.http
  })
}

export function countHttpTabs(tabs: ChromeTabLike[]): number {
  return tabs.filter((tab) => chromeTabSnapshot(tab).http && tab.pinned !== true && tab.incognito !== true).length
}
