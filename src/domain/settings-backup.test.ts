import { describe, expect, it } from 'vitest'
import { buildSettingsBackup, formatBackupSummary, parseSettingsBackup } from './settings-backup.js'

const sample = {
  organizerOn: true,
  llmOn: false,
  model: 'llama',
  rules: [{ id: '1', sentence: 'use gb for github', title: 'gb', domains: ['github.com'] }],
  cleanupOn: true,
  cleanupAgeDays: 7,
  protect: { domains: ['example.com'], groupIds: [], urlPatterns: [], groups: [] },
  protectHandRenamed: true,
  quietHoursOn: true,
  quietHoursStart: 22,
  quietHoursEnd: 6,
}

describe('settings backup', () => {
  it('round-trips export JSON', () => {
    const backup = buildSettingsBackup(sample, [], 100)
    const parsed = parseSettingsBackup(JSON.parse(JSON.stringify(backup)))
    expect(parsed).toEqual(backup)
    expect(formatBackupSummary(backup)).toContain('1 rule')
  })

  it('rejects foreign or version-mismatched payloads', () => {
    expect(parseSettingsBackup({ kind: 'other', version: 1, settings: sample })).toBeNull()
    expect(parseSettingsBackup({ kind: 'tab-organizer-settings', version: 99, settings: sample })).toBeNull()
  })
})
