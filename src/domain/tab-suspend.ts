import { isHttpUrl } from './feature-card.js'
import { registrableDomain } from './sites.js'

/** chrome.alarms name for the periodic discard sweep. */
export const SUSPEND_ALARM_NAME = 'tab-suspend-sweep'

/** How often the service worker wakes to scan for idle tabs (minutes). */
export const SUSPEND_ALARM_PERIOD_MINUTES = 1

/** Default idle time before an inactive tab may be discarded. */
export const DEFAULT_IDLE_MINUTES = 30

export const MIN_IDLE_MINUTES = 5
export const MAX_IDLE_MINUTES = 180

/** Fields needed to decide whether a tab may be discarded (no Chrome types). */
export type DiscardTabLike = {
  id?: number
  active?: boolean
  pinned?: boolean
  audible?: boolean
  discarded?: boolean
  incognito?: boolean
  /** Epoch ms when the tab was last activated; Chrome `Tab.lastAccessed`. */
  lastAccessed?: number
  url?: string
  pendingUrl?: string
}

export type DiscardSkipReason =
  | 'no-id'
  | 'incognito'
  | 'active'
  | 'pinned'
  | 'audible'
  | 'already-discarded'
  | 'not-http'
  | 'never-list'
  | 'not-idle'

export type DiscardEligibility = {
  ok: boolean
  reason?: DiscardSkipReason
  siteKey?: string
}

export function clampIdleMinutes(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return DEFAULT_IDLE_MINUTES
  return Math.min(MAX_IDLE_MINUTES, Math.max(MIN_IDLE_MINUTES, Math.round(n)))
}

/** Normalize user-entered hosts into registrable site keys; drop empties; unique. */
export function normalizeNeverDomains(raw: unknown): string[] {
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

function resolveHttpUrl(tab: Pick<DiscardTabLike, 'url' | 'pendingUrl'>): string {
  const url = (tab.url || '').trim()
  const pending = (tab.pendingUrl || '').trim()
  if (isHttpUrl(url)) return url
  if (isHttpUrl(pending)) return pending
  return ''
}

export function siteKeyForTab(tab: Pick<DiscardTabLike, 'url' | 'pendingUrl'>): string {
  const http = resolveHttpUrl(tab)
  if (!http) return ''
  return registrableDomain(http)
}

/**
 * Pure eligibility for native `chrome.tabs.discard`.
 * Skips pinned, audible, active, non-http(s), already discarded, never-list, and not-yet-idle tabs.
 */
export function discardEligibility(
  tab: DiscardTabLike,
  options: {
    now: number
    idleMinutes: number
    neverDomains: readonly string[]
  },
): DiscardEligibility {
  if (tab.id == null) return { ok: false, reason: 'no-id' }
  if (tab.incognito === true) return { ok: false, reason: 'incognito' }
  if (tab.active === true) return { ok: false, reason: 'active' }
  if (tab.pinned === true) return { ok: false, reason: 'pinned' }
  if (tab.audible === true) return { ok: false, reason: 'audible' }
  if (tab.discarded === true) return { ok: false, reason: 'already-discarded' }

  const http = resolveHttpUrl(tab)
  if (!http) return { ok: false, reason: 'not-http' }

  const siteKey = registrableDomain(http)
  const never = new Set(options.neverDomains)
  if (siteKey && never.has(siteKey)) return { ok: false, reason: 'never-list', siteKey }

  const idleMs = clampIdleMinutes(options.idleMinutes) * 60_000
  const lastAccessed = typeof tab.lastAccessed === 'number' ? tab.lastAccessed : options.now
  if (options.now - lastAccessed < idleMs) {
    return { ok: false, reason: 'not-idle', siteKey: siteKey || undefined }
  }

  return { ok: true, siteKey: siteKey || undefined }
}

/** Tab ids that pass eligibility, in query order. */
export function selectDiscardTargets(
  tabs: readonly DiscardTabLike[],
  options: {
    now: number
    idleMinutes: number
    neverDomains: readonly string[]
  },
): number[] {
  const ids: number[] = []
  for (const tab of tabs) {
    const result = discardEligibility(tab, options)
    if (result.ok && tab.id != null) ids.push(tab.id)
  }
  return ids
}
