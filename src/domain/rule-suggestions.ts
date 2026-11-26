import { canonicalSite, siteTitle, titlesMatch } from './sites.js'
import { isShortTitle } from './words.js'
import type { CompiledRule } from './types.js'

export const RULE_SUGGESTIONS_KEY = 'ruleSuggestions'
export const RULE_SUGGESTION_THRESHOLD = 2
export const MAX_RULE_SUGGESTIONS = 20

export type RuleSuggestionVote = {
  domain: string
  title: string
  count: number
  updatedAt: number
}

export type RuleSuggestion = RuleSuggestionVote & {
  id: string
  sentence: string
}

export function suggestionId(domain: string, title: string): string {
  return `${domain.toLowerCase()}::${title.trim().toLowerCase()}`
}

/** Plain-language sentence the local compiler understands. */
export function suggestionSentence(domain: string, title: string): string | null {
  const site = canonicalSite(domain)
  const name = title.trim()
  if (!site || !isShortTitle(name)) return null
  const host = site.replace(/\.com$/i, '')
  return `use ${name} for ${host}`
}

export function parseRuleSuggestionVotes(raw: unknown): RuleSuggestionVote[] {
  if (!Array.isArray(raw)) return []
  const out: RuleSuggestionVote[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const domain = typeof row.domain === 'string' ? canonicalSite(row.domain) : null
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    const count = typeof row.count === 'number' && Number.isFinite(row.count) ? Math.max(0, Math.floor(row.count)) : 0
    const updatedAt =
      typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt) ? row.updatedAt : 0
    if (!domain || !title || count <= 0) continue
    out.push({ domain, title, count, updatedAt })
    if (out.length >= MAX_RULE_SUGGESTIONS * 2) break
  }
  return out
}

/** Record a hand rename when the group clearly belongs to one site. */
export function recordHandRenameVote(
  existing: readonly RuleSuggestionVote[],
  input: { domain: string; title: string; now?: number },
): RuleSuggestionVote[] {
  const domain = canonicalSite(input.domain)
  const title = input.title.trim()
  if (!domain || !isShortTitle(title)) return [...existing]
  const canonical = siteTitle(domain)
  if (canonical && titlesMatch(canonical, title)) return [...existing]
  const now = input.now ?? Date.now()
  const id = suggestionId(domain, title)
  let found = false
  const next = existing.map((row) => {
    if (suggestionId(row.domain, row.title) !== id) return row
    found = true
    return { ...row, count: row.count + 1, updatedAt: now }
  })
  if (!found) next.unshift({ domain, title, count: 1, updatedAt: now })
  return next
    .sort((left, right) => right.count - left.count || right.updatedAt - left.updatedAt)
    .slice(0, MAX_RULE_SUGGESTIONS * 2)
}

export function dismissRuleSuggestionVote(
  existing: readonly RuleSuggestionVote[],
  domain: string,
  title: string,
): RuleSuggestionVote[] {
  const id = suggestionId(domain, title)
  return existing.filter((row) => suggestionId(row.domain, row.title) !== id)
}

/** Votes that clear the threshold and are not already covered by a saved rule. */
export function readyRuleSuggestions(
  votes: readonly RuleSuggestionVote[],
  rules: readonly CompiledRule[],
  threshold = RULE_SUGGESTION_THRESHOLD,
): RuleSuggestion[] {
  const covered = new Set(
    rules.flatMap((rule) => rule.domains.map((domain) => domain.toLowerCase())),
  )
  const out: RuleSuggestion[] = []
  for (const vote of votes) {
    if (vote.count < threshold) continue
    if (covered.has(vote.domain.toLowerCase())) continue
    const sentence = suggestionSentence(vote.domain, vote.title)
    if (!sentence) continue
    out.push({
      ...vote,
      id: suggestionId(vote.domain, vote.title),
      sentence,
    })
    if (out.length >= MAX_RULE_SUGGESTIONS) break
  }
  return out
}
