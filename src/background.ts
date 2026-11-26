import { fileTabs, retitleGroup } from './apply.js'
import { cancelAdvisor, enqueueAdvisor } from './advisor.js'
import { extractEmbeddedHttpUrl, resolveTabUrl, type ChromeTabLike } from './domain/chrome-tab.js'
import { decide } from './domain/decider.js'
import { buildFeatureCard, isHttpUrl, titleIsUsable } from './domain/feature-card.js'
import { advisorMessages, parseAdvisorContent, parseRuleContent, ruleMessages } from './domain/prompts.js'
import { claimRule, compileSentence, deleteRule, retitlesForSavedRule } from './domain/rules.js'
import { canonicalSite } from './domain/sites.js'
import { groupStateFromChrome, tabStateFromChrome } from './domain/sweep-chrome.js'
import { buildSweepDiag, type SweepDiag } from './domain/sweep-diag.js'
import { pickSweepWindowId } from './domain/sweep-window.js'
import type { Action, DecideInput, WaitAction } from './domain/types.js'
import { isShortTitle } from './domain/words.js'
import { marksSticky } from './domain/stickiness.js'
import { describeSweep, sweepClaimsNothing } from './domain/summary.js'
import { listLocalModels, ollamaChat } from './ollama.js'
import type { ModelsResult, PreviewResult, StateResult, SweepResult, ToBackground } from './protocol.js'
import { loadSettings, saveSettings, type Settings } from './storage.js'

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

let organizerOn = false
let llmOn = false
let statusNote = ''
let settingsEpoch = 0

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

async function apply(
  windowId: number,
  actions: Action[],
  settings: Settings,
  domains: Map<number, string>,
  mode: 'watch' | 'sweep',
): Promise<void> {
  let failed = false
  for (const action of actions) {
    try {
      if (action.type === 'wait') armSettle(windowId, action)
      else if (action.type === 'retitle') await retitleGroup(action, markGroup)
      else if (action.type === 'file') {
        await fileTabs(windowId, action, markTabs, markGroup)
        for (const id of action.tabIds) {
          const domain = domains.get(id)
          if (domain) filed.set(id, domain)
          advisorPending.delete(id)
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
    statusNote = settings.model.trim() ? "Ollama isn't running." : 'Choose a local model.'
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
    } catch {
      advisorPending.delete(action.tabId)
      if (!signal.aborted) statusNote = "Ollama isn't running."
      return null
    }
  })
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

/** Sample live Chrome tab fields for smoke tests / Organize debugging. */
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
  const line = settings.organizerOn ? 'Watching the focused window.' : 'Organizer is off.'
  return statusNote ? `${line} ${statusNote}` : line
}

async function listModels(): Promise<ModelsResult> {
  try {
    const models = await listLocalModels(AbortSignal.timeout(2000))
    return { ok: true, permitted: true, models }
  } catch {
    return { ok: false, permitted: true, models: [], message: "Ollama isn't running." }
  }
}

async function currentState(): Promise<StateResult> {
  const settings = await loadSettings()
  organizerOn = settings.organizerOn
  llmOn = settings.llmOn
  return { ...settings, status: statusLine(settings) }
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
  const content = await enqueueAdvisor((signal) =>
    ollamaChat({ model: settings.model.trim(), messages: ruleMessages(sentence), signal }),
  )
  if (!content) return { ok: false, message: "Ollama isn't running." }
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

async function saveRule(sentence: string, domains: string[], title: string): Promise<PreviewResult & { rules?: Settings['rules'] }> {
  const canonical = [...new Set(domains.map((domain) => canonicalSite(domain)).filter((domain) => domain !== null))]
  if (!isShortTitle(title) || canonical.length === 0) {
    return { ok: false, message: "That sentence couldn't be matched to sites." }
  }
  const settings = await loadSettings()
  const incoming = { id: crypto.randomUUID(), sentence: sentence.trim(), domains: canonical, title: title.trim() }
  const claimed = claimRule(settings.rules, incoming)
  await saveSettings({ ...settings, rules: claimed.rules })
  const [groups, tabs] = await Promise.all([chrome.tabGroups.query({}), chrome.tabs.query({})])
  for (const action of retitlesForSavedRule(incoming, groups.map((group) => groupStateFromChrome(group, tabs, handRenamed)))) {
    try {
      await retitleGroup(action, markGroup)
    } catch {
      // A group can close between the query and the update.
    }
  }
  return { ok: true, confirmation: claimed.confirmation, domains: canonical, title: incoming.title, rules: claimed.rules }
}

async function handle(message: ToBackground): Promise<unknown> {
  if (message.type === 'get-state') return currentState()
  if (message.type === 'set-organizer') {
    settingsEpoch += 1
    const settings = await loadSettings()
    organizerOn = message.on
    await saveSettings({ ...settings, organizerOn: message.on })
    return currentState()
  }
  if (message.type === 'set-llm') {
    settingsEpoch += 1
    const settings = await loadSettings()
    llmOn = message.on
    if (!message.on) {
      cancelAdvisor()
      advisorPending.clear()
      statusNote = ''
    }
    await saveSettings({ ...settings, llmOn: message.on })
    return currentState()
  }
  if (message.type === 'set-model') {
    const settings = await loadSettings()
    await saveSettings({ ...settings, model: message.model.trim() })
    return currentState()
  }
  if (message.type === 'preview-rule') return previewRule(message.sentence)
  if (message.type === 'save-rule') return saveRule(message.sentence, message.domains, message.title)
  if (message.type === 'delete-rule') {
    const settings = await loadSettings()
    const rules = deleteRule(settings.rules, message.id)
    await saveSettings({ ...settings, rules })
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
  return { ok: false, message: 'Unknown message.' }
}

chrome.runtime.onMessage.addListener((message: ToBackground, _sender, sendResponse) => {
  void handle(message).then(sendResponse, () => sendResponse({ ok: false, message: 'Something went wrong.' }))
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
  if (previous !== undefined && previous !== title) handRenamed.add(group.id)
})

chrome.tabGroups.onRemoved.addListener((group) => {
  handRenamed.delete(group.id)
  groupTitles.delete(group.id)
})

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE || !organizerOn) return
  void run(windowId, 'watch').catch(() => {})
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (changes.organizerOn || changes.llmOn) settingsEpoch += 1
  if (changes.organizerOn) organizerOn = changes.organizerOn.newValue === true
  if (changes.llmOn) {
    llmOn = changes.llmOn.newValue === true
    if (!llmOn) {
      cancelAdvisor()
      advisorPending.clear()
    }
  }
})

async function boot(): Promise<void> {
  const epoch = settingsEpoch
  const settings = await loadSettings()
  if (epoch === settingsEpoch) {
    organizerOn = settings.organizerOn
    llmOn = settings.llmOn
  }
  const groups = await chrome.tabGroups.query({})
  for (const group of groups) {
    if (!groupTitles.has(group.id)) groupTitles.set(group.id, group.title ?? '')
  }
}

void boot()
