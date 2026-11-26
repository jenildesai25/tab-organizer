import { describe, expect, it } from 'vitest'
import {
  dismissRuleSuggestionVote,
  readyRuleSuggestions,
  recordHandRenameVote,
  suggestionSentence,
} from './rule-suggestions.js'

describe('rule suggestions', () => {
  it('builds a compilable sentence', () => {
    expect(suggestionSentence('github.com', 'Work')).toBe('use Work for github')
  })

  it('counts renames away from the site title and ignores no-ops', () => {
    const first = recordHandRenameVote([], { domain: 'github.com', title: 'Work', now: 1 })
    expect(first).toEqual([{ domain: 'github.com', title: 'Work', count: 1, updatedAt: 1 }])
    const second = recordHandRenameVote(first, { domain: 'github.com', title: 'Work', now: 2 })
    expect(second[0]?.count).toBe(2)
    expect(recordHandRenameVote(second, { domain: 'github.com', title: 'GitHub', now: 3 })).toEqual(second)
  })

  it('surfaces suggestions only after the threshold and skips covered domains', () => {
    const votes = recordHandRenameVote(
      recordHandRenameVote([], { domain: 'github.com', title: 'Work', now: 1 }),
      { domain: 'github.com', title: 'Work', now: 2 },
    )
    expect(readyRuleSuggestions(votes, [])).toEqual([
      {
        id: 'github.com::work',
        domain: 'github.com',
        title: 'Work',
        count: 2,
        updatedAt: 2,
        sentence: 'use Work for github',
      },
    ])
    expect(
      readyRuleSuggestions(votes, [{ id: '1', sentence: 'x', title: 'gb', domains: ['github.com'] }]),
    ).toEqual([])
  })

  it('dismisses a vote', () => {
    const votes = recordHandRenameVote([], { domain: 'linear.app', title: 'Work', now: 1 })
    expect(dismissRuleSuggestionVote(votes, 'linear.app', 'Work')).toEqual([])
  })
})
