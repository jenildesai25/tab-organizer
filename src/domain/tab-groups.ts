import { CHROME_COLORS, type ChromeColor } from './types.js'

/** Chrome tabGroups.Color values in the order the picker should show them. */
export const TAB_GROUP_COLORS = CHROME_COLORS

export type ChromeTabGroupLike = {
  id: number
  title?: string
  color?: string
  collapsed?: boolean
  shared?: boolean
}

export type TabGroupView = {
  id: number
  title: string
  color: ChromeColor
  collapsed: boolean
  shared: boolean
  tabCount: number
  /** Shared groups cannot be renamed, recoloured, or ungrouped from the dashboard. */
  editable: boolean
}

/** Approximate chip colours matching Chrome’s tab-group swatches. */
export const TAB_GROUP_COLOR_HEX: Record<ChromeColor, string> = {
  grey: '#5f6368',
  blue: '#1a73e8',
  red: '#d93025',
  yellow: '#f9ab00',
  green: '#188038',
  pink: '#d01884',
  purple: '#a142f4',
  cyan: '#007b83',
  orange: '#fa903e',
}

export function isChromeColor(value: string | undefined): value is ChromeColor {
  return TAB_GROUP_COLORS.includes(value as ChromeColor)
}

export function normalizeGroupColor(color: string | undefined): ChromeColor {
  return isChromeColor(color) ? color : 'grey'
}

export function countTabsInGroup(
  groupId: number,
  tabs: ReadonlyArray<{ groupId?: number | null }>,
): number {
  return tabs.filter((tab) => tab.groupId === groupId).length
}

/** Map a chrome.tabGroups entry (+ window tabs) into the dashboard view model. */
export function tabGroupViewFromChrome(
  group: ChromeTabGroupLike,
  tabs: ReadonlyArray<{ groupId?: number | null }>,
): TabGroupView {
  const shared = group.shared === true
  return {
    id: group.id,
    title: group.title ?? '',
    color: normalizeGroupColor(group.color),
    collapsed: group.collapsed === true,
    shared,
    tabCount: countTabsInGroup(group.id, tabs),
    editable: !shared,
  }
}

export function tabGroupViewsFromChrome(
  groups: ReadonlyArray<ChromeTabGroupLike>,
  tabs: ReadonlyArray<{ groupId?: number | null }>,
): TabGroupView[] {
  return [...groups]
    .map((group) => tabGroupViewFromChrome(group, tabs))
    .sort((left, right) => left.id - right.id)
}
