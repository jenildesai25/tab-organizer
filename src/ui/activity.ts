import { formatActivityLine, type ActivityActor, type ActivityEntry } from '../domain/activity-log.js'

export type ActivityListOptions = {
  emptyText?: string
  limit?: number
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
    item.textContent = formatActivityLine(entry)
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
