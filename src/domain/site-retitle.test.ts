import { describe, expect, it } from 'vitest'
import {
  decideSiteRetitle,
  dominantSiteFromCards,
  isHomogeneousSiteGroup,
  rejectRetitleSuggestion,
} from './site-retitle.js'

function cards(...domains: string[]) {
  return domains.map((domain) => ({
    domain,
    title: 'Page',
    titleWords: ['page'],
    pathWords: [] as string[],
    openerDomain: null,
  }))
}

describe('dominantSiteFromCards', () => {
  it('scores a pure github.com group as 100% github.com', () => {
    const dominant = dominantSiteFromCards(cards('github.com', 'github.com', 'github.com'))
    expect(dominant).toEqual({ domain: 'github.com', share: 1, count: 3, total: 3 })
    expect(isHomogeneousSiteGroup(cards('github.com', 'github.com'))).toBe(true)
  })

  it('treats an 80% dominant site as homogeneous', () => {
    const mixed = cards('github.com', 'github.com', 'github.com', 'github.com', 'amazon.com')
    expect(dominantSiteFromCards(mixed)?.share).toBe(0.8)
    expect(isHomogeneousSiteGroup(mixed)).toBe(true)
  })
})

describe('decideSiteRetitle', () => {
  it('skips AI when the title is already GitHub for a github.com group', () => {
    expect(decideSiteRetitle('GitHub', cards('github.com', 'github.com'))).toMatchObject({
      kind: 'skip',
      reason: 'already clear',
      siteTitle: 'GitHub',
    })
    expect(decideSiteRetitle('github', cards('github.com'))).toMatchObject({
      kind: 'skip',
      reason: 'already clear',
    })
  })

  it('forces GitHub instead of asking the model for DevOps Skills', () => {
    expect(decideSiteRetitle('DevOps Skills', cards('github.com', 'github.com', 'github.com'))).toEqual({
      kind: 'use-site',
      title: 'GitHub',
      domain: 'github.com',
      reason: 'site title',
    })
  })

  it('forces Local / Amazon for homogeneous stable sites', () => {
    expect(decideSiteRetitle('Dev Dashboard', cards('localhost', 'localhost'))).toMatchObject({
      kind: 'use-site',
      title: 'Local',
    })
    expect(decideSiteRetitle('Shopping Spree', cards('amazon.com', 'amazon.com'))).toMatchObject({
      kind: 'use-site',
      title: 'Amazon',
    })
  })

  it('does not force GitHub when a user rule claims github.com', () => {
    expect(
      decideSiteRetitle('gb', cards('github.com', 'github.com'), {
        rules: [{ domains: ['github.com'] }],
      }),
    ).toEqual({ kind: 'ask-model' })
  })

  it('asks the model for mixed-domain groups', () => {
    expect(
      decideSiteRetitle('Research', cards('github.com', 'amazon.com', 'nytimes.com')),
    ).toEqual({ kind: 'ask-model' })
  })
})

describe('rejectRetitleSuggestion', () => {
  it('rejects DevOps Skills for a homogeneous github.com group', () => {
    expect(
      rejectRetitleSuggestion('GitHub', 'DevOps Skills', cards('github.com', 'github.com')),
    ).toBe('not site title')
    expect(
      rejectRetitleSuggestion('Github', 'Bug Reports', cards('github.com', 'github.com', 'github.com')),
    ).toBe('not site title')
  })

  it('accepts the canonical site name', () => {
    expect(rejectRetitleSuggestion('Github', 'GitHub', cards('github.com', 'github.com'))).toBeNull()
  })

  it('does not reject when a user rule claims the site', () => {
    expect(
      rejectRetitleSuggestion('gb', 'Work PRs', cards('github.com', 'github.com'), {
        rules: [{ domains: ['github.com'] }],
      }),
    ).toBeNull()
  })
})
