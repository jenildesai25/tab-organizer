import {
  ACTIVITY_LOG_KEY,
  appendActivityEntry,
  parseStoredActivityLog,
  type ActivityDraft,
  type ActivityEntry,
} from './domain/activity-log.js'
import { createAsyncMutex } from './domain/concurrency.js'
import {
  HAND_RENAMED_KEY,
  parseHandRenamedIds,
  pruneHandRenamedIds,
} from './domain/hand-renamed.js'
import {
  DEFAULT_CLEANUP_AGE_DAYS,
  clampCleanupAgeDays,
  parseProtectLists,
  pruneProtectGroupIds,
  type ProtectLists,
} from './domain/tab-cleanup.js'
import type { CompiledRule } from './domain/types.js'

export type Settings = {
  organizerOn: boolean
  llmOn: boolean
  model: string
  rules: CompiledRule[]
  /**
   * When true, periodically close http(s) tabs unused longer than cleanupAgeDays.
   * Default off. Auto scope: all normal windows. Manual: this window.
   */
  cleanupOn: boolean
  /** Days since lastAccessed before a tab may be closed. */
  cleanupAgeDays: number
  /** Sites, groups, and pages that must never be auto-closed. */
  protect: ProtectLists
}

export const DEFAULT_SETTINGS: Settings = {
  organizerOn: false,
  llmOn: false,
  model: '',
  rules: [],
  cleanupOn: false,
  cleanupAgeDays: DEFAULT_CLEANUP_AGE_DAYS,
  protect: { domains: [], groupIds: [], urlPatterns: [] },
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS)
  const legacyDomains =
    Array.isArray((stored as { neverDomains?: unknown }).neverDomains)
      ? (stored as { neverDomains: unknown }).neverDomains
      : undefined
  const protectRaw =
    stored.protect && typeof stored.protect === 'object'
      ? (stored.protect as Record<string, unknown>)
      : {}
  return {
    organizerOn: stored.organizerOn === true,
    llmOn: stored.llmOn === true,
    model: typeof stored.model === 'string' ? stored.model : '',
    rules: Array.isArray(stored.rules) ? (stored.rules as CompiledRule[]) : [],
    cleanupOn: stored.cleanupOn === true,
    cleanupAgeDays: clampCleanupAgeDays(stored.cleanupAgeDays),
    protect: parseProtectLists({
      domains: protectRaw.domains ?? legacyDomains,
      groupIds: protectRaw.groupIds,
      urlPatterns: protectRaw.urlPatterns,
    }),
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set(settings)
}

export async function loadActivityLog(): Promise<ActivityEntry[]> {
  const stored = await chrome.storage.local.get(ACTIVITY_LOG_KEY)
  return parseStoredActivityLog(stored[ACTIVITY_LOG_KEY])
}

const activityMutex = createAsyncMutex()

/** Single write path for activity entries (newest first ring buffer), serialized. */
export async function appendActivity(draft: ActivityDraft): Promise<ActivityEntry[]> {
  return activityMutex.run(async () => {
    const existing = await loadActivityLog()
    const next = appendActivityEntry(existing, draft)
    await chrome.storage.local.set({ [ACTIVITY_LOG_KEY]: next })
    return next
  })
}

export async function clearActivityLog(): Promise<void> {
  await activityMutex.run(async () => {
    await chrome.storage.local.set({ [ACTIVITY_LOG_KEY]: [] })
  })
}

export async function loadHandRenamedIds(): Promise<number[]> {
  const stored = await chrome.storage.local.get(HAND_RENAMED_KEY)
  return parseHandRenamedIds(stored[HAND_RENAMED_KEY])
}

export async function saveHandRenamedIds(ids: Iterable<number>): Promise<void> {
  await chrome.storage.local.set({ [HAND_RENAMED_KEY]: [...ids] })
}

/** Load persisted hand-renames and drop IDs for groups that no longer exist. */
export async function restoreHandRenamedIds(liveGroupIds: ReadonlySet<number>): Promise<number[]> {
  const stored = await loadHandRenamedIds()
  const pruned = pruneHandRenamedIds(stored, liveGroupIds)
  if (pruned.length !== stored.length) await saveHandRenamedIds(pruned)
  return pruned
}

/** Drop protect group IDs that no longer exist; persist when changed. */
export async function pruneProtectGroups(liveGroupIds: ReadonlySet<number>): Promise<ProtectLists> {
  const settings = await loadSettings()
  const pruned = pruneProtectGroupIds(settings.protect.groupIds, liveGroupIds)
  if (pruned.length === settings.protect.groupIds.length) return settings.protect
  const protect = { ...settings.protect, groupIds: pruned }
  await saveSettings({ ...settings, protect })
  return protect
}
