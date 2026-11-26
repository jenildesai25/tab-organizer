import { normalizeUrlPattern, urlMatchesProtectPattern } from './tab-cleanup.js'
import { isChromeColor, normalizeGroupColor } from './tab-groups.js'
import type { ChromeColor } from './types.js'
import { registrableDomain } from './sites.js'

export const WORKSPACE_LAYOUTS_KEY = 'workspaceLayouts'
export const MAX_WORKSPACE_LAYOUTS = 12
export const MAX_LAYOUT_GROUPS = 24
export const MAX_LAYOUT_PATTERNS = 40
export const MAX_LAYOUT_NAME_LENGTH = 40

export type LayoutGroup = {
  title: string
  color: ChromeColor
  /** Origin + pathname patterns for pages that belonged in this group. */
  patterns: string[]
  /** Registrable domains seen in the group — used when a page URL changed path. */
  domains: string[]
}

export type WorkspaceLayout = {
  id: string
  name: string
  savedAt: number
  groups: LayoutGroup[]
}

export type LayoutTabLike = {
  id?: number
  url?: string
  pendingUrl?: string
  groupId?: number
}

export type LayoutGroupLike = {
  id: number
  title?: string
  color?: string
  shared?: boolean
}

export function clampLayoutName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_LAYOUT_NAME_LENGTH)
}

function resolveHttp(tab: Pick<LayoutTabLike, 'url' | 'pendingUrl'>): string {
  const url = (tab.url || '').trim()
  const pending = (tab.pendingUrl || '').trim()
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (pending.startsWith('http://') || pending.startsWith('https://')) return pending
  return ''
}

function uniqueStrings(values: readonly string[], cap: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
    if (out.length >= cap) break
  }
  return out
}

/** Capture non-shared groups in a window as a reusable layout. */
export function buildWorkspaceLayout(
  name: string,
  groups: readonly LayoutGroupLike[],
  tabs: readonly LayoutTabLike[],
  options: { id?: string; savedAt?: number } = {},
): WorkspaceLayout | null {
  const trimmed = clampLayoutName(name)
  if (!trimmed) return null
  const layoutGroups: LayoutGroup[] = []
  for (const group of groups) {
    if (group.shared === true) continue
    const title = (group.title || '').trim()
    if (!title) continue
    const members = tabs.filter((tab) => tab.groupId === group.id)
    const patterns: string[] = []
    const domains: string[] = []
    for (const tab of members) {
      const http = resolveHttp(tab)
      if (!http) continue
      const pattern = normalizeUrlPattern(http)
      if (pattern) patterns.push(pattern)
      const domain = registrableDomain(http)
      if (domain) domains.push(domain)
    }
    layoutGroups.push({
      title,
      color: normalizeGroupColor(group.color),
      patterns: uniqueStrings(patterns, MAX_LAYOUT_PATTERNS).sort(),
      domains: uniqueStrings(domains, MAX_LAYOUT_PATTERNS).sort(),
    })
    if (layoutGroups.length >= MAX_LAYOUT_GROUPS) break
  }
  if (layoutGroups.length === 0) return null
  return {
    id: options.id ?? crypto.randomUUID(),
    name: trimmed,
    savedAt: options.savedAt ?? Date.now(),
    groups: layoutGroups,
  }
}

export function parseWorkspaceLayouts(raw: unknown): WorkspaceLayout[] {
  if (!Array.isArray(raw)) return []
  const out: WorkspaceLayout[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const name = clampLayoutName(row.name)
    if (!name || typeof row.id !== 'string' || !row.id) continue
    const savedAt = typeof row.savedAt === 'number' && Number.isFinite(row.savedAt) ? row.savedAt : 0
    const groupsRaw = Array.isArray(row.groups) ? row.groups : []
    const groups: LayoutGroup[] = []
    for (const entry of groupsRaw) {
      if (!entry || typeof entry !== 'object') continue
      const group = entry as Record<string, unknown>
      const title = typeof group.title === 'string' ? group.title.trim() : ''
      if (!title) continue
      const patterns = Array.isArray(group.patterns)
        ? uniqueStrings(
            group.patterns
              .filter((value): value is string => typeof value === 'string')
              .map((value) => normalizeUrlPattern(value))
              .filter((value): value is string => Boolean(value)),
            MAX_LAYOUT_PATTERNS,
          )
        : []
      const domains = Array.isArray(group.domains)
        ? uniqueStrings(
            group.domains.filter((value): value is string => typeof value === 'string'),
            MAX_LAYOUT_PATTERNS,
          )
        : []
      const colorRaw = typeof group.color === 'string' ? group.color : ''
      groups.push({
        title,
        color: isChromeColor(colorRaw) ? colorRaw : 'grey',
        patterns,
        domains,
      })
      if (groups.length >= MAX_LAYOUT_GROUPS) break
    }
    if (groups.length === 0) continue
    out.push({ id: row.id, name, savedAt, groups })
    if (out.length >= MAX_WORKSPACE_LAYOUTS) break
  }
  return out
}

/** Upsert by id; newest-name save replaces same id. Cap total layouts. */
export function upsertWorkspaceLayout(
  existing: readonly WorkspaceLayout[],
  layout: WorkspaceLayout,
): WorkspaceLayout[] {
  const without = existing.filter((row) => row.id !== layout.id)
  return [layout, ...without].slice(0, MAX_WORKSPACE_LAYOUTS)
}

export function deleteWorkspaceLayout(
  existing: readonly WorkspaceLayout[],
  id: string,
): WorkspaceLayout[] {
  return existing.filter((row) => row.id !== id)
}

export type LayoutAssignment = {
  title: string
  color: ChromeColor
  tabIds: number[]
}

/**
 * Match open tabs to saved layout groups.
 * Prefer exact/prefix URL patterns; fall back to registrable domain when unique
 * across the layout. Each tab is claimed at most once (first matching group wins
 * by layout order).
 */
export function assignTabsToLayout(
  layout: WorkspaceLayout,
  tabs: readonly LayoutTabLike[],
): LayoutAssignment[] {
  const claimed = new Set<number>()
  const domainOwners = new Map<string, string>()
  for (const group of layout.groups) {
    for (const domain of group.domains) {
      if (domainOwners.has(domain)) domainOwners.set(domain, '')
      else domainOwners.set(domain, group.title)
    }
  }

  const assignments: LayoutAssignment[] = []
  for (const group of layout.groups) {
    const tabIds: number[] = []
    for (const tab of tabs) {
      if (tab.id == null || claimed.has(tab.id)) continue
      const http = resolveHttp(tab)
      if (!http) continue
      let match = group.patterns.some((pattern) => urlMatchesProtectPattern(http, pattern))
      if (!match) {
        const domain = registrableDomain(http)
        match = Boolean(domain && domainOwners.get(domain) === group.title && group.domains.includes(domain))
      }
      if (!match) continue
      claimed.add(tab.id)
      tabIds.push(tab.id)
    }
    if (tabIds.length === 0) continue
    assignments.push({ title: group.title, color: group.color, tabIds })
  }
  return assignments
}

export function formatLayoutSummary(layout: WorkspaceLayout): string {
  const groups = layout.groups.length
  const noun = groups === 1 ? 'group' : 'groups'
  return `${layout.name} · ${groups} ${noun}`
}
