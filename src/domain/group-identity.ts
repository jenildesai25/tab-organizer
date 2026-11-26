import { titlesMatch } from './sites.js'
import { normalizeUrlPattern } from './tab-cleanup.js'

/** Durable description of a tab group. Chrome group ids do not survive a restart. */
export type GroupFingerprint = {
  title: string
  color: string
  patterns: string[]
}

export type LiveGroupSnapshot = {
  id: number
  title: string
  color: string
  patterns: string[]
}

export type BoundGroup = {
  id: number | null
  fingerprint: GroupFingerprint
}

const MAX_PATTERNS = 40
const MATCH_OVERLAP = 0.25
const STRONG_OVERLAP = 0.8

export function groupFingerprint(input: {
  title: string
  color?: string
  urls: readonly string[]
}): GroupFingerprint | null {
  const title = input.title.trim()
  if (!title) return null
  const seen = new Set<string>()
  const patterns: string[] = []
  for (const url of input.urls) {
    const pattern = normalizeUrlPattern(url)
    if (!pattern || seen.has(pattern)) continue
    seen.add(pattern)
    patterns.push(pattern)
    if (patterns.length >= MAX_PATTERNS) break
  }
  patterns.sort()
  return {
    title,
    color: (input.color || '').trim().toLowerCase(),
    patterns,
  }
}

export function parseGroupFingerprints(raw: unknown): GroupFingerprint[] {
  if (!Array.isArray(raw)) return []
  const out: GroupFingerprint[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const title = typeof row.title === 'string' ? row.title : ''
    const color = typeof row.color === 'string' ? row.color : ''
    const urls = Array.isArray(row.patterns)
      ? row.patterns.filter((entry): entry is string => typeof entry === 'string')
      : []
    const fingerprint = groupFingerprint({ title, color, urls })
    if (fingerprint) out.push(fingerprint)
  }
  return out
}

function refreshedFingerprint(
  fingerprint: GroupFingerprint,
  group: LiveGroupSnapshot,
  overlap: number,
): GroupFingerprint {
  if (overlap < STRONG_OVERLAP || group.patterns.length === 0) return fingerprint
  return (
    groupFingerprint({
      title: group.title || fingerprint.title,
      color: group.color || fingerprint.color,
      urls: group.patterns,
    }) ?? fingerprint
  )
}

/**
 * Drop the binding for one group, including a fingerprint rebind could not
 * attach to an id yet. A shared title with another live group is kept unless
 * the pages themselves match this group.
 */
export function omitGroupBinding(
  bound: readonly BoundGroup[],
  groupId: number,
  snapshot: LiveGroupSnapshot | undefined,
  live: readonly LiveGroupSnapshot[],
): BoundGroup[] {
  const titleShared = snapshot
    ? live.some((group) => group.id !== groupId && titlesMatch(group.title, snapshot.title))
    : false
  return bound.filter((row) => !bindingTargetsGroup(row, groupId, snapshot, titleShared))
}

function bindingTargetsGroup(
  row: BoundGroup,
  groupId: number,
  snapshot: LiveGroupSnapshot | undefined,
  titleShared: boolean,
): boolean {
  if (row.id === groupId) return true
  if (row.id != null || !snapshot) return false
  const overlap = jaccard(row.fingerprint.patterns, snapshot.patterns)
  const strongUrl =
    row.fingerprint.patterns.length > 0 && snapshot.patterns.length > 0 && overlap >= STRONG_OVERLAP
  if (strongUrl) return true
  if (titleShared || !titlesMatch(row.fingerprint.title, snapshot.title)) return false
  if (row.fingerprint.patterns.length === 0 || snapshot.patterns.length === 0) return true
  return overlap >= MATCH_OVERLAP
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) return 1
  if (left.length === 0 || right.length === 0) return 0
  const rightSet = new Set(right)
  let hit = 0
  for (const item of left) if (rightSet.has(item)) hit += 1
  const union = new Set([...left, ...right]).size
  return union === 0 ? 0 : hit / union
}

/**
 * Match saved fingerprints to the groups Chrome restored.
 * A fingerprint is kept when the group is still loading (no urls yet) or when
 * the match is ambiguous, so a later pass can bind it. It is dropped when the
 * group is gone.
 */
export function rebindGroupFingerprints(
  fingerprints: readonly GroupFingerprint[],
  live: readonly LiveGroupSnapshot[],
): BoundGroup[] {
  const used = new Set<number>()
  const anyLiveUrls = live.some((group) => group.patterns.length > 0)
  const bound: BoundGroup[] = []

  for (const fingerprint of fingerprints) {
    const titled = live.filter((group) => !used.has(group.id) && titlesMatch(fingerprint.title, group.title))
    const scored = titled
      .map((group) => {
        const overlap = jaccard(fingerprint.patterns, group.patterns)
        const colorConflict = Boolean(fingerprint.color && group.color && fingerprint.color !== group.color)
        return { group, overlap, colorConflict }
      })
      .filter((row) => {
        if (row.colorConflict) return false
        if (fingerprint.patterns.length > 0 && row.group.patterns.length > 0) return row.overlap >= MATCH_OVERLAP
        return true
      })
      .sort((left, right) => right.overlap - left.overlap || left.group.id - right.group.id)

    const urlsReady = fingerprint.patterns.length > 0 && scored.some((row) => row.group.patterns.length > 0)
    const best = scored[0]
    const runner = scored[1]
    const ambiguous = Boolean(
      best && ((scored.length > 1 && !urlsReady) || (runner && best.overlap === runner.overlap)),
    )
    if (ambiguous && best) {
      bound.push({ id: null, fingerprint })
      continue
    }
    if (best) {
      used.add(best.group.id)
      bound.push({ id: best.group.id, fingerprint: refreshedFingerprint(fingerprint, best.group, best.overlap) })
      continue
    }

    const byUrl = live
      .filter((group) => !used.has(group.id))
      .map((group) => ({ group, overlap: jaccard(fingerprint.patterns, group.patterns) }))
      .filter((row) => fingerprint.patterns.length > 0 && row.group.patterns.length > 0 && row.overlap >= STRONG_OVERLAP)
      .sort((left, right) => right.overlap - left.overlap || left.group.id - right.group.id)
    if (byUrl.length === 1) {
      const group = byUrl[0]!.group
      used.add(group.id)
      const refreshed =
        groupFingerprint({
          title: group.title || fingerprint.title,
          color: group.color || fingerprint.color,
          urls: group.patterns,
        }) ?? fingerprint
      bound.push({ id: group.id, fingerprint: refreshed })
      continue
    }

    if (byUrl.length > 1 || (!anyLiveUrls && fingerprint.patterns.length > 0)) {
      bound.push({ id: null, fingerprint })
    }
  }

  return bound
}

export function boundGroupIds(bound: readonly BoundGroup[]): number[] {
  const ids: number[] = []
  const seen = new Set<number>()
  for (const row of bound) {
    if (row.id == null || seen.has(row.id)) continue
    seen.add(row.id)
    ids.push(row.id)
  }
  return ids
}
