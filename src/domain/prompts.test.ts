import { describe, expect, it } from 'vitest'
import { buildFeatureCard } from './feature-card.js'
import {
  advisorMessages,
  buildGroupRetitlePayload,
  parseAdvisorContent,
  parseRetitleContent,
  parseRuleContent,
  retitleGroupMessages,
} from './prompts.js'
import type { FeatureCard, GroupSummary } from './types.js'

describe('parse model replies', () => {
  it('parses an advisor title and confidence', () => {
    expect(parseAdvisorContent('{"title":"standing desk","confidence":0.82}')).toEqual({
      title: 'standing desk',
      confidence: 0.82,
    })
  })

  it('strips a json fence', () => {
    expect(parseAdvisorContent('```json\n{"title":"gb","confidence":1}\n```')).toEqual({
      title: 'gb',
      confidence: 1,
    })
  })

  it('parses a rule sentence into domains', () => {
    expect(parseRuleContent('{"title":"errands","domains":["amazon.com","ebay.com"]}')).toEqual({
      title: 'errands',
      domains: ['amazon.com', 'ebay.com'],
    })
  })

  it('rejects a reply that is not json', () => {
    expect(parseAdvisorContent('not json')).toBeNull()
  })

  it('strips deepseek-r1 think blocks before parsing', () => {
    expect(
      parseRetitleContent(
        '<think>\nI should pick a short name.\n</think>\n{"title":"GitHub","confidence":0.91}',
      ),
    ).toEqual({ title: 'GitHub', confidence: 0.91 })
  })

  it('extracts a JSON object buried in preamble text', () => {
    expect(
      parseAdvisorContent('Sure. Here you go:\n{"title":"Docs","confidence":0.8}\nThanks.'),
    ).toEqual({ title: 'Docs', confidence: 0.8 })
  })

  it('treats the word empty as no title', () => {
    expect(parseAdvisorContent('{"title":"empty","confidence":0.2}')).toEqual({
      title: '',
      confidence: 0.2,
    })
  })

  it('asks with the feature card and group summaries only', () => {
    const card: FeatureCard = {
      domain: 'amazon.com',
      title: 'Standing lamp',
      titleWords: ['standing', 'lamp'],
      pathWords: ['desk'],
      openerDomain: null,
    }
    const groups: GroupSummary[] = [
      { id: 4, title: 'standing desk', domains: ['wirecutter.com'], words: ['standing', 'desk'], size: 2 },
    ]
    const blob = JSON.stringify(advisorMessages(card, groups))
    expect(blob).not.toMatch(/https?:/)
    expect(blob).not.toContain('access_token')
    expect(blob).toContain('Standing lamp')
    expect(blob).toContain('standing desk')
  })
})

describe('retitle group prompts', () => {
  it('parses a retitle title and confidence', () => {
    expect(parseRetitleContent('{"title":"GitHub","confidence":0.95}')).toEqual({
      title: 'GitHub',
      confidence: 0.95,
    })
  })

  it('builds a payload with no raw https urls', () => {
    const cards = [
      buildFeatureCard({
        url: 'https://github.com/acme/repo/abcdef0123456789abcdef0123456789?access_token=secretvalue123456789',
        title: 'Pull request - GitHub',
      }),
      buildFeatureCard({
        url: 'http://localhost:20128/dashboard',
        title: 'OmniRoute — Local',
      }),
    ]
    const payload = buildGroupRetitlePayload('GitHub', cards)
    const blob = JSON.stringify(payload)
    expect(blob).not.toMatch(/https?:\/\//)
    expect(blob).not.toContain('access_token')
    expect(payload.currentTitle).toBe('GitHub')
    expect(payload.tabCount).toBe(2)
    expect(payload.tabs[0]?.domain).toBe('github.com')
    expect(payload.tabs[1]?.domain).toBe('localhost')
  })

  it('asks with the group payload only', () => {
    const payload = buildGroupRetitlePayload('Local', [
      {
        domain: 'localhost',
        title: 'Dashboard',
        titleWords: ['dashboard'],
        pathWords: ['providers'],
        openerDomain: null,
      },
    ])
    const messages = retitleGroupMessages(payload)
    const blob = JSON.stringify(messages)
    expect(blob).not.toMatch(/https?:\/\//)
    expect(blob).toContain('Prefer short stable site or product names')
    expect(blob).toContain('do not invent project themes')
    expect(blob).toContain('DevOps Skills')
    expect(blob).toContain('Prefer the current title')
    expect(blob).toContain('Local')
    expect(blob).toContain('localhost')
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]?.role).toBe('user')
  })
})
