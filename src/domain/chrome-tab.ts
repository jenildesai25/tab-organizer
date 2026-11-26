import { buildFeatureCard, isHttpUrl } from './feature-card.js'
import type { FeatureCard } from './types.js'

/** Fields we read from chrome.tabs.Tab without importing the Chrome namespace. */
export type ChromeTabLike = {
  id?: number
  url?: string
  pendingUrl?: string
  favIconUrl?: string
  title?: string
  pinned?: boolean
  discarded?: boolean
  status?: string
  groupId?: number
  active?: boolean
  incognito?: boolean
  openerTabId?: number
}

export type TabClass = 'http' | 'browser' | 'pinned' | 'unknown'

/**
 * about:blank, about:blank#blocked, about:srcdoc, … — Chrome placeholders, not
 * real browser chrome pages. Exact "about:blank" matching was too narrow and
 * marked restored tabs as browser pages (Skipped 80 on an 82-tab window).
 */
export function isAboutPlaceholder(url: string): boolean {
  const trimmed = url.trim().toLowerCase()
  return trimmed === 'about:blank' || trimmed.startsWith('about:')
}

/** Pull an http(s) URL out of suspender hashes, query params, or favicon URLs. */
export function extractEmbeddedHttpUrl(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  if (isHttpUrl(text)) return text

  const hashIdx = text.indexOf('#')
  if (hashIdx >= 0) {
    const frag = safeDecode(text.slice(hashIdx + 1).replace(/^!/, ''))
    const fromFrag = findHttpUrl(frag)
    if (fromFrag) return fromFrag
    if (isHttpUrl(frag)) return frag
  }

  try {
    const parsed = new URL(text)
    for (const key of ['url', 'uri', 'pageUrl', 'page', 'src']) {
      const value = parsed.searchParams.get(key)
      if (!value) continue
      const decoded = safeDecode(value)
      if (isHttpUrl(decoded)) return decoded
      const nested = findHttpUrl(decoded)
      if (nested) return nested
    }
    const fromPath = findHttpUrl(`${parsed.pathname}${parsed.search}${parsed.hash}`)
    if (fromPath) return fromPath
  } catch {
    // Not an absolute URL — fall through to a raw scan.
  }

  return findHttpUrl(text)
}

function findHttpUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>\\]+/i)
  if (!match?.[0]) return null
  let candidate = match[0].replace(/[),.;]+$/g, '')
  candidate = safeDecode(candidate)
  return isHttpUrl(candidate) ? candidate : null
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Prefer a real http(s) address when Chrome leaves url as about:blank (or another
 * non-http placeholder) while pendingUrl still carries the page being restored.
 * Also recovers https from tab-suspender chrome-extension:// URLs and favicon URLs.
 */
export function resolveTabUrl(tab: Pick<ChromeTabLike, 'url' | 'pendingUrl' | 'favIconUrl'>): string {
  const url = (tab.url || '').trim()
  const pending = (tab.pendingUrl || '').trim()
  const fromUrl = extractEmbeddedHttpUrl(url)
  const fromPending = extractEmbeddedHttpUrl(pending)
  const fromFav = tab.favIconUrl ? extractEmbeddedHttpUrl(tab.favIconUrl) : null

  if (fromPending && (!url || !isHttpUrl(url) || isAboutPlaceholder(url) || !fromUrl)) return fromPending
  if (fromUrl) return fromUrl
  if (fromPending) return fromPending
  if (fromFav) return fromFav
  if (url && !isAboutPlaceholder(url)) return url
  if (pending && !isAboutPlaceholder(pending)) return pending
  if (url) return url
  return pending
}

/**
 * Classify a Chrome tab for the sweep summary and eligibility.
 * Empty url+pendingUrl and any about: placeholder are "unknown", not browser pages —
 * Chrome often hides or blanks urls for discarded / session-restored tabs.
 */
export function classifyChromeTab(
  tab: Pick<ChromeTabLike, 'url' | 'pendingUrl' | 'favIconUrl' | 'pinned'>,
): TabClass {
  if (tab.pinned === true) return 'pinned'
  const url = resolveTabUrl(tab)
  if (!url || isAboutPlaceholder(url)) return 'unknown'
  if (isHttpUrl(url)) return 'http'
  return 'browser'
}

export function chromeTabSnapshot(
  tab: ChromeTabLike,
  opener?: Pick<ChromeTabLike, 'url' | 'pendingUrl' | 'favIconUrl'> | null,
): {
  url: string
  kind: TabClass
  http: boolean
  browserPage: boolean
  card: FeatureCard
} {
  const url = resolveTabUrl(tab)
  const kind = classifyChromeTab(tab)
  return {
    url,
    kind,
    http: kind === 'http',
    browserPage: kind === 'browser',
    card: buildFeatureCard({
      url,
      title: tab.title || '',
      openerUrl: opener ? resolveTabUrl(opener) || null : null,
    }),
  }
}

/** Chrome uses -1 (TAB_GROUP_ID_NONE) for ungrouped tabs. */
export function normalizeGroupId(groupId: number | undefined | null, noneId = -1): number | null {
  if (groupId == null || groupId === noneId || groupId < 0) return null
  return groupId
}
