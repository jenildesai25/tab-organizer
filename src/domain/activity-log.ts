/** Who caused an extension-driven tab/group mutation. */
export type ActivityActor = 'ai' | 'rule' | 'sweep' | 'organizer' | 'user' | 'system'

export type ActivityAction =
  | 'group.create'
  | 'group.rename'
  | 'group.recolor'
  | 'group.ungroup'
  | 'tab.file'
  | 'rename.skip'

export type ActivityEntry = {
  id: string
  /** Epoch milliseconds. */
  ts: number
  actor: ActivityActor
  action: ActivityAction
  groupId?: number
  groupTitle?: string
  oldTitle?: string
  newTitle?: string
  tabId?: number
  tabUrl?: string
  siteKey?: string
  reason?: string
  model?: string
  color?: string
  tabCount?: number
}

export const ACTIVITY_LOG_KEY = 'activityLog'
export const ACTIVITY_LOG_CAP = 300

const ACTORS = new Set<ActivityActor>(['ai', 'rule', 'sweep', 'organizer', 'user', 'system'])
const ACTIONS = new Set<ActivityAction>([
  'group.create',
  'group.rename',
  'group.recolor',
  'group.ungroup',
  'tab.file',
  'rename.skip',
])

export type ActivityDraft = Omit<ActivityEntry, 'id' | 'ts'> & Partial<Pick<ActivityEntry, 'id' | 'ts'>>

export function createActivityEntry(draft: ActivityDraft, now = Date.now(), id?: string): ActivityEntry {
  return {
    ...draft,
    id: draft.id ?? id ?? crypto.randomUUID(),
    ts: draft.ts ?? now,
  }
}

/** Keep the newest `cap` entries (newest first). */
export function trimActivityLog(entries: readonly ActivityEntry[], cap = ACTIVITY_LOG_CAP): ActivityEntry[] {
  if (cap <= 0) return []
  if (entries.length <= cap) return [...entries]
  return entries.slice(0, cap)
}

/** Prepend one entry and trim to the ring-buffer cap. */
export function appendActivityEntry(
  existing: readonly ActivityEntry[],
  draft: ActivityDraft,
  options: { now?: number; id?: string; cap?: number } = {},
): ActivityEntry[] {
  const entry = createActivityEntry(draft, options.now, options.id)
  return trimActivityLog([entry, ...existing], options.cap ?? ACTIVITY_LOG_CAP)
}

export function parseStoredActivityLog(raw: unknown): ActivityEntry[] {
  if (!Array.isArray(raw)) return []
  const out: ActivityEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.ts !== 'number') continue
    if (!ACTORS.has(row.actor as ActivityActor)) continue
    if (!ACTIONS.has(row.action as ActivityAction)) continue
    out.push({
      id: row.id,
      ts: row.ts,
      actor: row.actor as ActivityActor,
      action: row.action as ActivityAction,
      groupId: typeof row.groupId === 'number' ? row.groupId : undefined,
      groupTitle: typeof row.groupTitle === 'string' ? row.groupTitle : undefined,
      oldTitle: typeof row.oldTitle === 'string' ? row.oldTitle : undefined,
      newTitle: typeof row.newTitle === 'string' ? row.newTitle : undefined,
      tabId: typeof row.tabId === 'number' ? row.tabId : undefined,
      tabUrl: typeof row.tabUrl === 'string' ? row.tabUrl : undefined,
      siteKey: typeof row.siteKey === 'string' ? row.siteKey : undefined,
      reason: typeof row.reason === 'string' ? row.reason : undefined,
      model: typeof row.model === 'string' ? row.model : undefined,
      color: typeof row.color === 'string' ? row.color : undefined,
      tabCount: typeof row.tabCount === 'number' ? row.tabCount : undefined,
    })
  }
  return out
}

export function filterActivityByActor(
  entries: readonly ActivityEntry[],
  actor: ActivityActor | 'all',
): ActivityEntry[] {
  if (actor === 'all') return [...entries]
  return entries.filter((entry) => entry.actor === actor)
}

function quoteTitle(title: string | undefined): string {
  const trimmed = (title ?? '').trim()
  return `"${trimmed === '' ? 'Untitled' : trimmed}"`
}

function actorLabel(actor: ActivityActor): string {
  switch (actor) {
    case 'ai':
      return 'AI'
    case 'rule':
      return 'Rule'
    case 'sweep':
      return 'Sweep'
    case 'organizer':
      return 'Organizer'
    case 'user':
      return 'You'
    case 'system':
      return 'System'
  }
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** One scannable audit line, e.g. `8:41 PM · AI renamed "Cloud" → "Bug Reports" (deepseek-r1:14b)`. */
export function formatActivityLine(entry: ActivityEntry): string {
  const when = formatClock(entry.ts)
  const who = actorLabel(entry.actor)
  let body = ''

  switch (entry.action) {
    case 'group.rename':
      body = `${who} renamed ${quoteTitle(entry.oldTitle)} → ${quoteTitle(entry.newTitle ?? entry.groupTitle)}`
      break
    case 'group.create':
      body = `${who} created ${quoteTitle(entry.groupTitle ?? entry.newTitle)}`
      break
    case 'group.recolor':
      body = `${who} recolored ${quoteTitle(entry.groupTitle ?? entry.newTitle)}`
      if (entry.color) body += ` (${entry.color})`
      break
    case 'group.ungroup':
      body = `${who} ungrouped ${quoteTitle(entry.groupTitle ?? entry.oldTitle)}`
      break
    case 'tab.file': {
      const count = entry.tabCount ?? 1
      const noun = count === 1 ? 'tab' : `${count} tabs`
      body = `${who} filed ${noun} into ${quoteTitle(entry.groupTitle ?? entry.newTitle)}`
      break
    }
    case 'rename.skip': {
      const title = quoteTitle(entry.oldTitle ?? entry.groupTitle)
      const reason = entry.reason?.trim()
      body = reason ? `${who} skipped ${title} (${reason})` : `${who} skipped ${title}`
      break
    }
  }

  if (entry.model?.trim() && (entry.action === 'group.rename' || entry.action === 'rename.skip')) {
    body += ` (${entry.model.trim()})`
  }

  return `${when} · ${body}`
}
