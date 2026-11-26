/** Who caused an extension-driven tab/group mutation. */
export type ActivityActor = 'ai' | 'rule' | 'sweep' | 'organizer' | 'user' | 'system'

/** Friendly filter buckets for the dashboard Activity screen. */
export type ActivityFilter = 'all' | 'ai' | 'you' | 'organize' | 'rules'

export type ActivityAction =
  | 'group.create'
  | 'group.rename'
  | 'group.recolor'
  | 'group.ungroup'
  | 'tab.file'
  | 'tab.close'
  | 'tab.reopen'
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
  /** Registrable domain / site key only — never a full URL. */
  siteKey?: string
  reason?: string
  model?: string
  color?: string
  tabCount?: number
}

export const ACTIVITY_LOG_KEY = 'activityLog'
export const ACTIVITY_LOG_CAP = 500

const ACTORS = new Set<ActivityActor>(['ai', 'rule', 'sweep', 'organizer', 'user', 'system'])
const ACTIONS = new Set<ActivityAction>([
  'group.create',
  'group.rename',
  'group.recolor',
  'group.ungroup',
  'tab.file',
  'tab.close',
  'tab.reopen',
  'rename.skip',
])

export const ACTIVITY_FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ai', label: 'AI' },
  { value: 'you', label: 'You' },
  { value: 'organize', label: 'Organize' },
  { value: 'rules', label: 'Rules' },
]

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

/** Map a dashboard filter chip to the actors it includes. */
export function actorsForFilter(filter: ActivityFilter): ReadonlySet<ActivityActor> | 'all' {
  switch (filter) {
    case 'all':
      return 'all'
    case 'ai':
      return new Set<ActivityActor>(['ai'])
    case 'you':
      return new Set<ActivityActor>(['user'])
    case 'organize':
      return new Set<ActivityActor>(['sweep', 'organizer'])
    case 'rules':
      return new Set<ActivityActor>(['rule'])
  }
}

export function filterActivityByFilter(
  entries: readonly ActivityEntry[],
  filter: ActivityFilter,
): ActivityEntry[] {
  const actors = actorsForFilter(filter)
  if (actors === 'all') return [...entries]
  return entries.filter((entry) => actors.has(entry.actor))
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
      return 'A rule'
    case 'sweep':
      return 'Organize'
    case 'organizer':
      return 'Auto-file'
    case 'user':
      return 'You'
    case 'system':
      return 'Tab Organizer'
  }
}

function startOfLocalDay(ts: number): number {
  const date = new Date(ts)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Human-readable time for non-experts (relative when recent, dated otherwise). */
export function formatActivityTime(entry: ActivityEntry, now = Date.now()): string {
  const delta = Math.max(0, now - entry.ts)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (delta < 45_000) return 'Just now'
  if (delta < hour) {
    const mins = Math.max(1, Math.round(delta / minute))
    return mins === 1 ? '1 min ago' : `${mins} min ago`
  }
  if (delta < day) {
    const hours = Math.max(1, Math.round(delta / hour))
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  }

  const today = startOfLocalDay(now)
  const entryDay = startOfLocalDay(entry.ts)
  const dayDiff = Math.round((today - entryDay) / day)
  if (dayDiff === 1) return `Yesterday ${formatClock(entry.ts)}`
  if (dayDiff > 1 && dayDiff < 7) {
    const weekday = new Date(entry.ts).toLocaleDateString(undefined, { weekday: 'short' })
    return `${weekday} ${formatClock(entry.ts)}`
  }

  return new Date(entry.ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Body only (no clock), e.g. `AI renamed "Cloud" → "Bug Reports"`. */
export function formatActivityBody(entry: ActivityEntry): string {
  const who = actorLabel(entry.actor)
  let body = ''

  switch (entry.action) {
    case 'group.rename':
      body = `${who} renamed ${quoteTitle(entry.oldTitle)} → ${quoteTitle(entry.newTitle ?? entry.groupTitle)}`
      break
    case 'group.create':
      body = `${who} created group ${quoteTitle(entry.groupTitle ?? entry.newTitle)}`
      break
    case 'group.recolor':
      body = `${who} changed the color of ${quoteTitle(entry.groupTitle ?? entry.newTitle)}`
      if (entry.color) body += ` to ${entry.color}`
      break
    case 'group.ungroup':
      body = `${who} ungrouped ${quoteTitle(entry.groupTitle ?? entry.oldTitle)}`
      break
    case 'tab.file': {
      const count = entry.tabCount ?? 1
      const noun = count === 1 ? 'a tab' : `${count} tabs`
      body = `${who} put ${noun} in ${quoteTitle(entry.groupTitle ?? entry.newTitle)}`
      break
    }
    case 'tab.close': {
      const count = entry.tabCount ?? 1
      const noun = count === 1 ? '1 old tab' : `${count} old tabs`
      const reason = entry.reason?.trim()
      body = reason ? `${who} closed ${noun} (${reason})` : `${who} closed ${noun}`
      break
    }
    case 'tab.reopen': {
      const count = entry.tabCount ?? 1
      const noun = count === 1 ? '1 tab' : `${count} tabs`
      body = `${who} reopened ${noun} from the last clean-up`
      break
    }
    case 'rename.skip': {
      const title = quoteTitle(entry.oldTitle ?? entry.groupTitle)
      const reason = entry.reason?.trim()
      body = reason ? `${who} left ${title} as-is (${reason})` : `${who} left ${title} as-is`
      break
    }
  }

  if (entry.model?.trim() && (entry.action === 'group.rename' || entry.action === 'rename.skip')) {
    body += ` · ${entry.model.trim()}`
  }

  return body
}

/** One scannable audit line, e.g. `Just now · AI renamed "Cloud" → "Bug Reports"`. */
export function formatActivityLine(entry: ActivityEntry, now = Date.now()): string {
  return `${formatActivityTime(entry, now)} · ${formatActivityBody(entry)}`
}
