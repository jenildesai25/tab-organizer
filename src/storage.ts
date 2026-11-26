import {
  ACTIVITY_LOG_KEY,
  appendActivityEntry,
  parseStoredActivityLog,
  type ActivityDraft,
  type ActivityEntry,
} from './domain/activity-log.js'
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

/** Single write path for activity entries (newest first ring buffer). */
export async function appendActivity(draft: ActivityDraft): Promise<ActivityEntry[]> {
  const existing = await loadActivityLog()
  const next = appendActivityEntry(existing, draft)
  await chrome.storage.local.set({ [ACTIVITY_LOG_KEY]: next })
  return next
}

export async function clearActivityLog(): Promise<void> {
  await chrome.storage.local.set({ [ACTIVITY_LOG_KEY]: [] })
}
