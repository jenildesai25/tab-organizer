import { describe, expect, it } from 'vitest'
import { parseHandRenamedIds, pruneHandRenamedIds } from './hand-renamed.js'
import { decideSiteRetitle, rejectRetitleSuggestion } from './site-retitle.js'

function cards(...domains: string[]) {
  return domains.map((domain) => ({
    domain,
    title: 'Page',
    titleWords: ['page'],
    pathWords: [] as string[],
    openerDomain: null,
  }))
}

describe('parseHandRenamedIds', () => {
  it('keeps unique non-negative integer ids', () => {
    expect(parseHandRenamedIds([3, 'x', 3, -1, 7.5, 7])).toEqual([3, 7])
    expect(parseHandRenamedIds(null)).toEqual([])
  })
})

describe('pruneHandRenamedIds', () => {
  it('drops ids that are no longer live groups', () => {
    expect(pruneHandRenamedIds([1, 2, 3], new Set([2, 9]))).toEqual([2])
  })
})

describe('hand-renamed site retitle', () => {
  it('skips decideSiteRetitle instead of forcing GitHub over My PRs', () => {
    expect(
      decideSiteRetitle('My PRs', cards('github.com', 'github.com'), { handRenamed: true }),
    ).toEqual({
      kind: 'skip',
      reason: 'hand renamed',
      domain: 'github.com',
      siteTitle: 'GitHub',
    })
  })

  it('still rejects thematic AI names for homogeneous github groups', () => {
    expect(
      rejectRetitleSuggestion('My PRs', 'DevOps Skills', cards('github.com', 'github.com')),
    ).toBe('not site title')
    expect(
      rejectRetitleSuggestion('GitHub', 'DevOps Skills', cards('github.com', 'github.com')),
    ).toBe('not site title')
  })
})
