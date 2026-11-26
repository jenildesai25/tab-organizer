const STOP = new Set([
  'a',
  'an',
  'and',
  'the',
  'or',
  'of',
  'to',
  'in',
  'for',
  'on',
  'with',
  'www',
  'com',
])

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP.has(word))
}

export function jaccard(left: string[], right: string[]): number {
  const a = new Set(left)
  const b = new Set(right)
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const word of a) if (b.has(word)) intersection += 1
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function isShortTitle(title: string): boolean {
  const parts = title.trim().split(/\s+/).filter(Boolean)
  return parts.length >= 1 && parts.length <= 3 && title.trim().length <= 40
}
