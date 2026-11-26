import type { ActivityActor, ActivityEntry, ActivityFilter } from './domain/activity-log.js'
import type { SweepDiag } from './domain/sweep-diag.js'
import type { CleanupUndoHint } from './domain/cleanup-undo.js'
import type { ProtectLists } from './domain/tab-cleanup.js'
import type { WorkspaceLayout } from './domain/workspace-layout.js'
import type { TabGroupView } from './domain/tab-groups.js'
import type { ChromeColor, CompiledRule } from './domain/types.js'
import type { LocalModel } from './ollama.js'

export type { ActivityActor, ActivityAction, ActivityEntry, ActivityFilter } from './domain/activity-log.js'
export type { SweepDiag, SweepDiagSample } from './domain/sweep-diag.js'
export type { CleanupUndoHint } from './domain/cleanup-undo.js'
export type { ProtectLists } from './domain/tab-cleanup.js'
export type { WorkspaceLayout, LayoutGroup } from './domain/workspace-layout.js'
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
  cleanupOn: boolean
  cleanupAgeDays: number
  protect: ProtectLists
  protectHandRenamed: boolean
  quietHoursOn: boolean
  quietHoursStart: number
  quietHoursEnd: number
  status: string
  /** Present while a retitle-groups job is running. */
  retitle?: RetitleProgress | null
  /** Active tab in the focused window — for “protect this site / page” controls. */
  activeTab?: {
    id: number
    title: string
    siteKey: string
    urlPattern: string
    protectedDomain: boolean
    protectedUrl: boolean
  } | null
  /** Present while the last clean-up can still be undone. */
  cleanupUndo?: CleanupUndoHint | null
}

export type CleanupPreviewResult =
  | {
      ok: true
      count: number
      ageDays: number
      scope: 'window' | 'all'
      /** Window the count came from. Manual clean-up must pass this back. */
      windowId?: number
      /** Tabs the user is about to confirm. Manual clean-up may close only these. */
      tabIds: number[]
      sampleSiteKeys: string[]
      summary: string
    }
  | { ok: false; message: string }

export type CleanupRunResult =
  | {
      ok: true
      closed: number
      skipped: number
      summary: string
      cleanupUndo?: CleanupUndoHint | null
    }
  | { ok: false; message: string }

export type CleanupUndoResult =
  | { ok: true; restored: number; summary: string }
  | { ok: false; message: string }

export type LayoutsResult = { ok: true; layouts: WorkspaceLayout[] }

export type SaveLayoutResult =
  | { ok: true; layouts: WorkspaceLayout[]; summary: string }
  | { ok: false; message: string }

export type ApplyLayoutResult =
  | { ok: true; grouped: number; groups: number; summary: string }
  | { ok: false; message: string }

export type ProtectUpdateResult =
  | { ok: true; protect: ProtectLists; summary: string }
  | { ok: false; message: string }

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

export type ToBackground =
  | { type: 'get-state' }
  | { type: 'set-organizer'; on: boolean }
  | { type: 'set-llm'; on: boolean }
  | { type: 'set-model'; model: string }
  | { type: 'preview-rule'; sentence: string }
  | { type: 'save-rule'; sentence: string; domains: string[]; title: string }
  | { type: 'delete-rule'; id: string }
  | { type: 'sweep'; windowId: number }
  | { type: 'sweep-all' }
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
  | { type: 'set-cleanup'; on: boolean }
  | { type: 'set-cleanup-age'; days: number }
  | { type: 'set-protect-domains'; domains: string[] }
  | { type: 'apply-protect-preset'; id: string }
  | { type: 'set-protect-hand-renamed'; on: boolean }
  | { type: 'set-quiet-hours'; on: boolean; startHour?: number; endHour?: number }
  | { type: 'protect-group'; groupId: number; protect: boolean }
  | { type: 'protect-domain'; domain: string; protect: boolean }
  | { type: 'protect-url'; url: string; protect: boolean }
  | { type: 'remove-protect-domain'; domain: string }
  | { type: 'remove-protect-group'; groupId: number }
  | { type: 'remove-protect-url'; url: string }
  /** Dry-run count for confirmation UI. Manual defaults to this window. */
  | { type: 'preview-cleanup'; windowId?: number; scope?: 'window' | 'all' }
  /**
   * Close old tabs the user already previewed.
   * `tabIds` is the set they confirmed. The alarm does not use this message.
   */
  | {
      type: 'run-cleanup'
      windowId?: number
      scope?: 'window' | 'all'
      confirm?: boolean
      tabIds?: number[]
    }
  | { type: 'undo-cleanup' }
  | { type: 'list-layouts' }
  | { type: 'save-layout'; name: string; windowId?: number }
  | { type: 'apply-layout'; id: string; windowId?: number }
  | { type: 'delete-layout'; id: string }
