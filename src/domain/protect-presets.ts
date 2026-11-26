import { normalizeProtectDomains, normalizeProtectUrlPatterns, type ProtectLists } from './tab-cleanup.js'

export type ProtectPresetId = 'mail' | 'calendar' | 'banking' | 'shopping'

export type ProtectPreset = {
  id: ProtectPresetId
  label: string
  hint: string
  domains: string[]
  urlPatterns: string[]
}

/**
 * Curated protects. Prefer page patterns when a registrable domain would cover
 * too much (e.g. google.com for Gmail).
 */
export const PROTECT_PRESETS: readonly ProtectPreset[] = [
  {
    id: 'mail',
    label: 'Mail',
    hint: 'Gmail, Outlook, Yahoo, Proton, iCloud Mail',
    domains: ['proton.me', 'icloud.com'],
    urlPatterns: [
      'https://mail.google.com',
      'https://outlook.live.com/mail',
      'https://outlook.office.com/mail',
      'https://mail.yahoo.com',
      'https://mail.proton.me',
      'https://www.icloud.com/mail',
    ],
  },
  {
    id: 'calendar',
    label: 'Calendar',
    hint: 'Google Calendar and Outlook calendar',
    domains: [],
    urlPatterns: [
      'https://calendar.google.com',
      'https://outlook.live.com/calendar',
      'https://outlook.office.com/calendar',
    ],
  },
  {
    id: 'banking',
    label: 'Banking',
    hint: 'Common US bank and broker sites',
    domains: [
      'chase.com',
      'bankofamerica.com',
      'wellsfargo.com',
      'citi.com',
      'capitalone.com',
      'americanexpress.com',
      'fidelity.com',
      'vanguard.com',
      'schwab.com',
      'paypal.com',
    ],
    urlPatterns: [],
  },
  {
    id: 'shopping',
    label: 'Shopping',
    hint: 'Amazon, eBay, Target, Walmart, Best Buy',
    domains: ['amazon.com', 'ebay.com', 'target.com', 'walmart.com', 'bestbuy.com'],
    urlPatterns: [],
  },
] as const

export function protectPresetById(id: string): ProtectPreset | null {
  return PROTECT_PRESETS.find((preset) => preset.id === id) ?? null
}

export type ProtectPresetApplyResult = {
  preset: ProtectPreset
  protect: ProtectLists
  addedDomains: string[]
  addedPatterns: string[]
}

/** Merge a preset into Protect lists without removing anything the user already set. */
export function applyProtectPreset(
  protect: ProtectLists,
  presetId: string,
): ProtectPresetApplyResult | null {
  const preset = protectPresetById(presetId)
  if (!preset) return null
  const domainSet = new Set(protect.domains)
  const patternSet = new Set(protect.urlPatterns)
  const addedDomains: string[] = []
  const addedPatterns: string[] = []
  for (const domain of normalizeProtectDomains(preset.domains)) {
    if (domainSet.has(domain)) continue
    domainSet.add(domain)
    addedDomains.push(domain)
  }
  for (const pattern of normalizeProtectUrlPatterns(preset.urlPatterns)) {
    if (patternSet.has(pattern)) continue
    patternSet.add(pattern)
    addedPatterns.push(pattern)
  }
  return {
    preset,
    addedDomains,
    addedPatterns,
    protect: {
      ...protect,
      domains: [...domainSet],
      urlPatterns: [...patternSet],
    },
  }
}

export function formatProtectPresetSummary(
  preset: ProtectPreset,
  addedDomains: readonly string[],
  addedPatterns: readonly string[],
): string {
  const added = addedDomains.length + addedPatterns.length
  if (added === 0) return `${preset.label} was already protected.`
  if (added === 1) {
    const one = addedDomains[0] ?? addedPatterns[0]
    return `Protected ${one} (${preset.label}).`
  }
  return `Protected ${added} ${preset.label.toLowerCase()} entries.`
}
