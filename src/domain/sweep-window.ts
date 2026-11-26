import type { ChromeTabLike } from './chrome-tab.js'
import { countHttpTabs } from './sweep-chrome.js'

export type WindowLike = {
  id?: number
  incognito?: boolean
  type?: string
}

/**
 * Pick a normal window that actually has http(s) tabs to organize.
 * Prefer the requested / last-focused window when it qualifies; otherwise the
 * largest normal window with http tabs (so Organize works from chrome://extensions
 * even if that page sits in a chrome-only window).
 */
export function pickSweepWindowId(
  requestedId: number | null | undefined,
  windows: WindowLike[],
  tabsByWindow: Map<number, ChromeTabLike[]>,
): number | null {
  const normal = windows.filter(
    (win) => win.id != null && !win.incognito && (win.type === undefined || win.type === 'normal'),
  )
  if (normal.length === 0) return null

  const httpCount = (id: number): number => countHttpTabs(tabsByWindow.get(id) ?? [])

  if (requestedId != null) {
    const requested = normal.find((win) => win.id === requestedId)
    if (requested?.id != null && httpCount(requested.id) > 0) return requested.id
  }

  let bestId: number | null = null
  let bestCount = 0
  for (const win of normal) {
    if (win.id == null) continue
    const count = httpCount(win.id)
    if (count > bestCount) {
      bestCount = count
      bestId = win.id
    }
  }
  if (bestId != null) return bestId
  return requestedId ?? normal[0]?.id ?? null
}
