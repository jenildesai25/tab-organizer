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
import type { CompiledRule } from './domain/types.js'

export type Settings = {
  organizerOn: boolean
  llmOn: boolean
  model: string
  rules: CompiledRule[]
}

export const DEFAULT_SETTINGS: Settings = {
  organizerOn: false,
  llmOn: false,
  model: '',
  rules: [],
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS)
  return {
    organizerOn: stored.organizerOn === true,
    llmOn: stored.llmOn === true,
    model: typeof stored.model === 'string' ? stored.model : '',
    rules: Array.isArray(stored.rules) ? (stored.rules as CompiledRule[]) : [],
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
