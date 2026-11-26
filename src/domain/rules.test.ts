import { describe, expect, it } from 'vitest'
import { claimRule, compileSentence, deleteRule, retitlesForDeletedRule, retitlesForSavedRule } from './rules.js'
import { colorForKey } from './sites.js'
import type { GroupState } from './types.js'

describe('compileSentence', () => {
  it('compiles use gb for github', () => {
    expect(compileSentence('use gb for github')).toEqual({
      sentence: 'use gb for github',
      domains: ['github.com'],
      title: 'gb',
    })
  })

  it('compiles call youtube vids', () => {
    expect(compileSentence('call youtube vids')).toMatchObject({
      domains: ['youtube.com'],
      title: 'vids',
    })
  })

  it('compiles put amazon and ebay in buy', () => {
    expect(compileSentence('put amazon and ebay in buy')).toMatchObject({
      domains: ['amazon.com', 'ebay.com'],
      title: 'buy',
    })
  })

  it('keeps github.io distinct from github.com', () => {
    const rule = compileSentence('use pages for github.io')
    expect(rule?.domains[0]).not.toBe('github.com')
    expect(rule?.domains[0]?.endsWith('github.io')).toBe(true)
  })

  it('leaves a vague sentence unrecognized', () => {
    expect(compileSentence('put my usual shopping in errands')).toBeNull()
  })
})

describe('claimRule', () => {
  it('gives a site to the newer rule and says which title lost it', () => {
    const older = {
      id: 'old',
      sentence: 'use gh for github',
      domains: ['github.com', 'youtube.com'],
      title: 'gh',
    }
    const incoming = {
      id: 'new',
      sentence: 'use gb for github',
      domains: ['github.com'],
      title: 'gb',
    }
    const claimed = claimRule([older], incoming)
    expect(claimed.rules.map((rule) => rule.title)).toEqual(['gh', 'gb'])
    expect(claimed.rules[0]?.domains).toEqual(['youtube.com'])
    expect(claimed.losses).toEqual([{ id: 'old', title: 'gh', domains: ['github.com'] }])
    expect(claimed.confirmation).toBe(
      'Tabs on github.com and its subdomains go in a group titled gb. This replaces the rule that titled github.com gh.',
    )
  })

  it('drops an older rule that has no sites left', () => {
    const older = { id: 'old', sentence: 'use gh for github', domains: ['github.com'], title: 'gh' }
    const incoming = { id: 'new', sentence: 'use gb for github', domains: ['github.com'], title: 'gb' }
    const claimed = claimRule([older], incoming)
    expect(claimed.rules).toEqual([incoming])
  })
})

describe('retitles', () => {
  const github: GroupState = {
    id: 10,
    title: 'GitHub',
    dominantDomain: 'github.com',
    domains: ['github.com'],
    words: [],
    size: 2,
    collapsed: false,
    shared: false,
    handRenamed: true,
  }

  const rule = { id: 'gb', sentence: 'use gb for github', domains: ['github.com'], title: 'gb' }

  it('retitles a matching group when a rule is saved', () => {
    const actions = retitlesForSavedRule(rule, [github])
    expect(actions).toEqual([
      { type: 'retitle', groupId: 10, title: 'gb', color: colorForKey('gb') },
    ])
  })

  it('does not retitle a shared group', () => {
    expect(retitlesForSavedRule(rule, [{ ...github, shared: true }])).toEqual([])
  })

  it('deleting a rule emits no retitle', () => {
    expect(deleteRule([rule], 'gb')).toEqual([])
    expect(retitlesForDeletedRule()).toEqual([])
  })
})
