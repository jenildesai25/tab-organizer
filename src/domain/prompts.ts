import type { FeatureCard, GroupSummary } from './types.js'

export type ChatMessage = { role: 'system' | 'user'; content: string }

const ADVISOR_SYSTEM = [
  'You choose the tab group for one browser tab.',
  'Reply with JSON only: {"title":"existing group title","confidence":0.9}.',
  'When the tab is about the same subject as an existing group, set title to that group title exactly.',
  'When you are not sure, set title to "" and set confidence below 0.75.',
  'The title is a group name. It is never the word empty, none, or unsure.',
].join(' ')

const RULE_SYSTEM = [
  'Convert one sentence into JSON only: {"title":"short name","domains":["example.com"]}.',
  'domains are registrable domains such as github.com.',
  'If the sentence does not name specific sites, return {"title":"","domains":[]}.',
].join(' ')

export function advisorMessages(card: FeatureCard, groups: GroupSummary[]): ChatMessage[] {
  return [
    { role: 'system', content: ADVISOR_SYSTEM },
    {
      role: 'user',
      content: JSON.stringify({
        tab: {
          domain: card.domain,
          title: card.title,
          pathWords: card.pathWords,
          openerDomain: card.openerDomain,
        },
        groups: groups.map((group) => ({
          title: group.title,
          domains: group.domains,
          words: group.words,
          size: group.size,
        })),
      }),
    },
  ]
}

export function ruleMessages(sentence: string): ChatMessage[] {
  return [
    { role: 'system', content: RULE_SYSTEM },
    { role: 'user', content: sentence },
  ]
}

export function parseModelJson(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(cleaned)
}

const PLACEHOLDER_TITLES = new Set(['empty', 'none', 'null', 'undefined', 'n/a', 'na', 'unsure', 'unknown'])

function placeholderTitle(title: string): string {
  const trimmed = title.trim()
  if (PLACEHOLDER_TITLES.has(trimmed.toLowerCase())) return ''
  return trimmed
}

export function parseAdvisorContent(content: string): { title: string; confidence: number } | null {
  try {
    const data = parseModelJson(content) as { title?: unknown; confidence?: unknown }
    if (typeof data.title !== 'string') return null
    const confidence = typeof data.confidence === 'number' ? data.confidence : Number(data.confidence)
    if (!Number.isFinite(confidence)) return null
    const title = placeholderTitle(data.title)
    return { title, confidence }
  } catch {
    return null
  }
}

export function parseRuleContent(content: string): { title: string; domains: string[] } | null {
  try {
    const data = parseModelJson(content) as { title?: unknown; domains?: unknown }
    if (typeof data.title !== 'string' || !Array.isArray(data.domains)) return null
    const domains = data.domains.filter((domain): domain is string => typeof domain === 'string')
    return { title: data.title.trim(), domains }
  } catch {
    return null
  }
}
