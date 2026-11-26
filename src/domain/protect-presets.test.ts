import { describe, expect, it } from 'vitest'
import { applyProtectPreset, formatProtectPresetSummary, protectPresetById } from './protect-presets.js'

const empty = { domains: [], groupIds: [], urlPatterns: [], groups: [] }

describe('protect presets', () => {
  it('looks up a known preset', () => {
    expect(protectPresetById('mail')?.label).toBe('Mail')
    expect(protectPresetById('nope')).toBeNull()
  })

  it('adds mail as page patterns instead of all of google.com', () => {
    const result = applyProtectPreset(empty, 'mail')
    expect(result).not.toBeNull()
    expect(result!.protect.domains).not.toContain('google.com')
    expect(result!.protect.urlPatterns).toContain('https://mail.google.com/')
    expect(result!.addedPatterns.length).toBeGreaterThan(0)
  })

  it('merges banking domains without wiping existing protects', () => {
    const result = applyProtectPreset(
      { ...empty, domains: ['chase.com', 'example.com'] },
      'banking',
    )
    expect(result!.protect.domains).toContain('example.com')
    expect(result!.protect.domains).toContain('paypal.com')
    expect(result!.addedDomains).not.toContain('chase.com')
    expect(result!.addedDomains).toContain('paypal.com')
  })

  it('formats a short summary', () => {
    const preset = protectPresetById('shopping')!
    expect(formatProtectPresetSummary(preset, [], [])).toContain('already protected')
    expect(formatProtectPresetSummary(preset, ['amazon.com'], [])).toContain('amazon.com')
    expect(formatProtectPresetSummary(preset, ['a.com', 'b.com'], ['https://x.com'])).toContain('3')
  })
})
