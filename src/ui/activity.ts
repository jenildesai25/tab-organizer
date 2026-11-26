import {
  ACTIVITY_FILTERS,
  formatActivityBody,
  formatActivityTime,
  type ActivityActor,
  type ActivityEntry,
  type ActivityFilter,
} from '../domain/activity-log.js'

export type ActivityListOptions = {
  emptyText?: string
  limit?: number
  now?: number
}

function markActor(actor: ActivityActor): ActivityActor | '' {
  if (actor === 'ai' || actor === 'user' || actor === 'sweep') return actor
  if (actor === 'organizer') return 'sweep'
  if (actor === 'rule') return 'user'
  return ''
}

/** Paint a compact or full activity list into `list`. */
export function paintActivityList(
  list: HTMLElement,
  empty: HTMLElement | null,
  entries: readonly ActivityEntry[],
  options: ActivityListOptions = {},
): void {
  const limited =
    options.limit && options.limit > 0 ? entries.slice(0, options.limit) : [...entries]
  list.replaceChildren()
  if (limited.length === 0) {
    if (empty) {
      empty.hidden = false
      empty.textContent =
        options.emptyText ??
        'Nothing here yet. When Tab Organizer groups tabs, renames groups, or follows a rule, those steps show up in this list.'
    }
    return
  }
  if (empty) empty.hidden = true
  const now = options.now ?? Date.now()
  for (const entry of limited) {
    const item = document.createElement('li')
    item.className = `activity-item activity-actor-${entry.actor} activity-action-${entry.action.replace('.', '-')}`
    item.dataset.actor = entry.actor
    item.dataset.action = entry.action
    if (entry.groupId != null) item.dataset.groupId = String(entry.groupId)

    const mark = document.createElement('span')
    mark.className = 'activity-mark'
    mark.setAttribute('aria-hidden', 'true')
    const markKind = markActor(entry.actor)
    if (markKind) mark.dataset.actor = markKind

    const copy = document.createElement('span')
    copy.className = 'activity-copy'
    copy.textContent = formatActivityBody(entry)

    const time = document.createElement('time')
    time.className = 'activity-time'
    time.dateTime = new Date(entry.ts).toISOString()
    time.title = new Date(entry.ts).toLocaleString()
    time.textContent = formatActivityTime(entry, now)

    item.append(mark, copy, time)
    list.append(item)
  }
}

export { ACTIVITY_FILTERS }
export type { ActivityFilter }

/** @deprecated Prefer ACTIVITY_FILTERS / ActivityFilter for the dashboard. */
export const ACTIVITY_ACTOR_FILTERS: { value: ActivityActor | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ai', label: 'AI' },
  { value: 'user', label: 'You' },
  { value: 'sweep', label: 'Organize' },
  { value: 'organizer', label: 'Auto-file' },
  { value: 'rule', label: 'Rules' },
  { value: 'system', label: 'System' },
]
