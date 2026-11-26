import { parseGroupFingerprints } from './group-identity.js'
import { clampHour, DEFAULT_QUIET_HOURS_END, DEFAULT_QUIET_HOURS_START } from './quiet-hours.js'
import {
  clampCleanupAgeDays,
  parseProtectLists,
  type ProtectLists,
} from './tab-cleanup.js'
import { parseWorkspaceLayouts, type WorkspaceLayout } from './workspace-layout.js'
import type { CompiledRule } from './types.js'

export const SETTINGS_BACKUP_KIND = 'tab-organizer-settings'
export const SETTINGS_BACKUP_VERSION = 1

export type SettingsBackup = {
  kind: typeof SETTINGS_BACKUP_KIND
  version: number
  exportedAt: number
  settings: {
    organizerOn: boolean
    llmOn: boolean
    model: string
    rules: CompiledRule[]
    cleanupOn: boolean
    cleanupAgeDays: number
    protect: ProtectLists
    protectHandRenamed: boolean
    quietHoursOn: boolean
    quietHoursStart: number
    quietHoursEnd: number
  }
  layouts: WorkspaceLayout[]
}

export type SettingsBackupSource = SettingsBackup['settings']

export function buildSettingsBackup(
  settings: SettingsBackupSource,
  layouts: readonly WorkspaceLayout[],
  now = Date.now(),
): SettingsBackup {
  return {
    kind: SETTINGS_BACKUP_KIND,
    version: SETTINGS_BACKUP_VERSION,
    exportedAt: now,
    settings: {
      organizerOn: settings.organizerOn === true,
      llmOn: settings.llmOn === true,
      model: typeof settings.model === 'string' ? settings.model : '',
      rules: Array.isArray(settings.rules) ? settings.rules : [],
      cleanupOn: settings.cleanupOn === true,
      cleanupAgeDays: clampCleanupAgeDays(settings.cleanupAgeDays),
      protect: {
        domains: [...settings.protect.domains],
        groupIds: [...settings.protect.groupIds],
        urlPatterns: [...settings.protect.urlPatterns],
        groups: [...settings.protect.groups],
      },
      protectHandRenamed: settings.protectHandRenamed === true,
      quietHoursOn: settings.quietHoursOn === true,
      quietHoursStart: clampHour(settings.quietHoursStart, DEFAULT_QUIET_HOURS_START),
      quietHoursEnd: clampHour(settings.quietHoursEnd, DEFAULT_QUIET_HOURS_END),
    },
    layouts: [...layouts],
  }
}

function parseRules(raw: unknown): CompiledRule[] {
  if (!Array.isArray(raw)) return []
  const out: CompiledRule[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.sentence !== 'string' || typeof row.title !== 'string') continue
    if (!Array.isArray(row.domains)) continue
    const domains = row.domains.filter((domain): domain is string => typeof domain === 'string')
    out.push({ id: row.id, sentence: row.sentence, title: row.title, domains })
  }
  return out
}

export function parseSettingsBackup(raw: unknown): SettingsBackup | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (row.kind !== SETTINGS_BACKUP_KIND) return null
  if (row.version !== SETTINGS_BACKUP_VERSION) return null
  if (!row.settings || typeof row.settings !== 'object') return null
  const settingsRaw = row.settings as Record<string, unknown>
  const protectRaw =
    settingsRaw.protect && typeof settingsRaw.protect === 'object'
      ? (settingsRaw.protect as Record<string, unknown>)
      : {}
  const protect = {
    ...parseProtectLists({
      domains: protectRaw.domains,
      groupIds: protectRaw.groupIds,
      urlPatterns: protectRaw.urlPatterns,
    }),
    groups: parseGroupFingerprints(protectRaw.groups),
  }
  return {
    kind: SETTINGS_BACKUP_KIND,
    version: SETTINGS_BACKUP_VERSION,
    exportedAt: typeof row.exportedAt === 'number' ? row.exportedAt : 0,
    settings: {
      organizerOn: settingsRaw.organizerOn === true,
      llmOn: settingsRaw.llmOn === true,
      model: typeof settingsRaw.model === 'string' ? settingsRaw.model : '',
      rules: parseRules(settingsRaw.rules),
      cleanupOn: settingsRaw.cleanupOn === true,
      cleanupAgeDays: clampCleanupAgeDays(settingsRaw.cleanupAgeDays),
      protect,
      protectHandRenamed: settingsRaw.protectHandRenamed === true,
      quietHoursOn: settingsRaw.quietHoursOn === true,
      quietHoursStart: clampHour(settingsRaw.quietHoursStart, DEFAULT_QUIET_HOURS_START),
      quietHoursEnd: clampHour(settingsRaw.quietHoursEnd, DEFAULT_QUIET_HOURS_END),
    },
    layouts: parseWorkspaceLayouts(row.layouts),
  }
}

export function formatBackupSummary(backup: SettingsBackup): string {
  const rules = backup.settings.rules.length
  const layouts = backup.layouts.length
  return `Imported ${rules} rule${rules === 1 ? '' : 's'} and ${layouts} layout${layouts === 1 ? '' : 's'}.`
}
