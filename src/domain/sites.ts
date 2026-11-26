import { getDomain } from 'tldts'
import { CHROME_COLORS, type ChromeColor } from './types.js'

const ALIASES: Record<string, string> = {
  github: 'github.com',
  youtube: 'youtube.com',
  amazon: 'amazon.com',
  ebay: 'ebay.com',
  reddit: 'reddit.com',
  google: 'google.com',
  wikipedia: 'wikipedia.org',
  nytimes: 'nytimes.com',
}

const DISPLAY: Record<string, string> = {
  'github.com': 'GitHub',
  // Shared bucket for *.github.io (tldts eTLD+1 without private domains).
  // Distinct from github.com — do not collapse Pages into the main site.
  'github.io': 'GitHub Pages',
  'youtube.com': 'YouTube',
  'amazon.com': 'Amazon',
  'ebay.com': 'eBay',
  'reddit.com': 'Reddit',
  'google.com': 'Google',
  'wikipedia.org': 'Wikipedia',
  'nytimes.com': 'New York Times',
  localhost: 'Local',
}

/** Loopback hosts that share one filing key (`localhost`) and title (`Local`). */
export function isLoopbackHost(host: string): boolean {
  const cleaned = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return cleaned === 'localhost' || cleaned === '127.0.0.1' || cleaned === '::1'
}

/** Loopback / literal IP hosts that tldts does not treat as registrable domains. */
export function isLocalHost(host: string): boolean {
  const cleaned = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!cleaned) return false
  if (isLoopbackHost(cleaned)) return true
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(cleaned)
}

/**
 * Registrable site key for a host or URL.
 * Ordinary sites use the eTLD+1. Localhost and IP literals keep the hostname
 * (tldts returns null for those, and undotted hosts used to become '').
 */
export function registrableDomain(hostOrUrl: string): string {
  const trimmed = hostOrUrl.trim().toLowerCase()
  if (!trimmed) return ''
  let host = trimmed
  try {
    if (trimmed.includes('://')) host = new URL(trimmed).hostname
  } catch {
    return ''
  }
  host = host.replace(/\.$/, '').replace(/^www\./, '')
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (!host || host.includes(' ')) return ''
  if (isLocalHost(host)) return host
  if (!host.includes('.')) return ''
  return getDomain(host) ?? host
}

/**
 * Site key used for filing.
 * All loopback tabs (localhost / 127.0.0.1 / ::1, any port) share `localhost`.
 * Other literal IPs keep host:port when a non-default port is present.
 */
export function siteDomainFromUrl(url: URL): string {
  const domain = registrableDomain(url.hostname)
  if (!domain) return ''
  if (isLoopbackHost(domain)) return 'localhost'
  if (isLocalHost(domain) && url.port) return `${domain}:${url.port}`
  return domain
}

/** A site named in a rule: an alias such as "github", or a dotted host. */
export function canonicalSite(token: string): string | null {
  const cleaned = token
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
  if (!cleaned) return null
  if (!cleaned.includes('.')) return ALIASES[cleaned] ?? null
  const domain = getDomain(cleaned) ?? cleaned
  if (!domain.includes('.')) return null
  return domain
}

/** True when a filing key is the shared loopback bucket (or a legacy loopback host). */
export function isLoopbackFilingKey(domain: string | null | undefined): boolean {
  if (!domain) return false
  const host = domain.replace(/:(\d+)$/, '').replace(/^\[|\]$/g, '')
  return domain === 'localhost' || isLoopbackHost(domain) || isLoopbackHost(host)
}

/**
 * Titles produced by the old `split('.')[0]` rule (or host:port filing) for loopback.
 * Organize should rename these to Local when the group is loopback-dominated.
 */
export function isStaleLoopbackGroupTitle(title: string): boolean {
  const cleaned = title.trim().toLowerCase()
  if (!cleaned || cleaned === 'local') return false
  if (cleaned === '127' || cleaned === 'localhost') return true
  const host = cleaned.replace(/^\[|\]$/g, '').replace(/:(\d+)$/, '')
  return isLoopbackHost(host)
}

/** Case-insensitive group-title compare for filing / dedupe. */
export function titlesMatch(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

/**
 * Site key implied by an auto site-group title (e.g. "Capitaloneshopping" →
 * capitaloneshopping.com, "Google" → google.com). Multi-word thematic titles
 * return null so topic groups are not treated as site buckets.
 *
 * Used to detect the solo-redirect hole: after the only tab navigates away,
 * live dominantDomain flips to the new site while the title still names the old
 * one — filing must not treat that group as the new site.
 */
export function domainImpliedBySiteTitle(title: string): string | null {
  const cleaned = title.trim()
  if (!cleaned) return null
  for (const [domain, label] of Object.entries(DISPLAY)) {
    if (titlesMatch(label, cleaned)) return domain
  }
  if (/\s/.test(cleaned)) return null
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(cleaned)) return null
  const label = cleaned.toLowerCase()
  // Pure numeric leftovers ("127") are stale loopback labels, not site keys.
  if (/^\d+$/.test(label)) return null
  for (const tld of ['.com', '.org', '.net', '.io'] as const) {
    const guess = `${label}${tld}`
    if (titlesMatch(siteTitle(guess), cleaned)) return guess
  }
  return null
}

/**
 * True when the group title clearly names a different site than `domain`.
 * Stale/legacy titles for this domain (Github→GitHub Pages, 127→Local) are
 * retitle targets, not mismatches — do not move tabs out for those.
 */
export function groupTitleConflictsWithDomain(title: string, domain: string): boolean {
  if (preferredSiteGroupTitle(domain, title) !== null) return false
  if (isLoopbackFilingKey(domain) && isStaleLoopbackGroupTitle(title)) return false
  const implied = domainImpliedBySiteTitle(title)
  if (!implied) return false
  return !(domainCovered(domain, implied) || domainCovered(implied, domain))
}

/**
 * True when the filing key has a stable product/site label (DISPLAY map or loopback).
 * Homogeneous groups for these sites should stay site-named, not thematic.
 */
export function hasStableSiteDisplay(domain: string | null | undefined): boolean {
  if (!domain) return false
  if (domain in DISPLAY) return true
  const host = domain.replace(/:(\d+)$/, '')
  return isLoopbackFilingKey(domain) || isLoopbackFilingKey(host)
}

/**
 * Canonical title to apply on Organize when a site group's label drifted
 * (case variants, old "Github" for github.io, or AI themes like "DevOps Skills").
 * Returns null when the current title should be left alone.
 */
export function preferredSiteGroupTitle(
  domain: string | null | undefined,
  title: string,
): string | null {
  if (!domain) return null
  const wanted = siteTitle(domain)
  const current = title.trim()
  if (!wanted || !current || current === wanted) return null
  if (titlesMatch(current, wanted)) return wanted
  // Pre-DISPLAY github.io used split('.')[0] → "Github".
  if (domain === 'github.io' && current.toLowerCase() === 'github') return wanted
  // Known product/site buckets: restore when a theme overwrote the site name.
  if (hasStableSiteDisplay(domain)) return wanted
  return null
}

export function siteTitle(domain: string): string {
  const known = DISPLAY[domain]
  if (known) return known
  const host = domain.replace(/:(\d+)$/, '')
  // Loopback filing keys (and legacy host:port keys) always title as Local.
  // Never emit "127" from domain.split('.')[0] on 127.0.0.1.
  if (isLoopbackFilingKey(domain) || isLoopbackFilingKey(host)) return 'Local'
  // Keep host:port (and bare IPs) readable — do not truncate 10.0.0.1 to "10".
  if (isLocalHost(host) || isLocalHost(domain)) return domain
  const label = domain.split('.')[0] ?? domain
  if (!label) return domain
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function colorForKey(key: string): ChromeColor {
  let hash = 0
  for (const char of key) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
  return CHROME_COLORS[hash % CHROME_COLORS.length] ?? 'grey'
}

export function domainCovered(tabDomain: string, ruleDomain: string): boolean {
  return tabDomain === ruleDomain || tabDomain.endsWith(`.${ruleDomain}`)
}
