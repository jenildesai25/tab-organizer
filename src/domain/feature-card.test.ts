import { describe, expect, it } from 'vitest'
import { buildFeatureCard } from './feature-card.js'
import {
  domainImpliedBySiteTitle,
  groupTitleConflictsWithDomain,
  isStaleLoopbackGroupTitle,
  hasStableSiteDisplay,
  preferredSiteGroupTitle,
  registrableDomain,
  siteTitle,
  titlesMatch,
} from './sites.js'

describe('localhost and loopback sites', () => {
  it('files all loopback hosts under one localhost key titled Local', () => {
    expect(registrableDomain('localhost')).toBe('localhost')
    expect(registrableDomain('127.0.0.1')).toBe('127.0.0.1')
    expect(registrableDomain('::1')).toBe('::1')
    expect(registrableDomain('http://localhost:20128/dashboard')).toBe('localhost')
    expect(buildFeatureCard({ url: 'http://localhost:20128/dashboard/providers?cat=local', title: 'OmniRoute — A' }).domain).toBe(
      'localhost',
    )
    expect(buildFeatureCard({ url: 'http://127.0.0.1:3000/', title: 'App' }).domain).toBe('localhost')
    expect(buildFeatureCard({ url: 'http://[::1]:8080/', title: 'App' }).domain).toBe('localhost')
    expect(buildFeatureCard({ url: 'http://localhost/', title: 'Local' }).domain).toBe('localhost')
    expect(siteTitle('localhost')).toBe('Local')
    expect(siteTitle('127.0.0.1')).toBe('Local')
    expect(siteTitle('::1')).toBe('Local')
    expect(siteTitle('localhost:20128')).toBe('Local')
    expect(siteTitle('127.0.0.1:3000')).toBe('Local')
    expect(isStaleLoopbackGroupTitle('127')).toBe(true)
    expect(isStaleLoopbackGroupTitle('127.0.0.1')).toBe(true)
    expect(isStaleLoopbackGroupTitle('localhost:20128')).toBe(true)
    expect(isStaleLoopbackGroupTitle('Local')).toBe(false)
  })
})

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
    const token = buildFeatureCard({
      url: 'https://example.com/app/sess12ab34cd56/home',
      title: 'Home',
    })
    expect(token.pathWords).not.toContain('sess12ab34cd56')
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
    expect(pages.domain).toBe('github.io')
    expect(pages.domain).not.toBe('github.com')
    expect(siteTitle('github.com')).toBe('GitHub')
    expect(siteTitle('github.io')).toBe('GitHub Pages')
    expect(siteTitle('github.io')).not.toBe('Github')
    expect(titlesMatch('GitHub', 'Github')).toBe(true)
    expect(titlesMatch('GitHub', 'GitHub Pages')).toBe(false)
    expect(preferredSiteGroupTitle('github.com', 'Github')).toBe('GitHub')
    expect(preferredSiteGroupTitle('github.io', 'Github')).toBe('GitHub Pages')
    expect(preferredSiteGroupTitle('github.com', 'GitHub')).toBe(null)
    expect(hasStableSiteDisplay('github.com')).toBe(true)
    expect(hasStableSiteDisplay('github.io')).toBe(true)
    expect(hasStableSiteDisplay('amazon.com')).toBe(true)
    expect(hasStableSiteDisplay('localhost')).toBe(true)
    expect(hasStableSiteDisplay('example.com')).toBe(false)
    // AI themes must not stick on known site buckets.
    expect(preferredSiteGroupTitle('github.com', 'DevOps Skills')).toBe('GitHub')
    expect(preferredSiteGroupTitle('amazon.com', 'Shopping List')).toBe('Amazon')
    expect(preferredSiteGroupTitle('localhost', 'Dev Dashboard')).toBe('Local')
  })

  it('drops an email in the path', () => {
    const card = buildFeatureCard({
      url: 'https://example.com/users/person@example.com/home',
      title: 'Profile',
    })
    expect(card.pathWords).toEqual(['users', 'home'])
    expect(JSON.stringify(card)).not.toContain('@')
  })

  it('implies a site key from an auto site-group title', () => {
    expect(domainImpliedBySiteTitle('Capitaloneshopping')).toBe('capitaloneshopping.com')
    expect(domainImpliedBySiteTitle('Brooksrunning')).toBe('brooksrunning.com')
    expect(domainImpliedBySiteTitle('Google')).toBe('google.com')
    expect(domainImpliedBySiteTitle('Shopping List')).toBe(null)
    expect(groupTitleConflictsWithDomain('Capitaloneshopping', 'brooksrunning.com')).toBe(true)
    expect(groupTitleConflictsWithDomain('Capitaloneshopping', 'capitaloneshopping.com')).toBe(false)
    expect(groupTitleConflictsWithDomain('Brooksrunning', 'brooksrunning.com')).toBe(false)
    expect(groupTitleConflictsWithDomain('Google', 'whatsapp.com')).toBe(true)
  })
})
