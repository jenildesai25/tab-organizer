import { fileTabs, retitleGroup } from './apply.js'
import { cancelAdvisor, enqueueAdvisor, RETITLE_TIMEOUT_MS } from './advisor.js'
import {
  filterActivityByActor,
  filterActivityByFilter,
  type ActivityActor,
  type ActivityDraft,
} from './domain/activity-log.js'
import { extractEmbeddedHttpUrl, resolveTabUrl, type ChromeTabLike } from './domain/chrome-tab.js'
import { decide } from './domain/decider.js'
import { buildFeatureCard, isHttpUrl, titleIsUsable } from './domain/feature-card.js'
import {
  advisorMessages,
  buildGroupRetitlePayload,
  parseAdvisorContent,
  parseRetitleContent,
  parseRuleContent,
  retitleGroupMessages,
  ruleMessages,
} from './domain/prompts.js'
import { createSingleFlightGate } from './domain/concurrency.js'
import { claimRule, compileSentence, deleteRule, retitlesForSavedRule, ruleToSave } from './domain/rules.js'
import {
  boundGroupIds,
  groupFingerprint,
  omitGroupBinding,
  rebindGroupFingerprints,
  type LiveGroupSnapshot,
} from './domain/group-identity.js'
import { decideSiteRetitle, rejectRetitleSuggestion } from './domain/site-retitle.js'
import { canonicalSite, titlesMatch } from './domain/sites.js'
import { groupStateFromChrome, tabStateFromChrome } from './domain/sweep-chrome.js'
import { buildSweepDiag, type SweepDiag } from './domain/sweep-diag.js'
import { pickSweepWindowId } from './domain/sweep-window.js'
import { ADVISOR_CONFIDENCE, type Action, type DecideInput, type WaitAction } from './domain/types.js'
import { isShortTitle } from './domain/words.js'
import { marksSticky } from './domain/stickiness.js'
import { describeSweep, sweepClaimsNothing } from './domain/summary.js'
import { isChromeColor, tabGroupViewFromChrome, tabGroupViewsFromChrome } from './domain/tab-groups.js'
import {
  CLEANUP_ALARM_NAME,
  CLEANUP_ALARM_PERIOD_MINUTES,
  clampCleanupAgeDays,
  cleanupAlarmAction,
  filterConfirmedTargets,
  formatCleanupAgeLabel,
  normalizeProtectDomains,
  normalizeUrlPattern,
  selectCleanupTargets,
  siteKeyForCleanupTab,
  urlMatchesProtectPattern,
  urlPatternForCleanupTab,
  type ProtectLists,
} from './domain/tab-cleanup.js'
import { describeOllamaFailure, listLocalModels, ollamaChat, OLLAMA_DOWN_MESSAGE } from './ollama.js'
import type {
  ActivityLogResult,
  CleanupPreviewResult,
  CleanupRunResult,
  ClearActivityResult,
  ListGroupsResult,
  ModelsResult,
  PreviewResult,
  ProtectUpdateResult,
  RetitleGroupResult,
  RetitleGroupsResult,
  RetitleProgress,
  StateResult,
  SweepResult,
  TestOllamaResult,
  ToBackground,
  UngroupResult,
  UpdateGroupResult,
} from './protocol.js'
import {
  appendActivity,
  clearActivityLog,
  loadActivityLog,
  forgetHandRenamedGroup,
  loadSettings,
  rememberHandRenamedGroup,
  restoreHandRenamedGroups,
  updateSettings,
  type Settings,
} from './storage.js'

const sticky = new Set<number>()
const candidates = new Set<number>()
const filed = new Map<number, string>()
const advisorPending = new Set<number>()
const handRenamed = new Set<number>()
const ownTabs = new Set<number>()
const ownGroups = new Set<number>()
const groupTitles = new Map<number, string>()
const stability = new Map<number, { domain: string; title: string; since: number }>()
const settleTimers = new Map<number, ReturnType<typeof setTimeout>>()
const scheduled = new Map<number, ReturnType<typeof setTimeout>>()
const retitleGate = createSingleFlightGate()

let organizerOn = false
let llmOn = false
let statusNote = ''
let settingsEpoch = 0
let retitleProgress: RetitleProgress | null = null

function applyHandRenamedIds(ids: readonly number[]): void {
  handRenamed.clear()
  for (const id of ids) handRenamed.add(id)
}

async function liveGroupSnapshots(): Promise<LiveGroupSnapshot[]> {
  const [groups, tabs] = await Promise.all([chrome.tabGroups.query({}), chrome.tabs.query({})])
  return groups.map((group) => ({
    id: group.id,
    title: group.title ?? '',
    color: group.color ?? '',
    patterns: tabs.flatMap((tab) => {
      if (tab.groupId !== group.id) return []
      const pattern = urlPatternForCleanupTab(tab)
      return pattern ? [pattern] : []
    }),
  }))
}

async function fingerprintForGroup(groupId: number): Promise<ReturnType<typeof groupFingerprint>> {
  try {
    const group = await chrome.tabGroups.get(groupId)
    const tabs = await chrome.tabs.query({ groupId })
    return groupFingerprint({
      title: group.title ?? '',
      color: group.color,
      urls: tabs.flatMap((tab) => {
        const pattern = urlPatternForCleanupTab(tab)
        return pattern ? [pattern] : []
      }),
    })
  } catch {
    return null
  }
}

async function rememberHandRenamed(groupId: number): Promise<void> {
  const live = await liveGroupSnapshots()
  const fingerprint = await fingerprintForGroup(groupId)
  applyHandRenamedIds(await rememberHandRenamedGroup(groupId, fingerprint, live))
}

async function forgetHandRenamed(groupId: number, title = ''): Promise<void> {
  const live = await liveGroupSnapshots()
  applyHandRenamedIds(await forgetHandRenamedGroup(groupId, live, title))
}

function markTabs(ids: number[]): void {
  for (const id of ids) {
    ownTabs.add(id)
    setTimeout(() => ownTabs.delete(id), 1500)
  }
}

function markGroup(id: number): void {
  ownGroups.add(id)
  setTimeout(() => ownGroups.delete(id), 1500)
}

function rememberStability(tabId: number, domain: string, title: string): number | null {
  if (!titleIsUsable(title) || domain === '') {
    stability.delete(tabId)
    return null
  }
  const previous = stability.get(tabId)
  if (previous && previous.domain === domain && previous.title === title) return previous.since
  const since = Date.now()
  stability.set(tabId, { domain, title, since })
  return since
}

function preferAddress(primary?: string, secondary?: string): string | undefined {
  const first = (primary || '').trim()
  const second = (secondary || '').trim()
  const fromFirst = extractEmbeddedHttpUrl(first)
  const fromSecond = extractEmbeddedHttpUrl(second)
  if (fromFirst) return fromFirst
  if (fromSecond) return fromSecond
  if (first) return first
  if (second) return second
  return primary || secondary
}

async function hydrateTab(tab: chrome.tabs.Tab): Promise<chrome.tabs.Tab> {
  if (isHttpUrl(resolveTabUrl(tab)) || tab.id == null) return tab
  try {
    const fresh = await chrome.tabs.get(tab.id)
    return {
      ...tab,
      url: preferAddress(fresh.url, tab.url),
      pendingUrl: preferAddress(fresh.pendingUrl, tab.pendingUrl),
      favIconUrl: fresh.favIconUrl || tab.favIconUrl,
      title: fresh.title || tab.title,
      discarded: fresh.discarded,
      status: fresh.status || tab.status,
    }
  } catch {
    return tab
  }
}

async function hydrateTabs(tabs: chrome.tabs.Tab[]): Promise<chrome.tabs.Tab[]> {
  return Promise.all(tabs.map((tab) => hydrateTab(tab)))
}

type BuiltInput = DecideInput & { chromeTabs: ChromeTabLike[] }

async function buildInput(
  windowId: number,
  settings: Settings,
  mode: 'watch' | 'sweep',
  focused: boolean,
): Promise<BuiltInput> {
  const [queried, groups] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
  ])
  const tabs = await hydrateTabs(queried)
  const byId = new Map(tabs.flatMap((tab) => (tab.id == null ? [] : [[tab.id, tab as ChromeTabLike] as const])))
  const noneGroupId = chrome.tabGroups.TAB_GROUP_ID_NONE
  const states = tabs.flatMap((tab) => {
    const state = tabStateFromChrome(tab, byId, {
      noneGroupId,
      stickyIds: sticky,
      candidateIds: candidates,
      filedDomains: filed,
      advisorPendingIds: advisorPending,
    })
    if (!state) return []
    state.titleStableSince = rememberStability(state.id, state.card.domain, state.card.title)
    return [state]
  })
  return {
    now: Date.now(),
    organizerOn: settings.organizerOn,
    llmOn: settings.llmOn,
    mode,
    focused,
    rules: settings.rules,
    groups: groups.map((group) => groupStateFromChrome(group, tabs, handRenamed)),
    tabs: states,
    suggestion: null,
    chromeTabs: tabs as ChromeTabLike[],
  }
}

function armSettle(windowId: number, action: WaitAction): void {
  const existing = settleTimers.get(action.tabId)
  if (existing) clearTimeout(existing)
  if (action.readyAt === null) {
    settleTimers.delete(action.tabId)
    return
  }
  const delay = Math.max(0, action.readyAt - Date.now())
  settleTimers.set(
    action.tabId,
    setTimeout(() => {
      settleTimers.delete(action.tabId)
      void run(windowId, 'watch')
    }, delay),
  )
}

function filingActor(mode: 'watch' | 'sweep'): ActivityActor {
  return mode === 'sweep' ? 'sweep' : 'organizer'
}

async function recordActivity(draft: ActivityDraft): Promise<void> {
  try {
    await appendActivity(draft)
  } catch {
    // Activity is best-effort; never block filing on a log write.
  }
}

async function apply(
  windowId: number,
  actions: Action[],
  settings: Settings,
  domains: Map<number, string>,
  mode: 'watch' | 'sweep',
): Promise<void> {
  let failed = false
  const actor = filingActor(mode)
  for (const action of actions) {
    try {
      if (action.type === 'wait') armSettle(windowId, action)
      else if (action.type === 'retitle') {
        const oldTitle = groupTitles.get(action.groupId) ?? ''
        await retitleGroup(action, markGroup)
        await recordActivity({
          actor,
          action: 'group.rename',
          groupId: action.groupId,
          oldTitle,
          newTitle: action.title,
          groupTitle: action.title,
        })
      } else if (action.type === 'file') {
        const groupId = await fileTabs(windowId, action, markTabs, markGroup)
        for (const id of action.tabIds) {
          const domain = domains.get(id)
          if (domain) filed.set(id, domain)
          advisorPending.delete(id)
        }
        if (groupId != null) {
          const firstTabId = action.tabIds[0]
          if (action.create) {
            await recordActivity({
              actor,
              action: 'group.create',
              groupId,
              groupTitle: action.create.title,
              newTitle: action.create.title,
              tabId: firstTabId,
              siteKey: domains.get(firstTabId ?? -1),
              tabCount: action.tabIds.length,
            })
          } else {
            let groupTitle = groupTitles.get(groupId) ?? ''
            try {
              const group = await chrome.tabGroups.get(groupId)
              groupTitle = group.title ?? groupTitle
            } catch {
              // Group may have closed; keep the cached title.
            }
            await recordActivity({
              actor,
              action: 'tab.file',
              groupId,
              groupTitle,
              tabId: firstTabId,
              siteKey: domains.get(firstTabId ?? -1),
              tabCount: action.tabIds.length,
            })
          }
        }
      } else if (action.type === 'ask-advisor') queueAdvice(windowId, action, settings, mode)
    } catch {
      failed = true
    }
  }
  if (failed) throw new Error('Could not group this window.')
}

function queueAdvice(
  windowId: number,
  action: Extract<Action, { type: 'ask-advisor' }>,
  settings: Settings,
  origin: 'watch' | 'sweep',
): void {
  if (!settings.llmOn || !settings.model.trim()) {
    statusNote = settings.model.trim() ? OLLAMA_DOWN_MESSAGE : 'Choose a local model.'
    return
  }
  advisorPending.add(action.tabId)
  void enqueueAdvisor(async (signal) => {
    if (!llmOn) return null
    try {
      const content = await ollamaChat({
        model: settings.model.trim(),
        messages: advisorMessages(action.card, action.groups),
        signal,
      })
      if (!llmOn) return null
      const parsed = parseAdvisorContent(content)
      advisorPending.delete(action.tabId)
      if (!parsed) return null
      const fresh = await loadSettings()
      if (!fresh.llmOn || (origin === 'watch' && !fresh.organizerOn)) return null
      const built = await buildInput(windowId, fresh, 'watch', true)
      const { chromeTabs: _chromeTabs, ...input } = built
      input.organizerOn = true
      input.focused = true
      for (const tab of input.tabs) tab.candidate = tab.id === action.tabId
      input.suggestion = { tabId: action.tabId, title: parsed.title, confidence: parsed.confidence }
      const domains = new Map(input.tabs.map((tab) => [tab.id, tab.card.domain]))
      const next = decide(input).filter((item) => item.type !== 'ask-advisor')
      try {
        await apply(windowId, next, fresh, domains, 'watch')
      } catch {
        return null
      }
      return null
    } catch (error) {
      advisorPending.delete(action.tabId)
      if (!signal.aborted) statusNote = describeOllamaFailure(error)
      return null
    }
  }).catch(() => {})
}

async function focusedWindowId(): Promise<number> {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] })
    return win.id ?? chrome.windows.WINDOW_ID_NONE
  } catch {
    const win = await chrome.windows.getLastFocused()
    return win.id ?? chrome.windows.WINDOW_ID_NONE
  }
}

async function resolveSweepWindowId(requestedId: number): Promise<number> {
  const windows = await chrome.windows.getAll({ populate: false, windowTypes: ['normal'] })
  const tabsByWindow = new Map<number, ChromeTabLike[]>()
  await Promise.all(
    windows.map(async (win) => {
      if (win.id == null) return
      const tabs = await hydrateTabs(await chrome.tabs.query({ windowId: win.id }))
      tabsByWindow.set(win.id, tabs)
    }),
  )
  const picked = pickSweepWindowId(requestedId, windows, tabsByWindow)
  if (picked == null) throw new Error('This window has no tab strip to organize.')
  return picked
}

/** Counts-only sweep diag for client responses (no full URL samples). */
async function snapshotDiag(windowId: number): Promise<SweepDiag> {
  const queried = await hydrateTabs(await chrome.tabs.query({ windowId }))
  const byId = new Map(queried.flatMap((tab) => (tab.id == null ? [] : [[tab.id, tab as ChromeTabLike] as const])))
  const noneGroupId = chrome.tabGroups.TAB_GROUP_ID_NONE
  const states = queried.flatMap((tab) => {
    const state = tabStateFromChrome(tab, byId, {
      noneGroupId,
      stickyIds: sticky,
      candidateIds: candidates,
      filedDomains: filed,
      advisorPendingIds: advisorPending,
    })
    return state ? [state] : []
  })
  return buildSweepDiag(
    chrome.runtime.getManifest().version,
    windowId,
    queried,
    states,
    noneGroupId,
    { includeSamples: false },
  )
}

async function run(windowId: number, mode: 'watch' | 'sweep'): Promise<string> {
  const settings = await loadSettings()
  organizerOn = settings.organizerOn
  llmOn = settings.llmOn
  if (mode === 'watch' && !settings.organizerOn) return ''
  const focused = (await focusedWindowId()) === windowId
  if (mode === 'watch' && !focused) return ''
  const win = await chrome.windows.get(windowId)
  if (win.incognito) {
    if (mode === 'sweep') throw new Error('Incognito windows are skipped.')
    return ''
  }
  if (mode === 'sweep' && win.type !== undefined && win.type !== 'normal') {
    throw new Error('This window has no tab strip to organize.')
  }
  const built = await buildInput(windowId, settings, mode, mode === 'sweep' ? true : focused)
  const { chromeTabs, ...input } = built
  const domains = new Map(input.tabs.map((tab) => [tab.id, tab.card.domain]))
  const actions = decide(input)
  await apply(windowId, actions, settings, domains, mode)
  if (mode !== 'sweep') return ''
  if (sweepClaimsNothing(input.tabs, actions, input.groups)) {
    throw new Error('Could not group this window.')
  }
  return describeSweep(input.tabs, actions, chromeTabs)
}

function schedule(windowId: number): void {
  const existing = scheduled.get(windowId)
  if (existing) clearTimeout(existing)
  scheduled.set(
    windowId,
    setTimeout(() => {
      scheduled.delete(windowId)
      void run(windowId, 'watch').catch(() => {})
    }, 100),
  )
}

function statusLine(settings: Settings): string {
  const line = settings.organizerOn ? 'Auto-grouping in this window.' : 'Auto-group is off.'
  return statusNote ? `${line} ${statusNote}` : line
}

async function listModels(): Promise<ModelsResult> {
  try {
    const models = await listLocalModels(AbortSignal.timeout(5000))
    return { ok: true, permitted: true, models }
  } catch (error) {
    return { ok: false, permitted: true, models: [], message: describeOllamaFailure(error) }
  }
}

const PING_MESSAGES = [{ role: 'user' as const, content: 'Reply with JSON only: {"ok":true}' }]

async function testOllama(): Promise<TestOllamaResult> {
  const settings = await loadSettings()
  llmOn = settings.llmOn
  if (!settings.llmOn) return { ok: false, message: 'Turn on the local model.' }
  const model = settings.model.trim()
  if (!model) return { ok: false, message: 'Choose a local model.' }

  try {
    const available = await listLocalModels(AbortSignal.timeout(5000))
    if (!available.some((entry) => entry.name === model)) {
      return { ok: false, message: `Model "${model}" is not installed in Ollama.` }
    }
  } catch (error) {
    return { ok: false, message: describeOllamaFailure(error) }
  }

  const started = Date.now()
  try {
    const content = await enqueueAdvisor((signal) =>
      ollamaChat({ model, messages: PING_MESSAGES, signal }),
    )
    if (content === null) return { ok: false, message: 'Connection test was cancelled.' }
    const ms = Date.now() - started
    return {
      ok: true,
      message: `Connected. ${model} responded in ${(ms / 1000).toFixed(1)}s.`,
      ms,
    }
  } catch (error) {
    const message = describeOllamaFailure(error)
    if (/timed out/i.test(message)) {
      return {
        ok: false,
        message:
          'Ollama timed out while warming the model. Wait for it to finish loading, try again, or pick a smaller model.',
        ms: Date.now() - started,
      }
    }
    return { ok: false, message, ms: Date.now() - started }
  }
}

async function activeTabSnapshot(): Promise<StateResult['activeTab']> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (!tab?.id || tab.incognito) return null
    const settings = await loadSettings()
    const siteKey = siteKeyForCleanupTab(tab)
    const urlPattern = urlPatternForCleanupTab(tab)
    const protectedDomain = Boolean(siteKey && settings.protect.domains.includes(siteKey))
    const protectedUrl =
      Boolean(urlPattern) &&
      settings.protect.urlPatterns.some((pattern) => urlMatchesProtectPattern(urlPattern, pattern))
    return {
      id: tab.id,
      title: (tab.title || '').trim() || 'Untitled',
      siteKey,
      urlPattern,
      protectedDomain,
      protectedUrl,
    }
  } catch {
    return null
  }
}

async function syncCleanupAlarm(enabled: boolean): Promise<void> {
  const existing = await chrome.alarms.get(CLEANUP_ALARM_NAME)
  const action = cleanupAlarmAction(existing, enabled)
  if (action === 'keep') return
  if (existing) await chrome.alarms.clear(CLEANUP_ALARM_NAME)
  if (action === 'create') {
    await chrome.alarms.create(CLEANUP_ALARM_NAME, {
      delayInMinutes: CLEANUP_ALARM_PERIOD_MINUTES,
      periodInMinutes: CLEANUP_ALARM_PERIOD_MINUTES,
    })
  }
}

async function resolveCleanupWindowId(windowId?: number): Promise<number> {
  // Prefer the exact window the UI asked for (manual clean-up is this-window scoped).
  if (typeof windowId === 'number' && Number.isFinite(windowId) && windowId >= 0) {
    try {
      const win = await chrome.windows.get(windowId)
      if (!win.incognito && (win.type === undefined || win.type === 'normal') && win.id != null) {
        return win.id
      }
    } catch {
      // Fall through to last-focused.
    }
  }
  try {
    const focused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] })
    if (focused.id != null && !focused.incognito) return focused.id
  } catch {
    // Fall through.
  }
  return resolveSweepWindowId(chrome.windows.WINDOW_ID_NONE)
}

async function collectCleanupTabs(scope: 'window' | 'all', windowId?: number): Promise<chrome.tabs.Tab[]> {
  if (scope === 'window') {
    const id = await resolveCleanupWindowId(windowId)
    const win = await chrome.windows.get(id)
    if (win.incognito || (win.type !== undefined && win.type !== 'normal')) return []
    return chrome.tabs.query({ windowId: id })
  }

  const windows = await chrome.windows.getAll({ populate: false, windowTypes: ['normal'] })
  const tabs: chrome.tabs.Tab[] = []
  for (const win of windows) {
    if (win.incognito || win.id == null) continue
    const listed = await chrome.tabs.query({ windowId: win.id })
    tabs.push(...listed)
  }
  return tabs
}

async function previewCleanup(
  scope: 'window' | 'all' = 'window',
  windowId?: number,
): Promise<CleanupPreviewResult> {
  try {
    const settings = await loadSettings()
    const resolvedWindowId = scope === 'window' ? await resolveCleanupWindowId(windowId) : undefined
    const tabs = await collectCleanupTabs(scope, resolvedWindowId ?? windowId)
    const targets = selectCleanupTargets(tabs, {
      now: Date.now(),
      ageDays: settings.cleanupAgeDays,
      protect: settings.protect,
    })
    const sampleSiteKeys = [
      ...new Set(targets.map((row) => row.siteKey).filter((key): key is string => Boolean(key))),
    ].slice(0, 5)
    const age = formatCleanupAgeLabel(settings.cleanupAgeDays)
    const where = scope === 'window' ? 'this window' : 'all windows'
    const summary =
      targets.length === 0
        ? `No tabs in ${where} unused for ${age}.`
        : targets.length === 1
          ? `Close 1 tab in ${where} unused for ${age}?`
          : `Close ${targets.length} tabs in ${where} unused for ${age}?`
    return {
      ok: true,
      count: targets.length,
      ageDays: settings.cleanupAgeDays,
      scope,
      windowId: resolvedWindowId,
      tabIds: targets.map((row) => row.tabId),
      sampleSiteKeys,
      summary,
    }
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : 'Could not preview cleanup.'
    return { ok: false, message: text }
  }
}

async function runCleanup(options: {
  scope: 'window' | 'all'
  windowId?: number
  confirm?: boolean
  confirmedByAlarm?: boolean
  tabIds?: readonly number[]
}): Promise<CleanupRunResult> {
  if (!options.confirm && !options.confirmedByAlarm) {
    return { ok: false, message: 'Confirm before closing tabs.' }
  }
  if (!options.confirmedByAlarm && (!options.tabIds || options.tabIds.length === 0)) {
    return { ok: false, message: 'Preview clean-up before closing tabs.' }
  }

  const loaded = await loadSettings()
  if (options.confirmedByAlarm && !loaded.cleanupOn) {
    return { ok: true, closed: 0, skipped: 0, summary: 'Clean up old tabs is off.' }
  }
  const settings = await rebindProtectGroups()

  try {
    const tabs = await collectCleanupTabs(options.scope, options.windowId)
    const eligible = selectCleanupTargets(tabs, {
      now: Date.now(),
      ageDays: settings.cleanupAgeDays,
      protect: settings.protect,
    })
    const targets = options.confirmedByAlarm ? eligible : filterConfirmedTargets(eligible, options.tabIds ?? [])
    if (targets.length === 0) {
      return {
        ok: true,
        closed: 0,
        skipped: tabs.length,
        summary: `No tabs unused for ${formatCleanupAgeLabel(settings.cleanupAgeDays)}.`,
      }
    }

    const ids = targets.map((row) => row.tabId)
    await chrome.tabs.remove(ids)
    const closed = ids.length
    const age = formatCleanupAgeLabel(settings.cleanupAgeDays)
    const actor = options.confirmedByAlarm ? 'system' : 'user'
    await recordActivity({
      actor,
      action: 'tab.close',
      tabCount: closed,
      reason: `unused for ${age}`,
      siteKey: targets[0]?.siteKey,
    })
    const summary =
      closed === 1
        ? `Closed 1 old tab (unused for ${age}).`
        : `Closed ${closed} old tabs (unused for ${age}).`
    return { ok: true, closed, skipped: tabs.length - closed, summary }
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : 'Could not clean up tabs.'
    return { ok: false, message: text }
  }
}

async function saveProtect(
  mutate: (protect: ProtectLists) => ProtectLists | Promise<ProtectLists>,
  summary: string,
): Promise<ProtectUpdateResult> {
  const settings = await updateSettings(async (current) => ({
    ...current,
    protect: await mutate(current.protect),
  }))
  return { ok: true, protect: settings.protect, summary }
}

async function rebindProtectGroups(removed?: { id: number; title: string }): Promise<Settings> {
  const live = await liveGroupSnapshots()
  return updateSettings((current) => {
    let rebound = rebindGroupFingerprints(current.protect.groups, live)
    if (removed) {
      rebound = omitGroupBinding(
        rebound,
        removed.id,
        { id: removed.id, title: removed.title, color: '', patterns: [] },
        live,
      )
    }
    const liveIds = new Set(live.map((group) => group.id))
    const groupIds = [
      ...new Set([
        ...current.protect.groupIds.filter((id) => liveIds.has(id) && id !== removed?.id),
        ...boundGroupIds(rebound),
      ]),
    ]
    return {
      ...current,
      protect: {
        ...current.protect,
        groupIds,
        groups: rebound.map((row) => row.fingerprint),
      },
    }
  })
}

async function currentState(): Promise<StateResult> {
  const settings = await loadSettings()
  organizerOn = settings.organizerOn
  llmOn = settings.llmOn
  return {
    ...settings,
    status: statusLine(settings),
    retitle: retitleProgress,
    activeTab: await activeTabSnapshot(),
  }
}

async function previewRule(sentence: string): Promise<PreviewResult> {
  const settings = await loadSettings()
  const local = compileSentence(sentence)
  if (local) {
    const claimed = claimRule(settings.rules, { ...local, id: 'preview' })
    return { ok: true, confirmation: claimed.confirmation, domains: local.domains, title: local.title }
  }
  if (!settings.llmOn) return { ok: false, message: 'Turn on the local model to interpret this sentence.' }
  if (!settings.model.trim()) return { ok: false, message: 'Choose a local model.' }
  let content: string | null
  try {
    content = await enqueueAdvisor((signal) =>
      ollamaChat({ model: settings.model.trim(), messages: ruleMessages(sentence), signal }),
    )
  } catch (error) {
    return { ok: false, message: describeOllamaFailure(error) }
  }
  if (!content) return { ok: false, message: OLLAMA_DOWN_MESSAGE }
  const parsed = parseRuleContent(content)
  const domains = [...new Set((parsed?.domains ?? []).map((domain) => canonicalSite(domain)).filter((domain) => domain !== null))]
  if (!parsed || !isShortTitle(parsed.title) || domains.length === 0) {
    return { ok: false, message: "That sentence couldn't be matched to sites." }
  }
  const claimed = claimRule(settings.rules, {
    id: 'preview',
    sentence: sentence.trim(),
    domains,
    title: parsed.title.trim(),
  })
  return { ok: true, confirmation: claimed.confirmation, domains, title: parsed.title.trim() }
}

async function saveRule(sentence: string, _domains: string[], _title: string): Promise<PreviewResult & { rules?: Settings['rules'] }> {
  const local = compileSentence(sentence)
  let drafted = local
  if (!drafted) {
    const settings = await loadSettings()
    if (!settings.llmOn) return { ok: false, message: 'Turn on the local model to interpret this sentence.' }
    if (!settings.model.trim()) return { ok: false, message: 'Choose a local model.' }
    let content: string | null
    try {
      content = await enqueueAdvisor((signal) =>
        ollamaChat({ model: settings.model.trim(), messages: ruleMessages(sentence), signal }),
      )
    } catch (error) {
      return { ok: false, message: describeOllamaFailure(error) }
    }
    if (!content) return { ok: false, message: OLLAMA_DOWN_MESSAGE }
    drafted = ruleToSave(sentence, parseRuleContent(content))
  }
  if (!drafted) return { ok: false, message: "That sentence couldn't be matched to sites." }
  const incoming = { id: crypto.randomUUID(), ...drafted }
  const settings = await updateSettings((current) => {
    const claimed = claimRule(current.rules, incoming)
    return { ...current, rules: claimed.rules }
  })
  const claimed = claimRule(
    settings.rules.filter((rule) => rule.id !== incoming.id),
    incoming,
  )
  const [groups, tabs] = await Promise.all([chrome.tabGroups.query({}), chrome.tabs.query({})])
  for (const action of retitlesForSavedRule(incoming, groups.map((group) => groupStateFromChrome(group, tabs, handRenamed)))) {
    try {
      const oldTitle = groupTitles.get(action.groupId) ?? ''
      await retitleGroup(action, markGroup)
      await recordActivity({
        actor: 'rule',
        action: 'group.rename',
        groupId: action.groupId,
        oldTitle,
        newTitle: action.title,
        groupTitle: action.title,
        reason: incoming.sentence,
      })
    } catch {
      // A group can close between the query and the update.
    }
  }
  return { ok: true, confirmation: claimed.confirmation, domains: incoming.domains, title: incoming.title, rules: settings.rules }
}

async function handle(message: ToBackground): Promise<unknown> {
  if (message.type === 'get-state') return currentState()
  if (message.type === 'set-organizer') {
    settingsEpoch += 1
    organizerOn = message.on
    await updateSettings((current) => ({ ...current, organizerOn: message.on }))
    return currentState()
  }
  if (message.type === 'set-llm') {
    settingsEpoch += 1
    llmOn = message.on
    if (!message.on) {
      cancelAdvisor()
      advisorPending.clear()
      statusNote = ''
    }
    await updateSettings((current) => ({ ...current, llmOn: message.on }))
    return currentState()
  }
  if (message.type === 'set-model') {
    await updateSettings((current) => ({ ...current, model: message.model.trim() }))
    return currentState()
  }
  if (message.type === 'preview-rule') return previewRule(message.sentence)
  if (message.type === 'save-rule') return saveRule(message.sentence, message.domains, message.title)
  if (message.type === 'delete-rule') {
    await updateSettings((current) => ({ ...current, rules: deleteRule(current.rules, message.id) }))
    return currentState()
  }
  if (message.type === 'sweep') {
    let diag: SweepDiag | undefined
    try {
      const windowId = await resolveSweepWindowId(message.windowId)
      const win = await chrome.windows.get(windowId)
      if (win.incognito) {
        diag = await snapshotDiag(windowId).catch(() => undefined)
        return { ok: false, message: 'Incognito windows are skipped.', diag } satisfies SweepResult
      }
      if (win.type !== undefined && win.type !== 'normal') {
        diag = await snapshotDiag(windowId).catch(() => undefined)
        return { ok: false, message: 'This window has no tab strip to organize.', diag } satisfies SweepResult
      }
      const summary = await run(windowId, 'sweep')
      diag = await snapshotDiag(windowId).catch(() => undefined)
      return { ...(await currentState()), ok: true, summary, diag } satisfies SweepResult
    } catch (error) {
      const text = error instanceof Error && error.message ? error.message : 'Could not group this window.'
      if (!diag) {
        try {
          const fallbackId = await resolveSweepWindowId(message.windowId)
          diag = await snapshotDiag(fallbackId)
        } catch {
          try {
            diag = await snapshotDiag(message.windowId)
          } catch {
            diag = undefined
          }
        }
      }
      return { ok: false, message: text, diag } satisfies SweepResult
    }
  }
  if (message.type === 'list-models') return listModels()
  if (message.type === 'test-ollama') return testOllama()
  if (message.type === 'list-groups') return listGroups(message.windowId)
  if (message.type === 'update-group') {
    return updateGroup(message.groupId, {
      title: message.title,
      color: message.color,
      collapsed: message.collapsed,
    })
  }
  if (message.type === 'ungroup') return ungroupTabs(message.groupId)
  if (message.type === 'retitle-groups') return retitleGroups(message.windowId)
  if (message.type === 'get-activity') {
    const entries = await loadActivityLog()
    const filtered = message.filter
      ? filterActivityByFilter(entries, message.filter)
      : filterActivityByActor(entries, message.actor ?? 'all')
    const limit = message.limit && message.limit > 0 ? message.limit : filtered.length
    return { ok: true, entries: filtered.slice(0, limit) } satisfies ActivityLogResult
  }
  if (message.type === 'clear-activity') {
    await clearActivityLog()
    return { ok: true } satisfies ClearActivityResult
  }
  if (message.type === 'set-cleanup') {
    settingsEpoch += 1
    await updateSettings((current) => ({ ...current, cleanupOn: message.on }))
    await syncCleanupAlarm(message.on)
    return currentState()
  }
  if (message.type === 'set-cleanup-age') {
    await updateSettings((current) => ({ ...current, cleanupAgeDays: clampCleanupAgeDays(message.days) }))
    return currentState()
  }
  if (message.type === 'set-protect-domains') {
    await updateSettings((current) => ({
      ...current,
      protect: { ...current.protect, domains: normalizeProtectDomains(message.domains) },
    }))
    return currentState()
  }
  if (message.type === 'protect-group') {
    const fingerprint = message.protect ? await fingerprintForGroup(message.groupId) : null
    const live = await liveGroupSnapshots()
    const snapshot = live.find((group) => group.id === message.groupId)
    return saveProtect((protect) => {
      const set = new Set(protect.groupIds)
      if (message.protect) set.add(message.groupId)
      else set.delete(message.groupId)
      const rebound = omitGroupBinding(rebindGroupFingerprints(protect.groups, live), message.groupId, snapshot, live)
      if (message.protect && fingerprint) rebound.push({ id: message.groupId, fingerprint })
      const liveIds = new Set(live.map((group) => group.id))
      return {
        ...protect,
        groupIds: [...new Set([...[...set].filter((id) => liveIds.has(id)), ...boundGroupIds(rebound)])],
        groups: rebound.map((row) => row.fingerprint),
      }
    }, message.protect ? 'This group will not be auto-closed.' : 'This group can be auto-closed again.')
  }
  if (message.type === 'protect-domain') {
    const domain = normalizeProtectDomains([message.domain])[0]
    if (!domain) return { ok: false, message: 'Enter a site like github.com.' } satisfies ProtectUpdateResult
    return saveProtect((protect) => {
      const set = new Set(protect.domains)
      if (message.protect) set.add(domain)
      else set.delete(domain)
      return { ...protect, domains: [...set] }
    }, message.protect ? `Won’t auto-close ${domain}.` : `${domain} can be auto-closed again.`)
  }
  if (message.type === 'protect-url') {
    const pattern = normalizeUrlPattern(message.url)
    if (!pattern) return { ok: false, message: 'That page address could not be saved.' } satisfies ProtectUpdateResult
    return saveProtect((protect) => {
      const set = new Set(protect.urlPatterns)
      if (message.protect) set.add(pattern)
      else set.delete(pattern)
      return { ...protect, urlPatterns: [...set] }
    }, message.protect ? 'Won’t auto-close this page.' : 'This page can be auto-closed again.')
  }
  if (message.type === 'remove-protect-domain') {
    return saveProtect(
      (protect) => ({
        ...protect,
        domains: protect.domains.filter((domain) => domain !== message.domain),
      }),
      'Removed site protection.',
    )
  }
  if (message.type === 'remove-protect-group') {
    const live = await liveGroupSnapshots()
    const snapshot = live.find((group) => group.id === message.groupId)
    return saveProtect((protect) => {
      const rebound = omitGroupBinding(rebindGroupFingerprints(protect.groups, live), message.groupId, snapshot, live)
      return {
        ...protect,
        groupIds: protect.groupIds.filter((id) => id !== message.groupId),
        groups: rebound.map((row) => row.fingerprint),
      }
    }, 'Removed group protection.')
  }
  if (message.type === 'remove-protect-url') {
    const pattern = normalizeUrlPattern(message.url) ?? message.url
    return saveProtect(
      (protect) => ({
        ...protect,
        urlPatterns: protect.urlPatterns.filter((entry) => entry !== pattern),
      }),
      'Removed page protection.',
    )
  }
  if (message.type === 'preview-cleanup') {
    await rebindProtectGroups()
    return previewCleanup(message.scope ?? 'window', message.windowId)
  }
  if (message.type === 'run-cleanup') {
    return runCleanup({
      scope: message.scope ?? 'window',
      windowId: message.windowId,
      confirm: message.confirm === true,
      tabIds: message.tabIds,
    })
  }
  return { ok: false, message: 'Unknown message.' }
}

async function retitleGroups(requestedId: number): Promise<RetitleGroupsResult> {
  // Single-flight before model checks / window queries so popup+dashboard can't both enter.
  if (!retitleGate.tryEnter()) return { ok: false, message: 'A rename is already running.' }
  retitleProgress = null

  try {
    const settings = await loadSettings()
    llmOn = settings.llmOn
    if (!settings.llmOn) return { ok: false, message: 'Turn on the local model.' }
    if (!settings.model.trim()) return { ok: false, message: 'Choose a local model.' }

    const model = settings.model.trim()
    try {
      const available = await listLocalModels(AbortSignal.timeout(5000))
      if (!available.some((entry) => entry.name === model)) {
        return { ok: false, message: `Model "${model}" is not installed in Ollama.` }
      }
    } catch (error) {
      return { ok: false, message: describeOllamaFailure(error) }
    }

    let windowId: number
    try {
      windowId = await resolveSweepWindowId(requestedId)
    } catch (error) {
      const text = error instanceof Error && error.message ? error.message : 'Could not find a window to rename.'
      return { ok: false, message: text }
    }

    const [groups, queried] = await Promise.all([
      chrome.tabGroups.query({ windowId }),
      chrome.tabs.query({ windowId }),
    ])
    const tabs = await hydrateTabs(queried)
    const results: RetitleGroupResult[] = []
    let updated = 0
    let skipped = 0
    let failed = 0

    for (const group of groups) {
      if (group.shared === true) {
        skipped += 1
        results.push({
          groupId: group.id,
          oldTitle: group.title ?? '',
          status: 'skipped',
          reason: 'Shared',
        })
        await recordActivity({
          actor: 'ai',
          action: 'rename.skip',
          groupId: group.id,
          oldTitle: group.title ?? '',
          groupTitle: group.title ?? '',
          reason: 'Shared',
          model,
        })
      }
    }

    const targets = groups.filter((group) => group.shared !== true)
    if (targets.length === 0) {
      const summary =
        results.length === 0
          ? 'No groups to rename in this window.'
          : skipped === 1
            ? 'Skipped 1 shared group.'
            : `Skipped ${skipped} shared groups.`
      return { ok: true, updated: 0, skipped, failed: 0, summary, results }
    }

    retitleProgress = { current: 0, total: targets.length, results: [...results] }
    let cancelled = false

    for (let index = 0; index < targets.length; index += 1) {
      if (!llmOn) break
      const group = targets[index]!
      const currentTitle = (group.title ?? '').trim()
      retitleProgress = { current: index + 1, total: targets.length, results: [...results] }

      const memberCards = tabs
        .filter((tab) => tab.groupId === group.id)
        .map((tab) => buildFeatureCard({ url: resolveTabUrl(tab), title: tab.title || '' }))

      // Hand-renamed titles (e.g. "My PRs") skip AI and site-title force; reject still
      // guards any non-hand-renamed homogeneous site that reaches the model.
      const siteDecision = decideSiteRetitle(currentTitle, memberCards, {
        rules: settings.rules,
        handRenamed: handRenamed.has(group.id),
      })
      if (siteDecision.kind === 'skip') {
        skipped += 1
        results.push({
          groupId: group.id,
          oldTitle: currentTitle,
          status: 'skipped',
          reason: siteDecision.reason,
        })
        await recordActivity({
          actor: 'system',
          action: 'rename.skip',
          groupId: group.id,
          oldTitle: currentTitle,
          groupTitle: currentTitle,
          siteKey: siteDecision.domain || undefined,
          reason: siteDecision.reason,
          model,
        })
        retitleProgress = { current: index + 1, total: targets.length, results: [...results] }
        continue
      }

      if (siteDecision.kind === 'use-site') {
        if (titlesMatch(currentTitle, siteDecision.title)) {
          skipped += 1
          results.push({
            groupId: group.id,
            oldTitle: currentTitle,
            status: 'skipped',
            reason: 'already clear',
          })
          await recordActivity({
            actor: 'system',
            action: 'rename.skip',
            groupId: group.id,
            oldTitle: currentTitle,
            groupTitle: currentTitle,
            siteKey: siteDecision.domain,
            reason: 'already clear',
            model,
          })
          retitleProgress = { current: index + 1, total: targets.length, results: [...results] }
          continue
        }
        try {
          markGroup(group.id)
          await chrome.tabGroups.update(group.id, { title: siteDecision.title })
          updated += 1
          results.push({
            groupId: group.id,
            oldTitle: currentTitle,
            newTitle: siteDecision.title,
            status: 'renamed',
          })
          await recordActivity({
            actor: 'system',
            action: 'group.rename',
            groupId: group.id,
            oldTitle: currentTitle,
            newTitle: siteDecision.title,
            groupTitle: siteDecision.title,
            siteKey: siteDecision.domain,
            reason: siteDecision.reason,
            model,
          })
        } catch (error) {
          failed += 1
          const text = error instanceof Error && error.message ? error.message : 'Could not rename.'
          results.push({
            groupId: group.id,
            oldTitle: currentTitle,
            newTitle: siteDecision.title,
            status: 'failed',
            reason: text,
          })
          await recordActivity({
            actor: 'system',
            action: 'rename.skip',
            groupId: group.id,
            oldTitle: currentTitle,
            newTitle: siteDecision.title,
            groupTitle: currentTitle,
            siteKey: siteDecision.domain,
            reason: text,
            model,
          })
        }
        retitleProgress = { current: index + 1, total: targets.length, results: [...results] }
        continue
      }

      const payload = buildGroupRetitlePayload(group.title ?? '', memberCards)
      let content: string | null
      try {
        content = await enqueueAdvisor(
          (signal) => ollamaChat({ model, messages: retitleGroupMessages(payload), signal }),
          { timeoutMs: RETITLE_TIMEOUT_MS },
        )
      } catch (error) {
        if (!llmOn) break
        failed += 1
        const reason = describeOllamaFailure(error)
        results.push({
          groupId: group.id,
          oldTitle: currentTitle,
          status: 'failed',
          reason,
        })
        await recordActivity({
          actor: 'ai',
          action: 'rename.skip',
          groupId: group.id,
          oldTitle: currentTitle,
          groupTitle: currentTitle,
          reason,
          model,
        })
        retitleProgress = { current: index + 1, total: targets.length, results: [...results] }
        continue
      }

      if (!llmOn) break
      if (!content) {
        cancelled = true
        failed += 1
        results.push({
          groupId: group.id,
          oldTitle: currentTitle,
          status: 'failed',
          reason: 'Cancelled',
        })
        break
      }

      const parsed = parseRetitleContent(content)
      if (
        !parsed ||
        parsed.title === '' ||
        parsed.confidence < ADVISOR_CONFIDENCE ||
        !isShortTitle(parsed.title)
      ) {
        skipped += 1
        results.push({
          groupId: group.id,
          oldTitle: currentTitle,
          status: 'skipped',
          reason: 'Low confidence',
        })
        await recordActivity({
          actor: 'ai',
          action: 'rename.skip',
          groupId: group.id,
          oldTitle: currentTitle,
          groupTitle: currentTitle,
          reason: 'Low confidence',
          model,
        })
        retitleProgress = { current: index + 1, total: targets.length, results: [...results] }
        continue
      }
      if (titlesMatch(parsed.title, currentTitle)) {
        skipped += 1
        results.push({
          groupId: group.id,
          oldTitle: currentTitle,
          status: 'skipped',
          reason: 'already clear',
        })
        await recordActivity({
          actor: 'ai',
          action: 'rename.skip',
          groupId: group.id,
          oldTitle: currentTitle,
          groupTitle: currentTitle,
          reason: 'already clear',
          model,
        })
        retitleProgress = { current: index + 1, total: targets.length, results: [...results] }
        continue
      }

      const rejected = rejectRetitleSuggestion(currentTitle, parsed.title, memberCards, {
        rules: settings.rules,
      })
      if (rejected) {
        skipped += 1
        results.push({
          groupId: group.id,
          oldTitle: currentTitle,
          status: 'skipped',
          reason: rejected,
        })
        await recordActivity({
          actor: 'ai',
          action: 'rename.skip',
          groupId: group.id,
          oldTitle: currentTitle,
          newTitle: parsed.title,
          groupTitle: currentTitle,
          reason: rejected,
          model,
        })
        retitleProgress = { current: index + 1, total: targets.length, results: [...results] }
        continue
      }

      try {
        markGroup(group.id)
        await chrome.tabGroups.update(group.id, { title: parsed.title })
        updated += 1
        results.push({
          groupId: group.id,
          oldTitle: currentTitle,
          newTitle: parsed.title,
          status: 'renamed',
        })
        await recordActivity({
          actor: 'ai',
          action: 'group.rename',
          groupId: group.id,
          oldTitle: currentTitle,
          newTitle: parsed.title,
          groupTitle: parsed.title,
          model,
        })
      } catch (error) {
        failed += 1
        const text = error instanceof Error && error.message ? error.message : 'Could not rename.'
        results.push({
          groupId: group.id,
          oldTitle: currentTitle,
          newTitle: parsed.title,
          status: 'failed',
          reason: text,
        })
        await recordActivity({
          actor: 'ai',
          action: 'rename.skip',
          groupId: group.id,
          oldTitle: currentTitle,
          newTitle: parsed.title,
          groupTitle: currentTitle,
          reason: text,
          model,
        })
      }
      retitleProgress = { current: index + 1, total: targets.length, results: [...results] }
    }

    const aiSkipped = results.filter((r) => r.status === 'skipped' && r.reason !== 'Shared').length
    if ((!llmOn || cancelled) && updated === 0 && aiSkipped === 0 && failed <= 1) {
      return { ok: false, message: 'Rename cancelled.' }
    }

    const order = new Map(groups.map((group, index) => [group.id, index]))
    results.sort((left, right) => (order.get(left.groupId) ?? 0) - (order.get(right.groupId) ?? 0))

    const parts = [`Renamed ${updated}`]
    if (skipped > 0) parts.push(`skipped ${skipped}`)
    if (failed > 0) parts.push(`failed ${failed}`)
    return {
      ok: true,
      updated,
      skipped,
      failed,
      summary: `${parts.join(', ')}.`,
      results,
    }
  } finally {
    retitleGate.exit()
    // Keep the last progress snapshot until after this turn so concurrent get-state
    // polls don't blank the UI before the final message payload paints.
    queueMicrotask(() => {
      if (!retitleGate.running) retitleProgress = null
    })
  }
}

async function listGroups(requestedId: number): Promise<ListGroupsResult> {
  try {
    const windowId = await resolveSweepWindowId(requestedId)
    const [groups, tabs, settings] = await Promise.all([
      chrome.tabGroups.query({ windowId }),
      chrome.tabs.query({ windowId }),
      loadSettings(),
    ])
    const protectedIds = new Set(settings.protect.groupIds)
    const views = tabGroupViewsFromChrome(groups, tabs).map((group) => ({
      ...group,
      cleanupProtected: protectedIds.has(group.id),
    }))
    return { ok: true, windowId, groups: views }
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : 'Could not list groups.'
    return { ok: false, message: text }
  }
}

async function updateGroup(
  groupId: number,
  patch: { title?: string; color?: string; collapsed?: boolean },
): Promise<UpdateGroupResult> {
  try {
    const existing = await chrome.tabGroups.get(groupId)
    if (existing.shared) return { ok: false, message: 'Shared groups can’t be edited here.' }
    const update: chrome.tabGroups.UpdateProperties = {}
    if (patch.title !== undefined) update.title = patch.title
    if (patch.color !== undefined) {
      if (!isChromeColor(patch.color)) return { ok: false, message: 'That color isn’t supported.' }
      update.color = patch.color
    }
    if (patch.collapsed !== undefined) update.collapsed = patch.collapsed
    if (Object.keys(update).length === 0) {
      const tabs = await chrome.tabs.query({ windowId: existing.windowId })
      return { ok: true, group: tabGroupViewFromChrome(existing, tabs) }
    }
    const oldTitle = existing.title ?? ''
    const oldColor = existing.color
    markGroup(groupId)
    const updated = (await chrome.tabGroups.update(groupId, update)) ?? (await chrome.tabGroups.get(groupId))
    if (patch.title !== undefined && patch.title !== oldTitle) {
      // markGroup suppresses onUpdated hand-rename detection — record it here.
      await rememberHandRenamed(groupId)
      await recordActivity({
        actor: 'user',
        action: 'group.rename',
        groupId,
        oldTitle,
        newTitle: updated.title ?? patch.title,
        groupTitle: updated.title ?? patch.title,
      })
    }
    if (patch.color !== undefined && patch.color !== oldColor) {
      await recordActivity({
        actor: 'user',
        action: 'group.recolor',
        groupId,
        groupTitle: updated.title ?? oldTitle,
        color: patch.color,
      })
    }
    const tabs = await chrome.tabs.query({ windowId: updated.windowId })
    return { ok: true, group: tabGroupViewFromChrome(updated, tabs) }
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : 'Could not update that group.'
    return { ok: false, message: text }
  }
}

async function ungroupTabs(groupId: number): Promise<UngroupResult> {
  try {
    const existing = await chrome.tabGroups.get(groupId)
    if (existing.shared) return { ok: false, message: 'Shared groups can’t be deleted here.' }
    const tabs = await chrome.tabs.query({ groupId })
    const ids = tabs.flatMap((tab) => (tab.id == null ? [] : [tab.id]))
    const first = ids[0]
    if (first === undefined) return { ok: true }
    const tabIds: [number, ...number[]] = [first, ...ids.slice(1)]
    const title = existing.title ?? ''
    markTabs(tabIds)
    await chrome.tabs.ungroup(tabIds)
    await recordActivity({
      actor: 'user',
      action: 'group.ungroup',
      groupId,
      groupTitle: title,
      oldTitle: title,
      tabCount: tabIds.length,
    })
    return { ok: true }
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : 'Could not ungroup those tabs.'
    return { ok: false, message: text }
  }
}

chrome.runtime.onMessage.addListener((message: ToBackground, sender, sendResponse) => {
  // Ignore external extensions; only our own extension pages may message us.
  if (sender.id !== chrome.runtime.id) return false
  void (async () => {
    try {
      sendResponse(await handle(message))
    } catch {
      sendResponse({ ok: false, message: 'Something went wrong.' })
    }
  })()
  return true
})

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.incognito || tab.id == null || tab.windowId == null) return
  if (organizerOn) candidates.add(tab.id)
  schedule(tab.windowId)
})

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (tab.incognito || tab.windowId == null) return
  // Chrome often includes groupId on an ordinary load. That is not a drag.
  if (change.url || change.title) {
    if (organizerOn) candidates.add(tabId)
    const previous = filed.get(tabId)
    if (change.url && previous) {
      const domain = buildFeatureCard({ url: change.url, title: tab.title || '' }).domain
      if (domain && domain !== previous) filed.delete(tabId)
    }
  }
  if (change.url || change.title || change.status) schedule(tab.windowId)
})

chrome.tabs.onMoved.addListener((tabId, move) => {
  if (marksSticky('moved', ownTabs.has(tabId))) sticky.add(tabId)
  if (organizerOn) schedule(move.windowId)
})

chrome.tabs.onRemoved.addListener((tabId) => {
  sticky.delete(tabId)
  candidates.delete(tabId)
  filed.delete(tabId)
  advisorPending.delete(tabId)
  stability.delete(tabId)
  const timer = settleTimers.get(tabId)
  if (timer) clearTimeout(timer)
  settleTimers.delete(tabId)
})

chrome.tabGroups.onUpdated.addListener((group) => {
  const title = group.title ?? ''
  const previous = groupTitles.get(group.id)
  groupTitles.set(group.id, title)
  if (ownGroups.has(group.id)) {
    ownGroups.delete(group.id)
    return
  }
  if (previous !== undefined && previous !== title) void rememberHandRenamed(group.id)
})

chrome.tabGroups.onRemoved.addListener((group) => {
  const title = groupTitles.get(group.id) ?? ''
  void forgetHandRenamed(group.id, title)
  groupTitles.delete(group.id)
  void rebindProtectGroups({ id: group.id, title }).catch(() => {})
})

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE || !organizerOn) return
  void run(windowId, 'watch').catch(() => {})
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (changes.organizerOn || changes.llmOn || changes.cleanupOn) settingsEpoch += 1
  if (changes.organizerOn) organizerOn = changes.organizerOn.newValue === true
  if (changes.llmOn) {
    llmOn = changes.llmOn.newValue === true
    if (!llmOn) {
      cancelAdvisor()
      advisorPending.clear()
    }
  }
  if (changes.cleanupOn) {
    void syncCleanupAlarm(changes.cleanupOn.newValue === true)
  }
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== CLEANUP_ALARM_NAME) return
  void runCleanup({ scope: 'all', confirmedByAlarm: true }).catch(() => {})
})

async function boot(): Promise<void> {
  const epoch = settingsEpoch
  const settings = await loadSettings()
  if (epoch === settingsEpoch) {
    organizerOn = settings.organizerOn
    llmOn = settings.llmOn
  }
  await syncCleanupAlarm(settings.cleanupOn)
  const groups = await chrome.tabGroups.query({})
  for (const group of groups) {
    if (!groupTitles.has(group.id)) groupTitles.set(group.id, group.title ?? '')
  }
  const live = await liveGroupSnapshots()
  applyHandRenamedIds(await restoreHandRenamedGroups(live))
  await rebindProtectGroups()
}

void boot()
