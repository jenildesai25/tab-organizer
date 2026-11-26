import type { FeatureCard } from './types.js'
import { domainCovered, hasStableSiteDisplay, siteTitle, titlesMatch } from './sites.js'

/** Dominant site share at or above this → treat the group as a single-site cluster. */
export const SITE_RETITLE_DOMINANCE = 0.8

export type DominantSite = {
  domain: string
  share: number
  count: number
  total: number
}

export type SiteRetitleDecision =
  | { kind: 'skip'; reason: string; domain: string; siteTitle: string }
  | { kind: 'use-site'; title: string; domain: string; reason: string }
  | { kind: 'ask-model' }

export type SiteRetitleRule = { domains: string[] }

/** Count filing keys among feature cards (empty domains ignored). */
export function dominantSiteFromCards(cards: ReadonlyArray<Pick<FeatureCard, 'domain'>>): DominantSite | null {
  const counts = new Map<string, number>()
  let total = 0
  for (const card of cards) {
    const domain = card.domain.trim().toLowerCase()
    if (!domain) continue
    total += 1
    counts.set(domain, (counts.get(domain) ?? 0) + 1)
  }
  if (total === 0) return null
  let best: DominantSite | null = null
  for (const [domain, count] of counts) {
    const share = count / total
    if (!best || count > best.count) best = { domain, share, count, total }
  }
  return best
}

export function isHomogeneousSiteGroup(
  cards: ReadonlyArray<Pick<FeatureCard, 'domain'>>,
  threshold = SITE_RETITLE_DOMINANCE,
): boolean {
  const dominant = dominantSiteFromCards(cards)
  return dominant !== null && dominant.share >= threshold
}

function domainClaimedByRules(domain: string, rules: ReadonlyArray<SiteRetitleRule> | undefined): boolean {
  if (!rules || rules.length === 0) return false
  return rules.some((rule) => rule.domains.some((item) => domainCovered(domain, item)))
}

/**
 * Decide whether a rename pass should skip the model, force the canonical site
 * title, or ask the model. Homogeneous known sites never get thematic AI names.
 * User rules that claim the domain opt out of forced site titles.
 */
export function decideSiteRetitle(
  currentTitle: string,
  cards: ReadonlyArray<Pick<FeatureCard, 'domain'>>,
  options: { threshold?: number; rules?: ReadonlyArray<SiteRetitleRule> } = {},
): SiteRetitleDecision {
  const threshold = options.threshold ?? SITE_RETITLE_DOMINANCE
  const dominant = dominantSiteFromCards(cards)
  if (!dominant || dominant.share < threshold) return { kind: 'ask-model' }

  const canonical = siteTitle(dominant.domain)
  if (!canonical) return { kind: 'ask-model' }

  if (titlesMatch(currentTitle, canonical)) {
    return {
      kind: 'skip',
      reason: 'already clear',
      domain: dominant.domain,
      siteTitle: canonical,
    }
  }

  // A saved rule owns this site — do not overwrite "gb" with "GitHub".
  if (domainClaimedByRules(dominant.domain, options.rules)) return { kind: 'ask-model' }

  // Stable product/site buckets (GitHub, Amazon, Local, …): keep the site name.
  if (hasStableSiteDisplay(dominant.domain)) {
    return {
      kind: 'use-site',
      title: canonical,
      domain: dominant.domain,
      reason: 'site title',
    }
  }

  // Other homogeneous hosts: ask the model (reject path still guards themes).
  return { kind: 'ask-model' }
}

/**
 * Reject an AI suggestion that invents a theme for a clear single-site group.
 * Returns a skip reason, or null when the suggestion is acceptable.
 */
export function rejectRetitleSuggestion(
  currentTitle: string,
  suggested: string,
  cards: ReadonlyArray<Pick<FeatureCard, 'domain'>>,
  options: { threshold?: number; rules?: ReadonlyArray<SiteRetitleRule> } = {},
): string | null {
  const threshold = options.threshold ?? SITE_RETITLE_DOMINANCE
  const dominant = dominantSiteFromCards(cards)
  if (!dominant || dominant.share < threshold) return null
  if (domainClaimedByRules(dominant.domain, options.rules)) return null

  const canonical = siteTitle(dominant.domain)
  if (!canonical) return null
  if (titlesMatch(suggested, canonical)) return null
  if (titlesMatch(suggested, currentTitle)) return null

  // Clear site identity: do not accept "DevOps Skills" for github.com, etc.
  if (hasStableSiteDisplay(dominant.domain)) return 'not site title'
  if (titlesMatch(currentTitle, canonical)) return 'not site title'
  return null
}
