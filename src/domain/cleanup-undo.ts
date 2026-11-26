import { isHttpUrl } from './feature-card.js'

/** How long a clean-up can be undone after it runs. */
export const CLEANUP_UNDO_TTL_MS = 10 * 60 * 1000

/** chrome.storage.session key — URLs stay out of long-term local storage. */
export const CLEANUP_UNDO_KEY = 'cleanupUndo'

/** Cap how many tabs one undo snapshot may hold. */
export const MAX_CLEANUP_UNDO_TABS = 80

export type ClosedCleanupTab = {
  url: string
  title: string
  windowId: number
  pinned: boolean
  groupTitle: string
  groupColor: string
}

export type CleanupUndoSnapshot = {
  closedAt: number
  expiresAt: number
  tabs: ClosedCleanupTab[]
}

/** Compact hint for the dashboard while an undo is still available. */
export type CleanupUndoHint = {
  closed: number
  expiresAt: number
}

export type CleanupTabSnapshotSource = {
  id?: number
  url?: string
  pendingUrl?: string
  title?: string
  windowId?: number
  pinned?: boolean
  groupId?: number
}

export type CleanupGroupSnapshotSource = {
  id: number
  title?: string
  color?: string
}

/** Prefer a real http(s) address; pendingUrl covers a tab still navigating. */
export function resolveCloseableUrl(tab: Pick<CleanupTabSnapshotSource, 'url' | 'pendingUrl'>): string {
  const url = (tab.url || '').trim()
  const pending = (tab.pendingUrl || '').trim()
  if (isHttpUrl(url)) return url
  if (isHttpUrl(pending)) return pending
  return ''
}

/**
 * Build the undo payload from the tabs about to close.
 * Only http(s) tabs are kept. Empty when nothing can be restored.
 */
export function buildCleanupUndoSnapshot(
  tabs: readonly CleanupTabSnapshotSource[],
  groups: readonly CleanupGroupSnapshotSource[],
  closedIds: readonly number[],
  now = Date.now(),
  ttlMs = CLEANUP_UNDO_TTL_MS,
): CleanupUndoSnapshot | null {
  const wanted = new Set(closedIds.filter((id) => Number.isInteger(id) && id >= 0))
  if (wanted.size === 0) return null
  const byGroup = new Map(groups.map((group) => [group.id, group]))
  const out: ClosedCleanupTab[] = []
  for (const tab of tabs) {
    if (tab.id == null || !wanted.has(tab.id)) continue
    const url = resolveCloseableUrl(tab)
    if (!url) continue
    const group = tab.groupId != null ? byGroup.get(tab.groupId) : undefined
    out.push({
      url,
      title: (tab.title || '').trim(),
      windowId: typeof tab.windowId === 'number' && Number.isFinite(tab.windowId) ? tab.windowId : -1,
      pinned: tab.pinned === true,
      groupTitle: (group?.title || '').trim(),
      groupColor: (group?.color || '').trim().toLowerCase(),
    })
    if (out.length >= MAX_CLEANUP_UNDO_TABS) break
  }
  if (out.length === 0) return null
  return {
    closedAt: now,
    expiresAt: now + Math.max(0, ttlMs),
    tabs: out,
  }
}

export function parseCleanupUndoSnapshot(raw: unknown): CleanupUndoSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.closedAt !== 'number' || !Number.isFinite(row.closedAt)) return null
  if (typeof row.expiresAt !== 'number' || !Number.isFinite(row.expiresAt)) return null
  if (!Array.isArray(row.tabs)) return null
  const tabs: ClosedCleanupTab[] = []
  for (const item of row.tabs) {
    if (!item || typeof item !== 'object') continue
    const tab = item as Record<string, unknown>
    if (typeof tab.url !== 'string' || !isHttpUrl(tab.url)) continue
    tabs.push({
      url: tab.url,
      title: typeof tab.title === 'string' ? tab.title : '',
      windowId: typeof tab.windowId === 'number' && Number.isFinite(tab.windowId) ? tab.windowId : -1,
      pinned: tab.pinned === true,
      groupTitle: typeof tab.groupTitle === 'string' ? tab.groupTitle : '',
      groupColor: typeof tab.groupColor === 'string' ? tab.groupColor.trim().toLowerCase() : '',
    })
    if (tabs.length >= MAX_CLEANUP_UNDO_TABS) break
  }
  if (tabs.length === 0) return null
  return { closedAt: row.closedAt, expiresAt: row.expiresAt, tabs }
}

export function cleanupUndoIsLive(snapshot: CleanupUndoSnapshot | null | undefined, now = Date.now()): boolean {
  return Boolean(snapshot && snapshot.tabs.length > 0 && now < snapshot.expiresAt)
}

export function cleanupUndoHint(snapshot: CleanupUndoSnapshot | null | undefined, now = Date.now()): CleanupUndoHint | null {
  if (!cleanupUndoIsLive(snapshot, now) || !snapshot) return null
  return { closed: snapshot.tabs.length, expiresAt: snapshot.expiresAt }
}

export function formatCleanupUndoSummary(closed: number): string {
  return closed === 1 ? 'Reopened 1 tab from the last clean-up.' : `Reopened ${closed} tabs from the last clean-up.`
}
