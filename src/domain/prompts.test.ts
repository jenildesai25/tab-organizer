import { describe, expect, it } from 'vitest'
import { advisorMessages, parseAdvisorContent, parseRuleContent } from './prompts.js'
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
