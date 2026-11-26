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

export function renderGroupRow(
  group: TabGroupView,
  mode: GroupListMode,
  state: GroupListController,
  handlers: GroupListHandlers,
  highlight = false,
): HTMLLIElement {
  const item = document.createElement('li')
  item.className = mode === 'compact' ? 'group-row group-row-compact' : 'group-row'
  if (highlight) item.classList.add('group-row-renamed')
  item.dataset.groupId = String(group.id)

  const swatchWrap = document.createElement('div')
  swatchWrap.className = 'swatch-wrap'

  const swatch = document.createElement('button')
  swatch.type = 'button'
  swatch.className = 'swatch'
  swatch.title = group.editable ? `Color: ${group.color}` : 'Shared group'
  swatch.setAttribute(
    'aria-label',
    group.editable
      ? `Change color for ${group.title || 'untitled group'}`
      : `Color for ${group.title || 'untitled group'}`,
  )
  swatch.style.background = TAB_GROUP_COLOR_HEX[group.color]
  swatch.disabled = !group.editable || mode === 'compact'
  if (group.editable && mode === 'manage') {
    swatch.addEventListener('click', (event) => {
      event.stopPropagation()
      handlers.onTogglePicker(state.openPickerId === group.id ? null : group.id)
    })
  }
  swatchWrap.append(swatch)

  if (mode === 'manage' && state.openPickerId === group.id && group.editable) {
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

  const main = document.createElement('div')
  main.className = 'group-main'

  if (mode === 'manage' && group.editable) {
    const title = document.createElement('input')
    title.className = 'group-title'
    title.type = 'text'
    title.value = group.title
    title.placeholder = 'Untitled group'
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
    main.append(title)
  } else {
    const title = document.createElement('p')
    title.className = 'group-title-text'
    title.textContent = group.title || 'Untitled group'
    main.append(title)
  }

  const meta = document.createElement('p')
  meta.className = 'group-meta'
  meta.textContent = metaLine(group, mode)
  main.append(meta)

  const actions = document.createElement('div')
  actions.className = 'group-actions'

  if (group.editable) {
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
      cancel.className = 'ghost'
      cancel.textContent = 'Cancel'
      cancel.addEventListener('click', (event) => {
        event.stopPropagation()
        handlers.onCancelUngroup()
      })
      actions.append(confirm, cancel)
    } else {
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
  }

  item.append(swatchWrap, main, actions)
  return item
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
