export const IGNORED_WINDOWS_KEY = 'ignoredWindowIds'

/** Positive window ids only; unique; order preserved. */
export function normalizeIgnoredWindowIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<number>()
  const out: number[] = []
  for (const item of raw) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0) continue
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

export function isWindowIgnored(ids: readonly number[], windowId: number): boolean {
  return ids.includes(windowId)
}

export function setWindowIgnored(
  ids: readonly number[],
  windowId: number,
  ignored: boolean,
): number[] {
  if (!Number.isInteger(windowId) || windowId < 0) return [...ids]
  const set = new Set(ids)
  if (ignored) set.add(windowId)
  else set.delete(windowId)
  return [...set]
}

export function pruneIgnoredWindowIds(
  ids: readonly number[],
  liveWindowIds: ReadonlySet<number>,
): number[] {
  return ids.filter((id) => liveWindowIds.has(id))
}
