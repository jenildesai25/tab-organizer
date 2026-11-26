/** Storage key for group IDs the user renamed by hand (survives SW restarts). */
export const HAND_RENAMED_KEY = 'handRenamedGroupIds'

export function parseHandRenamedIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const out: number[] = []
  const seen = new Set<number>()
  for (const item of raw) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0) continue
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

/** Drop IDs that are no longer live Chrome tab groups. */
export function pruneHandRenamedIds(
  stored: readonly number[],
  liveGroupIds: ReadonlySet<number>,
): number[] {
  return stored.filter((id) => liveGroupIds.has(id))
}
