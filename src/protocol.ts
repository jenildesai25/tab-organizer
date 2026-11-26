import type { ActivityActor, ActivityEntry, ActivityFilter } from './domain/activity-log.js'
import type { SweepDiag } from './domain/sweep-diag.js'
import type { TabGroupView } from './domain/tab-groups.js'
import type { ChromeColor, CompiledRule } from './domain/types.js'
import type { LocalModel } from './ollama.js'

export type { ActivityActor, ActivityAction, ActivityEntry, ActivityFilter } from './domain/activity-log.js'
export type { SweepDiag, SweepDiagSample } from './domain/sweep-diag.js'
export type { TabGroupView } from './domain/tab-groups.js'

export type PreviewResult =
  | { ok: true; confirmation: string; domains: string[]; title: string }
  | { ok: false; message: string }

export type RetitleGroupResult = {
  groupId: number
  oldTitle: string
  newTitle?: string
  status: 'renamed' | 'skipped' | 'failed'
  reason?: string
}

export type RetitleProgress = {
  current: number
  total: number
  /** Outcomes finished so far (for live progress UI). */
  results?: RetitleGroupResult[]
}

export type StateResult = {
  organizerOn: boolean
  llmOn: boolean
  model: string
  rules: CompiledRule[]
  autoDiscardOn: boolean
  idleMinutes: number
  neverDomains: string[]
  status: string
  /** Present while a retitle-groups job is running. */
  retitle?: RetitleProgress | null
  /** Active tab in the focused window, when known — for popup Free up memory controls. */
  activeTab?: { id: number; discarded: boolean; title: string; siteKey: string } | null
}

export type ModelsResult = {
  ok: boolean
  permitted: boolean
  models: LocalModel[]
  message?: string
}

export type SweepResult =
  | (StateResult & { ok: true; summary: string; diag?: SweepDiag })
  | { ok: false; message: string; diag?: SweepDiag }

export type ListGroupsResult =
  | { ok: true; windowId: number; groups: TabGroupView[] }
  | { ok: false; message: string }

export type UpdateGroupResult =
  | { ok: true; group: TabGroupView }
  | { ok: false; message: string }

export type UngroupResult = { ok: true } | { ok: false; message: string }

export type RetitleGroupsResult =
  | {
      ok: true
      updated: number
      skipped: number
      failed: number
      summary: string
      results: RetitleGroupResult[]
    }
  | { ok: false; message: string }

export type TestOllamaResult =
  | { ok: true; message: string; ms: number }
  | { ok: false; message: string; ms?: number }

export type ActivityLogResult = {
  ok: true
  entries: ActivityEntry[]
}

export type ClearActivityResult = { ok: true }

export type DiscardTabResult =
  | { ok: true; tabId: number; discarded: boolean; siteKey?: string; summary: string }
  | { ok: false; message: string }

export type ReloadTabResult =
  | { ok: true; tabId: number; summary: string }
  | { ok: false; message: string }

export type DiscardSweepResult = {
  ok: true
  discarded: number
  skipped: number
  summary: string
}

export type ToBackground =
  | { type: 'get-state' }
  | { type: 'set-organizer'; on: boolean }
  | { type: 'set-llm'; on: boolean }
  | { type: 'set-model'; model: string }
  | { type: 'set-auto-discard'; on: boolean }
  | { type: 'set-idle-minutes'; minutes: number }
  | { type: 'set-never-domains'; domains: string[] }
  | { type: 'discard-tab'; tabId?: number }
  | { type: 'reload-tab'; tabId?: number }
  | { type: 'run-discard-sweep' }
  | { type: 'preview-rule'; sentence: string }
  | { type: 'save-rule'; sentence: string; domains: string[]; title: string }
  | { type: 'delete-rule'; id: string }
  | { type: 'sweep'; windowId: number }
  | { type: 'list-models' }
  | { type: 'test-ollama' }
  | { type: 'list-groups'; windowId: number }
  | {
      type: 'update-group'
      groupId: number
      title?: string
      color?: ChromeColor
      collapsed?: boolean
    }
  | { type: 'ungroup'; groupId: number }
  | { type: 'retitle-groups'; windowId: number }
  | {
      type: 'get-activity'
      limit?: number
      actor?: ActivityActor | 'all'
      filter?: ActivityFilter
    }
  | { type: 'clear-activity' }
