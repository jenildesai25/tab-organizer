import {
  ACTIVITY_LOG_KEY,
  appendActivityEntry,
  parseStoredActivityLog,
  type ActivityDraft,
  type ActivityEntry,
} from './domain/activity-log.js'
import { createAsyncMutex } from './domain/concurrency.js'
import {
  boundGroupIds,
  omitGroupBinding,
  parseGroupFingerprints,
  rebindGroupFingerprints,
  type GroupFingerprint,
  type LiveGroupSnapshot,
} from './domain/group-identity.js'
import {
  HAND_RENAMED_KEY,
  parseHandRenamedIds,
  pruneHandRenamedIds,
} from './domain/hand-renamed.js'
import {
  CLEANUP_UNDO_KEY,
  cleanupUndoIsLive,
  parseCleanupUndoSnapshot,
  type CleanupUndoSnapshot,
} from './domain/cleanup-undo.js'
import {
  WORKSPACE_LAYOUTS_KEY,
  deleteWorkspaceLayout,
  parseWorkspaceLayouts,
  upsertWorkspaceLayout,
  type WorkspaceLayout,
} from './domain/workspace-layout.js'
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
  protect: { domains: [], groupIds: [], urlPatterns: [], groups: [] },
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
    protect: {
      ...parseProtectLists({
        domains: protectRaw.domains ?? legacyDomains,
        groupIds: protectRaw.groupIds,
        urlPatterns: protectRaw.urlPatterns,
      }),
      groups: parseGroupFingerprints(protectRaw.groups),
    },
  }
}

const settingsMutex = createAsyncMutex()

async function writeSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set(settings)
}

/** Serialize load → mutate → save so popup and dashboard cannot drop each other's writes. */
export async function updateSettings(
  mutate: (settings: Settings) => Settings | Promise<Settings>,
): Promise<Settings> {
  return settingsMutex.run(async () => {
    const current = await loadSettings()
    const next = await mutate(current)
    await writeSettings(next)
    return next
  })
}

export async function saveSettings(settings: Settings): Promise<void> {
  await settingsMutex.run(async () => {
    await writeSettings(settings)
  })
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

const HAND_RENAMED_FINGERPRINTS_KEY = 'handRenamedGroups'
const handRenamedMutex = createAsyncMutex()

export async function loadHandRenamedFingerprints(): Promise<GroupFingerprint[]> {
  const stored = await chrome.storage.local.get(HAND_RENAMED_FINGERPRINTS_KEY)
  return parseGroupFingerprints(stored[HAND_RENAMED_FINGERPRINTS_KEY])
}

async function writeHandRenamed(ids: Iterable<number>, fingerprints: readonly GroupFingerprint[]): Promise<void> {
  await chrome.storage.local.set({
    [HAND_RENAMED_KEY]: [...ids],
    [HAND_RENAMED_FINGERPRINTS_KEY]: fingerprints,
  })
}

/** Remember a hand-renamed group by session id and by a restart-stable fingerprint. */
export async function rememberHandRenamedGroup(
  groupId: number,
  fingerprint: GroupFingerprint | null,
  live: readonly LiveGroupSnapshot[],
): Promise<number[]> {
  return handRenamedMutex.run(async () => {
    const storedIds = await loadHandRenamedIds()
    const fingerprints = await loadHandRenamedFingerprints()
    const snapshot = live.find((group) => group.id === groupId)
    const rebound = omitGroupBinding(rebindGroupFingerprints(fingerprints, live), groupId, snapshot, live)
    if (fingerprint) rebound.push({ id: groupId, fingerprint })
    const liveIds = new Set(live.map((group) => group.id))
    const ids = uniqueIds([
      ...storedIds.filter((id) => liveIds.has(id)),
      groupId,
      ...boundGroupIds(rebound),
    ])
    await writeHandRenamed(ids, rebound.map((row) => row.fingerprint))
    return ids
  })
}

/** Drop a hand-renamed group after Chrome removes it. */
export async function forgetHandRenamedGroup(
  groupId: number,
  live: readonly LiveGroupSnapshot[],
  title = '',
): Promise<number[]> {
  return handRenamedMutex.run(async () => {
    const storedIds = await loadHandRenamedIds()
    const fingerprints = await loadHandRenamedFingerprints()
    const snapshot = live.find((group) => group.id === groupId) ?? {
      id: groupId,
      title,
      color: '',
      patterns: [],
    }
    const rebound = omitGroupBinding(rebindGroupFingerprints(fingerprints, live), groupId, snapshot, live)
    const ids = uniqueIds([
      ...storedIds.filter((id) => id !== groupId && live.some((group) => group.id === id)),
      ...boundGroupIds(rebound),
    ])
    await writeHandRenamed(ids, rebound.map((row) => row.fingerprint))
    return ids
  })
}

/** Reattach hand-renamed groups after a worker or browser restart. */
export async function restoreHandRenamedGroups(live: readonly LiveGroupSnapshot[]): Promise<number[]> {
  return handRenamedMutex.run(async () => {
    const storedIds = await loadHandRenamedIds()
    const fingerprints = await loadHandRenamedFingerprints()
    const rebound = rebindGroupFingerprints(fingerprints, live)
    const liveIds = new Set(live.map((group) => group.id))
    const ids = uniqueIds([...storedIds.filter((id) => liveIds.has(id)), ...boundGroupIds(rebound)])
    await writeHandRenamed(ids, rebound.map((row) => row.fingerprint))
    return ids
  })
}

function uniqueIds(ids: readonly number[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const id of ids) {
    if (!Number.isInteger(id) || id < 0 || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
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

async function undoStore(): Promise<typeof chrome.storage.session | typeof chrome.storage.local> {
  try {
    if (chrome.storage.session) return chrome.storage.session
  } catch {
    // Fall through to local.
  }
  return chrome.storage.local
}

/** Session-first undo payload so full URLs are not kept in durable settings. */
export async function loadCleanupUndo(now = Date.now()): Promise<CleanupUndoSnapshot | null> {
  const store = await undoStore()
  const stored = await store.get(CLEANUP_UNDO_KEY)
  const snapshot = parseCleanupUndoSnapshot(stored[CLEANUP_UNDO_KEY])
  if (!cleanupUndoIsLive(snapshot, now)) {
    if (snapshot) await clearCleanupUndo()
    return null
  }
  return snapshot
}

export async function saveCleanupUndo(snapshot: CleanupUndoSnapshot): Promise<void> {
  const store = await undoStore()
  await store.set({ [CLEANUP_UNDO_KEY]: snapshot })
}

export async function clearCleanupUndo(): Promise<void> {
  const store = await undoStore()
  await store.remove(CLEANUP_UNDO_KEY)
}

const layoutsMutex = createAsyncMutex()

export async function loadWorkspaceLayouts(): Promise<WorkspaceLayout[]> {
  const stored = await chrome.storage.local.get(WORKSPACE_LAYOUTS_KEY)
  return parseWorkspaceLayouts(stored[WORKSPACE_LAYOUTS_KEY])
}

export async function saveWorkspaceLayout(layout: WorkspaceLayout): Promise<WorkspaceLayout[]> {
  return layoutsMutex.run(async () => {
    const existing = await loadWorkspaceLayouts()
    const next = upsertWorkspaceLayout(existing, layout)
    await chrome.storage.local.set({ [WORKSPACE_LAYOUTS_KEY]: next })
    return next
  })
}

export async function removeWorkspaceLayout(id: string): Promise<WorkspaceLayout[]> {
  return layoutsMutex.run(async () => {
    const existing = await loadWorkspaceLayouts()
    const next = deleteWorkspaceLayout(existing, id)
    await chrome.storage.local.set({ [WORKSPACE_LAYOUTS_KEY]: next })
    return next
  })
}
