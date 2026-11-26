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
  'youtube.com': 'YouTube',
  'amazon.com': 'Amazon',
  'ebay.com': 'eBay',
  'reddit.com': 'Reddit',
  'google.com': 'Google',
  'wikipedia.org': 'Wikipedia',
  'nytimes.com': 'New York Times',
}

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
  if (!host || host.includes(' ') || !host.includes('.')) return ''
  return getDomain(host) ?? host
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

export function siteTitle(domain: string): string {
  const known = DISPLAY[domain]
  if (known) return known
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
