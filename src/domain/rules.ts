import { colorForKey, canonicalSite, domainCovered, titlesMatch } from './sites.js'
import type { CompiledRule, GroupState, RetitleAction } from './types.js'
import { isShortTitle } from './words.js'

const USE = /^use\s+(.+?)\s+for\s+(.+)$/i
const CALL = /^(?:call|name)\s+(\S+)\s+(.+)$/i
const PUT = /^put\s+(.+?)\s+in\s+(.+)$/i

export type DraftRule = {
  sentence: string
  domains: string[]
  title: string
}

export type RuleLoss = {
  id: string
  title: string
  domains: string[]
}

export function describeRule(domains: string[], title: string): string {
  if (domains.length === 1) {
    return `Tabs on ${domains[0]} and its subdomains go in a group titled ${title}.`
  }
  return `Tabs on ${domains.join(' and ')} go in a group titled ${title}.`
}

export function compileSentence(sentence: string): DraftRule | null {
  const text = sentence.trim().replace(/\s+/g, ' ')
  if (!text) return null

  const use = USE.exec(text)
  if (use) {
    const title = use[1]?.trim() ?? ''
    const site = use[2]?.trim() ?? ''
    return finish(text, title, [site])
  }

  const call = CALL.exec(text)
  if (call) {
    const site = call[1]?.trim() ?? ''
    const title = call[2]?.trim() ?? ''
    return finish(text, title, [site])
  }

  const put = PUT.exec(text)
  if (put) {
    const sites = (put[1] ?? '')
      .split(/,|\band\b/i)
      .map((part) => part.trim())
      .filter(Boolean)
    const title = put[2]?.trim() ?? ''
    return finish(text, title, sites)
  }

  return null
}

function finish(sentence: string, title: string, sites: string[]): DraftRule | null {
  if (!isShortTitle(title) || sites.length === 0) return null
  const domains: string[] = []
  for (const site of sites) {
    const domain = canonicalSite(site)
    if (!domain || domains.includes(domain)) return null
    domains.push(domain)
  }
  return { sentence, domains, title }
}

export function claimRule(
  existing: CompiledRule[],
  incoming: CompiledRule,
): { rules: CompiledRule[]; losses: RuleLoss[]; confirmation: string } {
  const losses: RuleLoss[] = []
  const kept: CompiledRule[] = []
  for (const rule of existing) {
    if (rule.id === incoming.id) continue
    const taken = rule.domains.filter((domain) => incoming.domains.includes(domain))
    const rest = rule.domains.filter((domain) => !incoming.domains.includes(domain))
    if (taken.length > 0) losses.push({ id: rule.id, title: rule.title, domains: taken })
    if (rest.length > 0) kept.push({ ...rule, domains: rest })
  }
  const rules = [...kept, incoming]
  let confirmation = describeRule(incoming.domains, incoming.title)
  if (losses.length === 1) {
    const loss = losses[0]
    if (loss) {
      confirmation += ` This replaces the rule that titled ${loss.domains.join(' and ')} ${loss.title}.`
    }
  } else if (losses.length > 1) {
    const bits = losses.map((loss) => `${loss.domains.join(' and ')} (${loss.title})`)
    confirmation += ` This replaces the rules for ${bits.join(', ')}.`
  }
  return { rules, losses, confirmation }
}

export function deleteRule(rules: CompiledRule[], id: string): CompiledRule[] {
  return rules.filter((rule) => rule.id !== id)
}

export function retitlesForSavedRule(rule: CompiledRule, groups: GroupState[]): RetitleAction[] {
  const actions: RetitleAction[] = []
  for (const group of groups) {
    if (group.shared || !group.dominantDomain) continue
    const claimed = rule.domains.some((domain) => domainCovered(group.dominantDomain as string, domain))
    if (!claimed || titlesMatch(group.title, rule.title)) continue
    actions.push({
      type: 'retitle',
      groupId: group.id,
      title: rule.title,
      color: colorForKey(rule.title),
    })
  }
  return actions
}

export function retitlesForDeletedRule(): RetitleAction[] {
  return []
}
