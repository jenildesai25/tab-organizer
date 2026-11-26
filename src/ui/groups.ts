import type { ChromeColor } from '../domain/types.js'
import {
  TAB_GROUP_COLOR_HEX,
  TAB_GROUP_COLORS,
  type TabGroupView,
} from '../domain/tab-groups.js'

export type GroupListMode = 'manage' | 'compact'

export type GroupListController = {
  openPickerId: number | null
  pendingDeleteId: number | null
  openMenuId: number | null
}

export type GroupListHandlers = {
  onColor: (group: TabGroupView, color: ChromeColor) => void
  onTitleCommit: (group: TabGroupView, title: string) => void
  onRequestUngroup: (groupId: number) => void
  onConfirmUngroup: (groupId: number) => void
  onCancelUngroup: () => void
  onTogglePicker: (groupId: number | null) => void
  onToggleMenu: (groupId: number | null) => void
  /** Optional: Protect / unprotect this group from auto-clean. */
  onToggleCleanupProtect?: (group: TabGroupView) => void
}

function tabLabel(count: number): string {
  return count === 1 ? '1 tab' : `${count} tabs`
}

function metaLine(group: TabGroupView, mode: GroupListMode): string {
  const base = tabLabel(group.tabCount)
  if (mode === 'compact') return base
  if (group.shared) return `${base} · Shared`
  return base
}

function isImeConfirmEnter(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

function paintActions(
  actions: HTMLElement,
  group: TabGroupView,
  state: GroupListController,
  handlers: GroupListHandlers,
  tiny: boolean,
): void {
  if (!group.editable) return

  if (state.pendingDeleteId === group.id) {
    const confirm = document.createElement('button')
    confirm.type = 'button'
    confirm.className = 'confirm-delete'
    confirm.textContent = 'Ungroup'
    confirm.title = 'Remove the group without closing its tabs'
    confirm.addEventListener('click', (event) => {
      event.stopPropagation()
      handlers.onConfirmUngroup(group.id)
    })
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = tiny ? 'btn btn-ghost btn-tiny' : 'btn btn-ghost'
    cancel.textContent = 'Cancel'
    cancel.addEventListener('click', (event) => {
      event.stopPropagation()
      handlers.onCancelUngroup()
    })
    actions.append(confirm, cancel)
    return
  }

  const menuId = `group-menu-${group.id}`
  const more = document.createElement('button')
  more.type = 'button'
  more.className = 'icon-more'
  more.setAttribute('aria-label', `Actions for ${group.title || 'untitled group'}`)
  more.setAttribute('aria-haspopup', 'menu')
  more.setAttribute('aria-expanded', state.openMenuId === group.id ? 'true' : 'false')
  more.setAttribute('aria-controls', menuId)
  more.textContent = '⋯'
  more.addEventListener('click', (event) => {
    event.stopPropagation()
    handlers.onToggleMenu(state.openMenuId === group.id ? null : group.id)
  })
  actions.append(more)

  if (state.openMenuId === group.id) {
    const menu = document.createElement('div')
    menu.id = menuId
    menu.className = 'row-menu'
    menu.setAttribute('role', 'menu')

    if (handlers.onToggleCleanupProtect) {
      const protect = document.createElement('button')
      protect.type = 'button'
      protect.className = 'row-menu-item'
      protect.setAttribute('role', 'menuitem')
      protect.textContent = group.cleanupProtected
        ? 'Allow auto-clean for this group'
        : 'Never auto-clean this group'
      protect.title = group.cleanupProtected
        ? 'Old tabs in this group may be closed when Clean up old tabs runs'
        : 'Keep tabs in this group when Clean up old tabs runs'
      protect.addEventListener('click', (event) => {
        event.stopPropagation()
        handlers.onToggleCleanupProtect?.(group)
      })
      menu.append(protect)
    }

    const ungroup = document.createElement('button')
    ungroup.type = 'button'
    ungroup.className = 'row-menu-item danger'
    ungroup.setAttribute('role', 'menuitem')
    ungroup.textContent = 'Ungroup'
    ungroup.title = 'Remove the group without closing its tabs'
    ungroup.addEventListener('click', (event) => {
      event.stopPropagation()
      handlers.onRequestUngroup(group.id)
    })
    menu.append(ungroup)
    actions.append(menu)
  }
}

function paintCompactRow(
  group: TabGroupView,
  state: GroupListController,
  handlers: GroupListHandlers,
  highlight: boolean,
): HTMLLIElement {
  const item = document.createElement('li')
  item.className = 'group-item'
  if (highlight) item.classList.add('group-row-renamed')
  item.dataset.groupId = String(group.id)
  item.style.setProperty('--group-color', TAB_GROUP_COLOR_HEX[group.color])

  const swatch = document.createElement('span')
  swatch.className = 'group-swatch'
  swatch.setAttribute('aria-hidden', 'true')

  const copy = document.createElement('div')
  copy.className = 'group-copy'
  const name = document.createElement('span')
  name.className = 'group-name'
  const label = group.title || 'Untitled group'
  name.textContent = label
  name.title = label
  const meta = document.createElement('span')
  meta.className = 'group-meta'
  meta.textContent = metaLine(group, 'compact')
  copy.append(name, meta)

  const actions = document.createElement('div')
  actions.className = 'group-actions'
  paintActions(actions, group, state, handlers, true)

  // swatch | title + "N tabs" | ⋯ — no separate count column (avoids duplicate "2")
  item.append(swatch, copy, actions)
  return item
}

function paintManageRow(
  group: TabGroupView,
  state: GroupListController,
  handlers: GroupListHandlers,
  highlight: boolean,
): HTMLLIElement {
  const item = document.createElement('li')
  item.className = 'group-manage'
  if (highlight) item.classList.add('group-row-renamed')
  item.dataset.groupId = String(group.id)
  item.style.setProperty('--group-color', TAB_GROUP_COLOR_HEX[group.color])

  const main = document.createElement('div')
  main.className = 'gm-main'

  const swatchWrap = document.createElement('div')
  swatchWrap.className = 'swatch-wrap'

  const swatch = document.createElement('button')
  swatch.type = 'button'
  swatch.className = 'group-swatch swatch'
  swatch.title = group.editable ? `Color: ${group.color}` : 'Shared group'
  swatch.setAttribute(
    'aria-label',
    group.editable
      ? `Change color for ${group.title || 'untitled group'}`
      : `Color for ${group.title || 'untitled group'}`,
  )
  swatch.disabled = !group.editable
  if (group.editable) {
    swatch.addEventListener('click', (event) => {
      event.stopPropagation()
      handlers.onTogglePicker(state.openPickerId === group.id ? null : group.id)
    })
  }
  swatchWrap.append(swatch)

  if (state.openPickerId === group.id && group.editable) {
    const picker = document.createElement('div')
    picker.className = 'swatch-picker'
    picker.setAttribute('role', 'listbox')
    picker.setAttribute('aria-label', 'Group color')
    for (const color of TAB_GROUP_COLORS) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.title = color
      chip.setAttribute('aria-label', color)
      chip.setAttribute('aria-pressed', color === group.color ? 'true' : 'false')
      chip.style.background = TAB_GROUP_COLOR_HEX[color]
      chip.addEventListener('click', (event) => {
        event.stopPropagation()
        handlers.onColor(group, color)
      })
      picker.append(chip)
    }
    swatchWrap.append(picker)
  }

  const copy = document.createElement('div')
  copy.className = 'gm-copy'

  if (group.editable) {
    const title = document.createElement('input')
    title.className = 'group-title'
    title.type = 'text'
    title.value = group.title
    title.placeholder = 'Untitled group'
    title.title = group.title || 'Untitled group'
    title.autocomplete = 'off'
    title.spellcheck = false
    title.setAttribute('autocorrect', 'off')
    title.setAttribute('autocapitalize', 'none')
    title.setAttribute('aria-label', 'Group name')
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        if (isImeConfirmEnter(event)) return
        event.preventDefault()
        title.blur()
      }
      if (event.key === 'Escape') {
        title.value = group.title
        title.blur()
      }
    })
    title.addEventListener('blur', () => {
      handlers.onTitleCommit(group, title.value.trim())
    })
    copy.append(title)
  } else {
    const title = document.createElement('p')
    title.className = 'group-title-text'
    const label = group.title || 'Untitled group'
    title.textContent = label
    title.title = label
    copy.append(title)
  }

  const meta = document.createElement('span')
  meta.className = 'group-meta'
  meta.textContent = metaLine(group, 'manage')
  copy.append(meta)

  const actions = document.createElement('div')
  actions.className = 'gm-actions group-actions'
  paintActions(actions, group, state, handlers, false)

  main.append(swatchWrap, copy, actions)
  item.append(main)
  return item
}

export function renderGroupRow(
  group: TabGroupView,
  mode: GroupListMode,
  state: GroupListController,
  handlers: GroupListHandlers,
  highlight = false,
): HTMLLIElement {
  return mode === 'compact'
    ? paintCompactRow(group, state, handlers, highlight)
    : paintManageRow(group, state, handlers, highlight)
}

export function renderGroupList(
  list: HTMLUListElement,
  groups: readonly TabGroupView[],
  mode: GroupListMode,
  state: GroupListController,
  handlers: GroupListHandlers,
  highlightIds: ReadonlySet<number> = new Set(),
): void {
  list.replaceChildren()
  for (const group of groups) {
    list.append(renderGroupRow(group, mode, state, handlers, highlightIds.has(group.id)))
  }
}
