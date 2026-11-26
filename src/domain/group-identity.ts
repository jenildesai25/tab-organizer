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
        if (fingerprint.patterns.length > 0 && row.group.patterns.length > 0) return row.overlap >= 0.25
        return true
      })

    const urlsReady = fingerprint.patterns.length > 0 && scored.some((row) => row.group.patterns.length > 0)
    if (scored.length > 1 && !urlsReady) {
      bound.push({ id: null, fingerprint })
      continue
    }

    scored.sort(
      (left, right) => right.overlap - left.overlap || left.group.id - right.group.id,
    )
    const best = scored[0]
    if (best) {
      used.add(best.group.id)
      const patterns = best.group.patterns.length > 0 ? best.group.patterns : fingerprint.patterns
      const refreshed =
        groupFingerprint({
          title: best.group.title || fingerprint.title,
          color: best.group.color || fingerprint.color,
          urls: patterns,
        }) ?? fingerprint
      bound.push({ id: best.group.id, fingerprint: refreshed })
      continue
    }

    const byUrl = live
      .filter((group) => !used.has(group.id))
      .map((group) => ({ group, overlap: jaccard(fingerprint.patterns, group.patterns) }))
      .filter((row) => fingerprint.patterns.length > 0 && row.group.patterns.length > 0 && row.overlap >= 0.8)
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

    if (!anyLiveUrls && fingerprint.patterns.length > 0) {
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
