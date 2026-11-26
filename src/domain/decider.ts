import { titleIsUsable } from './feature-card.js'
import {
  colorForKey,
  domainCovered,
  isLoopbackFilingKey,
  isStaleLoopbackGroupTitle,
  preferredSiteGroupTitle,
  siteTitle,
  titlesMatch,
} from './sites.js'
import type {
  Action,
  AskAdvisorAction,
  CompiledRule,
  DecideInput,
  FileAction,
  GroupState,
  GroupSummary,
  RetitleAction,
  TabState,
} from './types.js'
import { ADVISOR_CONFIDENCE, ASK_OVERLAP, FILE_OVERLAP, SETTLE_MS } from './types.js'
import { isShortTitle, jaccard } from './words.js'

type Readiness = 'ready' | 'wait' | 'skip'

type Intent =
  | { kind: 'rule'; rule: CompiledRule }
  | { kind: 'site'; domain: string }
  | { kind: 'topic'; groupId: number }
  | { kind: 'loose' }
  | { kind: 'ask' }
  | { kind: 'none' }

const GENERIC = new Set([
  'best',
  'docs',
  'free',
  'home',
  'html',
  'http',
  'https',
  'index',
  'login',
  'news',
  'official',
  'online',
  'page',
  'review',
  'reviews',
  'search',
  'video',
  'watch',
  'your',
])

export function decide(input: DecideInput): Action[] {
  if (input.mode === 'watch' && (!input.organizerOn || !input.focused)) return []

  const waits: Action[] = []
  const ready: TabState[] = []

  for (const tab of input.tabs) {
    if (!eligible(tab, input.mode, input)) continue
    if (input.mode === 'watch' && !tab.candidate) continue
    if (sharedMembership(input, tab)) continue
    const readiness = readyState(tab, input)
    if (readiness === 'skip') continue
    if (readiness === 'wait') {
      if (input.mode === 'watch') {
        waits.push({ type: 'wait', tabId: tab.id, readyAt: readyAt(tab) })
      }
      continue
    }
    if (tab.advisorPending && input.suggestion?.tabId !== tab.id) continue
    // Already filed for this site and still in a matching group — skip.
    // If the tab navigated away and sits in the wrong site group, re-decide.
    if (
      input.mode === 'watch' &&
      tab.lastFiledDomain === tab.card.domain &&
      tab.groupId !== null &&
      input.suggestion?.tabId !== tab.id &&
      !mismatchedSiteGroup(tab, input)
    ) {
      continue
    }
    ready.push(tab)
  }

  const intents = new Map<number, Intent>()
  for (const tab of ready) intents.set(tab.id, intentFor(tab, input, ready))

  const actions: Action[] = []
  const used = new Set<number>()

  for (const tab of ready) {
    if (used.has(tab.id)) continue
    const intent = intents.get(tab.id)
    if (!intent || intent.kind === 'none') continue
    if (intent.kind === 'ask') {
      actions.push(askAction(tab, input))
      used.add(tab.id)
      continue
    }
    if (intent.kind === 'topic') {
      const members = ready.filter((other) => intents.get(other.id)?.kind === 'topic' && topicGroupId(intents.get(other.id)) === intent.groupId)
      for (const member of members) used.add(member.id)
      const file = fileIntoGroup(members.filter((member) => member.groupId !== intent.groupId), intent.groupId, input)
      if (file) actions.push(file)
      continue
    }
    if (intent.kind === 'loose') continue
    if (intent.kind === 'rule') {
      const members = ready.filter((other) => {
        const otherIntent = intents.get(other.id)
        return otherIntent?.kind === 'rule' && otherIntent.rule.id === intent.rule.id
      })
      for (const member of members) used.add(member.id)
      actions.push(...actionsForRule(members, intent.rule, input))
      continue
    }
    const members = ready.filter((other) => {
      const otherIntent = intents.get(other.id)
      return otherIntent?.kind === 'site' && otherIntent.domain === intent.domain
    })
    for (const member of members) used.add(member.id)
    actions.push(...actionsForSite(members, intent.domain, input))
  }

  if (input.mode === 'sweep') {
    const loose = ready.filter((tab) => intents.get(tab.id)?.kind === 'loose')
    actions.push(...clusterLoose(loose, input))
    actions.push(...retitleStaleLoopbackGroups(input, actions))
    actions.push(...retitleStaleSiteGroups(input, actions))
  }

  return [...actions, ...waits.sort((a, b) => (a.type === 'wait' && b.type === 'wait' ? a.tabId - b.tabId : 0))]
}

function topicGroupId(intent: Intent | undefined): number | null {
  return intent?.kind === 'topic' ? intent.groupId : null
}

function eligible(tab: TabState, mode: DecideInput['mode'], input: DecideInput): boolean {
  if (tab.pinned || tab.incognito || !tab.http) return false
  // A link opened inside a group stays put while it is still on that group's site.
  // After the person navigates to a different site, allow refiling.
  if (tab.openedInsideGroup && !mismatchedSiteGroup(tab, input)) return false
  // A drag into a group stays put. An explicit sweep still files an ungrouped tab,
  // including one that was marked sticky by an ordinary tab update.
  if (tab.sticky && (mode !== 'sweep' || tab.groupId !== null)) return false
  return true
}

/**
 * True when the tab sits in a non-shared site group whose dominant domain does
 * not cover the tab's current site key (e.g. google.com group, now on whatsapp.com).
 */
function mismatchedSiteGroup(tab: TabState, input: DecideInput): boolean {
  if (tab.groupId === null || tab.card.domain === '') return false
  const group = input.groups.find((item) => item.id === tab.groupId)
  if (!group || group.shared || group.dominantDomain == null) return false
  return !(
    domainCovered(tab.card.domain, group.dominantDomain) ||
    domainCovered(group.dominantDomain, tab.card.domain)
  )
}

function sharedMembership(input: DecideInput, tab: TabState): boolean {
  if (tab.groupId === null) return false
  const group = input.groups.find((item) => item.id === tab.groupId)
  return group?.shared === true
}

function readyState(tab: TabState, input: DecideInput): Readiness {
  // Site filing only needs a domain. Restored / discarded tabs often keep the
  // https url but show "" or "New Tab" until activated — sweep must still file them.
  if (tab.card.domain === '') return input.mode === 'sweep' ? 'skip' : 'wait'
  if (input.mode === 'sweep') return tab.status === 'complete' ? 'ready' : 'skip'
  if (!titleIsUsable(tab.card.title)) return 'wait'
  if (tab.status !== 'complete' || tab.titleStableSince === null) return 'wait'
  if (input.now - tab.titleStableSince < SETTLE_MS) return 'wait'
  return 'ready'
}

function readyAt(tab: TabState): number | null {
  if (tab.status !== 'complete' || tab.titleStableSince === null || !titleIsUsable(tab.card.title)) return null
  return tab.titleStableSince + SETTLE_MS
}

function intentFor(tab: TabState, input: DecideInput, ready: TabState[]): Intent {
  if (sharedCovers(input, tab.card.domain)) return { kind: 'none' }
  if (input.suggestion?.tabId === tab.id) return suggestionIntent(tab, input)

  const rule = input.rules.find((item) => item.domains.some((domain) => domainCovered(tab.card.domain, domain)))
  if (rule) return { kind: 'rule', rule }

  if (siteGroup(input, tab.card.domain)) return { kind: 'site', domain: tab.card.domain }

  const peers = ready.filter(
    (other) => other.card.domain === tab.card.domain && other.groupId === null && !coveringRule(input, other),
  )
  if (peers.length >= 2 && peers.some((other) => other.id === tab.id)) {
    return { kind: 'site', domain: tab.card.domain }
  }

  // Navigated away from the site group it sits in — refile by site (move or create).
  if (mismatchedSiteGroup(tab, input)) return { kind: 'site', domain: tab.card.domain }

  const topic = bestTopic(tab, input)
  if (topic && topic.score >= FILE_OVERLAP) return { kind: 'topic', groupId: topic.group.id }
  if (input.mode === 'sweep' && tab.groupId === null) return { kind: 'loose' }
  if (topic && topic.score >= ASK_OVERLAP && input.llmOn) return { kind: 'ask' }
  // Live organizer: a new ungrouped tab gets its own site group when nothing matches.
  if (input.mode === 'watch' && tab.groupId === null) return { kind: 'site', domain: tab.card.domain }
  return { kind: 'none' }
}

function sharedCovers(input: DecideInput, domain: string): boolean {
  return input.groups.some(
    (group) =>
      group.shared &&
      group.dominantDomain !== null &&
      (domainCovered(domain, group.dominantDomain) || domainCovered(group.dominantDomain, domain)),
  )
}

function coveringRule(input: DecideInput, tab: TabState): boolean {
  return input.rules.some((rule) => rule.domains.some((domain) => domainCovered(tab.card.domain, domain)))
}

function suggestionIntent(tab: TabState, input: DecideInput): Intent {
  const suggestion = input.suggestion
  if (!suggestion || suggestion.tabId !== tab.id) return { kind: 'none' }
  if (suggestion.confidence < ADVISOR_CONFIDENCE || !isShortTitle(suggestion.title)) return { kind: 'none' }
  const title = suggestion.title.trim()
  const existing = openGroup(input, (group) => titlesMatch(group.title, title))
  if (existing) return { kind: 'topic', groupId: existing.id }
  return { kind: 'site', domain: `topic:${title.toLowerCase()}` }
}

function bestTopic(tab: TabState, input: DecideInput): { group: GroupState; score: number } | null {
  const tokens = [...tab.card.titleWords, ...tab.card.pathWords]
  let best: { group: GroupState; score: number } | null = null
  for (const group of input.groups) {
    if (group.shared) continue
    const score = jaccard(tokens, group.words)
    if (!best || score > best.score) best = { group, score }
  }
  return best
}

function openGroup(input: DecideInput, predicate: (group: GroupState) => boolean): GroupState | undefined {
  return input.groups.find((group) => !group.shared && predicate(group))
}

function expands(tabs: TabState[]): boolean {
  return tabs.some((tab) => tab.active)
}

function anchor(tabs: TabState[]): TabState {
  return tabs.find((tab) => tab.active) ?? tabs.slice().sort((a, b) => a.id - b.id)[0]!
}

function fileIntoGroup(tabs: TabState[], groupId: number, input: DecideInput): FileAction | null {
  const moving = tabs.filter((tab) => tab.groupId !== groupId)
  if (moving.length === 0) return null
  return {
    type: 'file',
    tabIds: moving.map((tab) => tab.id).sort((a, b) => a - b),
    expand: expands(moving),
    groupId,
    create: null,
  }
}

function createGroup(tabs: TabState[], title: string, input: DecideInput): FileAction | null {
  if (tabs.length === 0) return null
  const home = anchor(tabs)
  const ids = [home.id, ...tabs.filter((tab) => tab.id !== home.id).map((tab) => tab.id).sort((a, b) => a - b)]
  return {
    type: 'file',
    tabIds: ids,
    expand: expands(tabs),
    groupId: null,
    create: { title, color: colorForKey(title), aroundTabId: home.id },
  }
}

function actionsForRule(tabs: TabState[], rule: CompiledRule, input: DecideInput): Action[] {
  const titled = openGroup(input, (group) => titlesMatch(group.title, rule.title))
  const dominated = input.groups
    .filter(
      (group) =>
        !group.shared &&
        group.dominantDomain !== null &&
        rule.domains.some((domain) => domainCovered(group.dominantDomain as string, domain)),
    )
    .sort((a, b) => a.id - b.id)
  const target = titled ?? dominated[0]
  const actions: Action[] = []
  if (target && target.title !== rule.title) {
    actions.push(retitle(target.id, rule.title))
  }
  if (target) {
    const file = fileIntoGroup(tabs, target.id, input)
    if (file) actions.push(file)
    return actions
  }
  const created = createGroup(tabs, rule.title, input)
  if (created) actions.push(created)
  return actions
}

/** Prefer one open group for a site: canonical title, then case-insensitive title, then lowest id. */
function siteGroup(input: DecideInput, domain: string): GroupState | undefined {
  const matches = input.groups
    .filter((group) => !group.shared && group.dominantDomain === domain)
    .sort((a, b) => a.id - b.id)
  if (matches.length === 0) return undefined
  const wanted = siteTitle(domain)
  return (
    matches.find((group) => group.title === wanted) ??
    matches.find((group) => titlesMatch(group.title, wanted)) ??
    matches[0]
  )
}

function actionsForSite(tabs: TabState[], domain: string, input: DecideInput): Action[] {
  if (domain.startsWith('topic:')) {
    const title = tabs.length > 0 ? suggestionTitle(input, tabs) : null
    if (!title) return []
    const existing = openGroup(input, (group) => titlesMatch(group.title, title))
    if (existing) {
      const file = fileIntoGroup(tabs, existing.id, input)
      return file ? [file] : []
    }
    const created = createGroup(tabs, title, input)
    return created ? [created] : []
  }
  const existing = siteGroup(input, domain)
  if (existing) {
    const actions: Action[] = []
    if (
      !existing.handRenamed &&
      isLoopbackFilingKey(domain) &&
      isStaleLoopbackGroupTitle(existing.title)
    ) {
      actions.push(retitle(existing.id, 'Local'))
    } else if (!existing.handRenamed) {
      const preferred = preferredSiteGroupTitle(domain, existing.title)
      if (preferred) actions.push(retitle(existing.id, preferred))
    }
    const file = fileIntoGroup(tabs, existing.id, input)
    if (file) actions.push(file)
    return actions
  }
  const title = siteTitle(domain)
  // Reuse a same-domain-or-untitled group whose title only differs by case.
  const titled = openGroup(
    input,
    (group) =>
      titlesMatch(group.title, title) &&
      (group.dominantDomain === null || group.dominantDomain === domain),
  )
  if (titled) {
    const file = fileIntoGroup(tabs, titled.id, input)
    return file ? [file] : []
  }
  // Ungrouped tabs, or tabs parked in the wrong site group after a navigation.
  const creatable = tabs.filter((tab) => tab.groupId === null || mismatchedSiteGroup(tab, input))
  if (creatable.length === 0) return []
  const created = createGroup(creatable, title, input)
  return created ? [created] : []
}

/** True when a user rule claims this filing key — do not restore DISPLAY over the rule title. */
function domainClaimedByRule(input: DecideInput, domain: string | null | undefined): boolean {
  if (!domain) return false
  return input.rules.some((rule) => rule.domains.some((item) => domainCovered(domain, item)))
}

/** Rename leftover "127" / host:port loopback groups to Local on Organize. */
function retitleStaleLoopbackGroups(input: DecideInput, already: Action[]): RetitleAction[] {
  const done = new Set(
    already.filter((action): action is RetitleAction => action.type === 'retitle').map((action) => action.groupId),
  )
  const actions: RetitleAction[] = []
  for (const group of input.groups) {
    if (group.shared || group.handRenamed || done.has(group.id)) continue
    if (!isLoopbackFilingKey(group.dominantDomain)) continue
    if (domainClaimedByRule(input, group.dominantDomain)) continue
    if (!isStaleLoopbackGroupTitle(group.title) && !preferredSiteGroupTitle(group.dominantDomain, group.title)) {
      continue
    }
    actions.push(retitle(group.id, 'Local'))
  }
  return actions
}

/** Restore "Github" / "DevOps Skills" → "GitHub" (and other stable site labels) on Organize. */
function retitleStaleSiteGroups(input: DecideInput, already: Action[]): RetitleAction[] {
  const done = new Set(
    already.filter((action): action is RetitleAction => action.type === 'retitle').map((action) => action.groupId),
  )
  const actions: RetitleAction[] = []
  for (const group of input.groups) {
    if (group.shared || group.handRenamed || done.has(group.id)) continue
    if (isLoopbackFilingKey(group.dominantDomain)) continue
    if (domainClaimedByRule(input, group.dominantDomain)) continue
    const preferred = preferredSiteGroupTitle(group.dominantDomain, group.title)
    if (!preferred) continue
    actions.push(retitle(group.id, preferred))
  }
  return actions
}

function suggestionTitle(input: DecideInput, tabs: TabState[]): string | null {
  const suggestion = input.suggestion
  if (!suggestion || !tabs.some((tab) => tab.id === suggestion.tabId)) return null
  const title = suggestion.title.trim()
  return isShortTitle(title) ? title : null
}

function retitle(groupId: number, title: string): RetitleAction {
  return { type: 'retitle', groupId, title, color: colorForKey(title) }
}

function tabTokens(tab: TabState): string[] {
  const label = tab.card.domain.split('.')[0] ?? ''
  return [...tab.card.titleWords, ...tab.card.pathWords].filter(
    (word) => word.length >= 4 && word !== label && !GENERIC.has(word),
  )
}

function related(left: string[], right: string[]): boolean {
  if (jaccard(left, right) >= 0.4) return true
  const words = new Set(left)
  let shared = 0
  for (const word of right) if (words.has(word)) shared += 1
  return shared >= 2
}

function clusterTitle(tabs: TabState[]): string | null {
  const counts = new Map<string, number>()
  const order: string[] = []
  for (const tab of tabs) {
    for (const word of tabTokens(tab)) {
      if (!counts.has(word)) order.push(word)
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }
  const shared = order.filter((word) => (counts.get(word) ?? 0) >= 2)
  const title = shared.slice(0, 2).join(' ')
  return isShortTitle(title) ? title : null
}

function clusterLoose(tabs: TabState[], input: DecideInput): FileAction[] {
  if (tabs.length === 0) return []
  const parent = tabs.map((_, index) => index)
  const find = (index: number): number => {
    let cursor = index
    while (parent[cursor] !== cursor) cursor = parent[cursor] ?? cursor
    return cursor
  }
  const tokens = tabs.map(tabTokens)
  for (let left = 0; left < tabs.length; left += 1) {
    for (let right = left + 1; right < tabs.length; right += 1) {
      const sameSite = tabs[left]?.card.domain === tabs[right]?.card.domain
      if (!sameSite && !related(tokens[left] ?? [], tokens[right] ?? [])) continue
      parent[find(right)] = find(left)
    }
  }
  const buckets = new Map<number, TabState[]>()
  tabs.forEach((tab, index) => {
    const root = find(index)
    const bucket = buckets.get(root) ?? []
    bucket.push(tab)
    buckets.set(root, bucket)
  })
  const clusters = [...buckets.values()].sort((left, right) => minId(left) - minId(right))
  const actions: FileAction[] = []
  for (const cluster of clusters) {
    const domains = new Set(cluster.map((tab) => tab.card.domain))
    const domain = cluster[0]?.card.domain ?? ''
    if (domains.size === 1) {
      const existing = siteGroup(input, domain)
      if (existing) {
        const file = fileIntoGroup(cluster, existing.id, input)
        if (file) actions.push(file)
        continue
      }
      const title = siteTitle(domain)
      const titled = openGroup(
        input,
        (group) =>
          titlesMatch(group.title, title) &&
          (group.dominantDomain === null || group.dominantDomain === domain),
      )
      if (titled) {
        const file = fileIntoGroup(cluster, titled.id, input)
        if (file) actions.push(file)
        continue
      }
      const file = createGroup(cluster, title, input)
      if (file) actions.push(file)
      continue
    }
    const title = clusterTitle(cluster)
    if (title) {
      const titled = openGroup(input, (group) => titlesMatch(group.title, title))
      if (titled) {
        const file = fileIntoGroup(cluster, titled.id, input)
        if (file) actions.push(file)
        continue
      }
      const file = createGroup(cluster, title, input)
      if (file) actions.push(file)
      continue
    }
    for (const tab of cluster) {
      const file = createGroup([tab], siteTitle(tab.card.domain), input)
      if (file) actions.push(file)
    }
  }
  return actions
}

function minId(tabs: TabState[]): number {
  return tabs.reduce((lowest, tab) => Math.min(lowest, tab.id), Number.POSITIVE_INFINITY)
}

function askAction(tab: TabState, input: DecideInput): AskAdvisorAction {
  const groups: GroupSummary[] = input.groups
    .filter((group) => !group.shared)
    .map((group) => ({
      id: group.id,
      title: group.title,
      domains: group.domains,
      words: group.words,
      size: group.size,
    }))
  return { type: 'ask-advisor', tabId: tab.id, card: tab.card, groups }
}
