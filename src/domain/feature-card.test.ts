import { describe, expect, it } from 'vitest'
import { buildFeatureCard } from './feature-card.js'

describe('buildFeatureCard', () => {
  it('strips tracking parameters, secret-like tokens, and the site suffix', () => {
    const card = buildFeatureCard({
      url: 'https://github.com/acme/repo/abcdef0123456789abcdef0123456789/readme?access_token=supersecretvalue123456&utm_source=twitter',
      title: 'Pull request (2) - GitHub',
      openerUrl: 'https://www.youtube.com/watch?v=abc',
    })
    expect(card.domain).toBe('github.com')
    expect(card.title).toBe('Pull request')
    expect(card.pathWords).toEqual(['acme', 'repo', 'readme'])
    expect(card.openerDomain).toBe('youtube.com')
    const blob = JSON.stringify(card)
    expect(blob).not.toContain('access_token')
    expect(blob).not.toContain('utm_source')
    expect(blob).not.toContain('abcdef0123456789')
    expect(blob).not.toContain('https://')
  })

  it('collapses docs.google.com to the google.com site', () => {
    const card = buildFeatureCard({
      url: 'https://docs.google.com/document/d/budget',
      title: 'Budget sheet',
    })
    expect(card.domain).toBe('google.com')
  })

  it('treats github.io as a different site from github.com', () => {
    const github = buildFeatureCard({ url: 'https://gist.github.com/acme', title: 'Snippet' })
    const pages = buildFeatureCard({ url: 'https://acme.github.io/project', title: 'Project' })
    expect(github.domain).toBe('github.com')
    expect(pages.domain).not.toBe('github.com')
    expect(pages.domain.endsWith('github.io')).toBe(true)
  })

  it('drops an email in the path', () => {
    const card = buildFeatureCard({
      url: 'https://example.com/users/person@example.com/home',
      title: 'Profile',
    })
    expect(card.pathWords).toEqual(['users', 'home'])
    expect(JSON.stringify(card)).not.toContain('@')
  })
})
