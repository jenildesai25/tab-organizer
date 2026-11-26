import type { FeatureCard } from './types.js'
import { registrableDomain } from './sites.js'
import { words } from './words.js'

const PLACEHOLDERS = new Set(['', 'new tab', 'loading', 'loading...'])

export function isHttpUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function normalizeTitle(raw: string): string {
  let title = raw.replace(/\(\d+\)|\[\d+\]/g, ' ')
  title = title.replace(/\s+/g, ' ').trim()
  const parts = title.split(/\s+[|\-–—]\s+/)
  if (parts.length >= 2) {
    parts.pop()
    title = parts.join(' - ').trim()
  }
  return title
}

export function titleIsUsable(title: string): boolean {
  return !PLACEHOLDERS.has(title.trim().toLowerCase())
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function isSecret(word: string): boolean {
  if (word.includes('@')) return true
  if (word.length >= 16 && /^[a-f0-9]+$/i.test(word)) return true
  if (word.length >= 24) return true
  return false
}

export function buildFeatureCard(input: {
  url: string
  title: string
  openerUrl?: string | null
}): FeatureCard {
  let domain = ''
  let pathWords: string[] = []
  if (isHttpUrl(input.url)) {
    const url = new URL(input.url)
    domain = registrableDomain(url.hostname)
    pathWords = url.pathname
      .split('/')
      .map((segment) => decodeSegment(segment))
      .filter((segment) => segment !== '' && !segment.includes('@') && !isSecret(segment))
      .flatMap((segment) => words(segment))
  }
  const title = normalizeTitle(input.title)
  const openerDomain =
    input.openerUrl && isHttpUrl(input.openerUrl) ? registrableDomain(input.openerUrl) : null
  return {
    domain,
    title,
    titleWords: words(title),
    pathWords,
    openerDomain,
  }
}
