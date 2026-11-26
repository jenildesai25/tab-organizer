import {
  formatActivityBody,
  formatActivityTime,
  type ActivityActor,
  type ActivityEntry,
} from '../domain/activity-log.js'

export type ActivityListOptions = {
  emptyText?: string
  limit?: number
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
      empty.textContent = options.emptyText ?? 'No activity yet.'
    }
    return
  }
  if (empty) empty.hidden = true
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
    time.textContent = formatActivityTime(entry)

    item.append(mark, copy, time)
    list.append(item)
  }
}

export const ACTIVITY_ACTOR_FILTERS: { value: ActivityActor | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ai', label: 'AI' },
  { value: 'user', label: 'You' },
  { value: 'sweep', label: 'Sweep' },
  { value: 'organizer', label: 'Organizer' },
  { value: 'rule', label: 'Rule' },
  { value: 'system', label: 'System' },
]
