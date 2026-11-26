import type { FeatureCard, GroupSummary } from './types.js'

export type ChatMessage = { role: 'system' | 'user'; content: string }

/** Compact, secret-free summary of one existing group for a retitle prompt. */
export type GroupRetitlePayload = {
  currentTitle: string
  tabCount: number
  tabs: Array<{ domain: string; title: string; pathWords: string[] }>
}

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

const RETITLE_SYSTEM = [
  'You rename one browser tab group from its member tabs.',
  'Reply with JSON only: {"title":"1 to 3 words","confidence":0.9}.',
  'Prefer short stable site or product names (GitHub, Amazon, Local, YouTube).',
  'When most tabs share one clear domain, use that site display name — do not invent project themes, skills, or topics from page titles (never rename GitHub to DevOps Skills or Bug Reports).',
  'Prefer the current title when it is already a clear site name (for example GitHub or Local).',
  'When you are not sure, set title to "" and set confidence below 0.75.',
  'The title is a short group name. It is never the word empty, none, or unsure.',
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

/** Build a retitle payload from feature cards only — no raw URLs or page content. */
export function buildGroupRetitlePayload(currentTitle: string, cards: FeatureCard[]): GroupRetitlePayload {
  return {
    currentTitle: currentTitle.trim(),
    tabCount: cards.length,
    tabs: cards.map((card) => ({
      domain: card.domain,
      title: card.title,
      pathWords: card.pathWords,
    })),
  }
}

export function retitleGroupMessages(payload: GroupRetitlePayload): ChatMessage[] {
  return [
    { role: 'system', content: RETITLE_SYSTEM },
    { role: 'user', content: JSON.stringify(payload) },
  ]
}

/** Strip deepseek-r1 / reasoning wrappers that sometimes leak into the reply body. */
function stripThinkBlocks(content: string): string {
  return content.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').trim()
}

/** First balanced `{…}` object, respecting JSON strings so braces inside strings are ignored. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export function parseModelJson(content: string): unknown {
  let cleaned = stripThinkBlocks(content.trim())
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const extracted = extractJsonObject(cleaned)
    if (!extracted) throw new SyntaxError('No JSON object in model reply')
    return JSON.parse(extracted)
  }
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

/** Same shape as the advisor reply: a short title plus confidence. */
export function parseRetitleContent(content: string): { title: string; confidence: number } | null {
  return parseAdvisorContent(content)
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
