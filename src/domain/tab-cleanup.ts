import { isHttpUrl } from './feature-card.js'
import { normalizeGroupId } from './chrome-tab.js'
import { registrableDomain } from './sites.js'

/** chrome.alarms name for the periodic old-tab cleanup sweep. */
export const CLEANUP_ALARM_NAME = 'tab-cleanup-sweep'

/**
 * How often the service worker wakes to scan for old tabs (minutes).
 * Age thresholds are in days, so hourly is enough — avoid long setTimeout in the SW.
 */
export const CLEANUP_ALARM_PERIOD_MINUTES = 60

/** Default “haven’t used in …” threshold. */
export const DEFAULT_CLEANUP_AGE_DAYS = 30

export const MIN_CLEANUP_AGE_DAYS = 1
export const MAX_CLEANUP_AGE_DAYS = 365

/** Preset chips in Settings (custom days still allowed). */
export const CLEANUP_AGE_PRESETS = [7, 30, 90] as const

/**
 * Scope documentation (enforced in background, not this pure module):
 * - Manual “Clean up now”: current (focused) normal window only.
 * - Auto alarm: all normal (non-incognito) windows.
 */

export type CleanupTabLike = {
  id?: number
  active?: boolean
  pinned?: boolean
  audible?: boolean
  incognito?: boolean
  /** Epoch ms when the tab was last activated; Chrome `Tab.lastAccessed`. */
  lastAccessed?: number
  url?: string
  pendingUrl?: string
  groupId?: number
}

export type ProtectLists = {
  /** Registrable domains that must never be auto-closed. */
  domains: string[]
  /** Chrome tab group IDs that must never be auto-closed (pruned when groups go away). */
  groupIds: number[]
  /**
   * Durable page protections: origin + pathname (no query/hash).
   * Prefer these over raw tab IDs — tab IDs do not survive Chrome restarts.
   */
  urlPatterns: string[]
}

export type CleanupSkipReason =
  | 'no-id'
  | 'incognito'
  | 'active'
  | 'pinned'
  | 'audible'
  | 'not-http'
  | 'protected-domain'
  | 'protected-group'
  | 'protected-url'
  | 'not-old'

export type CleanupEligibility = {
  ok: boolean
  reason?: CleanupSkipReason
  siteKey?: string
  urlPattern?: string
}

export function clampCleanupAgeDays(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return DEFAULT_CLEANUP_AGE_DAYS
  return Math.min(MAX_CLEANUP_AGE_DAYS, Math.max(MIN_CLEANUP_AGE_DAYS, Math.round(n)))
}

/** Normalize user-entered hosts into registrable site keys; drop empties; unique. */
export function normalizeProtectDomains(raw: unknown): string[] {
  if (!Array.isArray(raw) && typeof raw !== 'string') return []
  const tokens =
    typeof raw === 'string'
      ? raw.split(/[\s,]+/)
      : raw.flatMap((item) => (typeof item === 'string' ? item.split(/[\s,]+/) : []))
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of tokens) {
    const trimmed = token.trim().toLowerCase()
    if (!trimmed) continue
    const key = registrableDomain(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

/** Positive integer group IDs only; unique; order preserved. */
export function normalizeProtectGroupIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<number>()
  const out: number[] = []
  for (const item of raw) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0) continue
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

/**
 * Normalize a URL (or host) into a durable page pattern: origin + pathname,
 * trailing slash stripped except for `/`. Drops query and hash.
 */
export function normalizeUrlPattern(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    let path = url.pathname || '/'
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
    return `${url.origin}${path}`
  } catch {
    return null
  }
}

export function normalizeProtectUrlPatterns(raw: unknown): string[] {
  if (!Array.isArray(raw) && typeof raw !== 'string') return []
  const tokens =
    typeof raw === 'string'
      ? raw.split(/[\n,]+/)
      : raw.flatMap((item) => (typeof item === 'string' ? [item] : []))
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of tokens) {
    const pattern = normalizeUrlPattern(token)
    if (!pattern || seen.has(pattern)) continue
    seen.add(pattern)
    out.push(pattern)
  }
  return out
}

export function parseProtectLists(partial: {
  domains?: unknown
  groupIds?: unknown
  urlPatterns?: unknown
}): ProtectLists {
  return {
    domains: normalizeProtectDomains(partial.domains),
    groupIds: normalizeProtectGroupIds(partial.groupIds),
    urlPatterns: normalizeProtectUrlPatterns(partial.urlPatterns),
  }
}

/** Drop group IDs that are no longer live Chrome tab groups. */
export function pruneProtectGroupIds(
  stored: readonly number[],
  liveGroupIds: ReadonlySet<number>,
): number[] {
  return stored.filter((id) => liveGroupIds.has(id))
}

function resolveHttpUrl(tab: Pick<CleanupTabLike, 'url' | 'pendingUrl'>): string {
  const url = (tab.url || '').trim()
  const pending = (tab.pendingUrl || '').trim()
  if (isHttpUrl(url)) return url
  if (isHttpUrl(pending)) return pending
  return ''
}

export function siteKeyForCleanupTab(tab: Pick<CleanupTabLike, 'url' | 'pendingUrl'>): string {
  const http = resolveHttpUrl(tab)
  if (!http) return ''
  return registrableDomain(http)
}

export function urlPatternForCleanupTab(tab: Pick<CleanupTabLike, 'url' | 'pendingUrl'>): string {
  const http = resolveHttpUrl(tab)
  if (!http) return ''
  return normalizeUrlPattern(http) ?? ''
}

/** True when the tab’s URL matches a protected page pattern (exact or under that path). */
export function urlMatchesProtectPattern(tabUrl: string, pattern: string): boolean {
  const normalizedTab = normalizeUrlPattern(tabUrl)
  if (!normalizedTab || !pattern) return false
  if (normalizedTab === pattern) return true
  // Path prefix: pattern `/foo` matches `/foo/bar` but not `/foobar`.
  if (pattern.endsWith('/')) return normalizedTab.startsWith(pattern)
  return normalizedTab.startsWith(`${pattern}/`)
}

/**
 * Pure eligibility for closing an unused tab.
 * Always skips pinned, active, audible, non-http(s), protected, and not-yet-old tabs.
 */
export function cleanupEligibility(
  tab: CleanupTabLike,
  options: {
    now: number
    ageDays: number
    protect: ProtectLists
  },
): CleanupEligibility {
  if (tab.id == null) return { ok: false, reason: 'no-id' }
  if (tab.incognito === true) return { ok: false, reason: 'incognito' }
  if (tab.active === true) return { ok: false, reason: 'active' }
  if (tab.pinned === true) return { ok: false, reason: 'pinned' }
  if (tab.audible === true) return { ok: false, reason: 'audible' }

  const http = resolveHttpUrl(tab)
  if (!http) return { ok: false, reason: 'not-http' }

  const siteKey = registrableDomain(http)
  const urlPattern = normalizeUrlPattern(http) ?? ''
  const domains = new Set(options.protect.domains)
  if (siteKey && domains.has(siteKey)) {
    return { ok: false, reason: 'protected-domain', siteKey, urlPattern: urlPattern || undefined }
  }

  const groupId = normalizeGroupId(tab.groupId)
  if (groupId != null && options.protect.groupIds.includes(groupId)) {
    return { ok: false, reason: 'protected-group', siteKey: siteKey || undefined, urlPattern: urlPattern || undefined }
  }

  for (const pattern of options.protect.urlPatterns) {
    if (urlMatchesProtectPattern(http, pattern)) {
      return {
        ok: false,
        reason: 'protected-url',
        siteKey: siteKey || undefined,
        urlPattern: urlPattern || undefined,
      }
    }
  }

  const ageMs = clampCleanupAgeDays(options.ageDays) * 24 * 60 * 60_000
  const lastAccessed = typeof tab.lastAccessed === 'number' ? tab.lastAccessed : options.now
  if (options.now - lastAccessed < ageMs) {
    return { ok: false, reason: 'not-old', siteKey: siteKey || undefined, urlPattern: urlPattern || undefined }
  }

  return { ok: true, siteKey: siteKey || undefined, urlPattern: urlPattern || undefined }
}

export type CleanupCandidate = {
  tabId: number
  siteKey?: string
  urlPattern?: string
}

/** Eligible close targets in query order. */
export function selectCleanupTargets(
  tabs: readonly CleanupTabLike[],
  options: {
    now: number
    ageDays: number
    protect: ProtectLists
  },
): CleanupCandidate[] {
  const out: CleanupCandidate[] = []
  for (const tab of tabs) {
    const result = cleanupEligibility(tab, options)
    if (result.ok && tab.id != null) {
      out.push({
        tabId: tab.id,
        siteKey: result.siteKey,
        urlPattern: result.urlPattern,
      })
    }
  }
  return out
}

/** Plain-English age label for UI copy. */
export function formatCleanupAgeLabel(days: number): string {
  const n = clampCleanupAgeDays(days)
  return n === 1 ? '1 day' : `${n} days`
}
