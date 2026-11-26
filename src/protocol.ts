import type { SweepDiag } from './domain/sweep-diag.js'
import type { CompiledRule } from './domain/types.js'
import type { LocalModel } from './ollama.js'

export type { SweepDiag, SweepDiagSample } from './domain/sweep-diag.js'

export type PreviewResult =
  | { ok: true; confirmation: string; domains: string[]; title: string }
  | { ok: false; message: string }

export type StateResult = {
  organizerOn: boolean
  llmOn: boolean
  model: string
  rules: CompiledRule[]
  status: string
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

export type ToBackground =
  | { type: 'get-state' }
  | { type: 'set-organizer'; on: boolean }
  | { type: 'set-llm'; on: boolean }
  | { type: 'set-model'; model: string }
  | { type: 'preview-rule'; sentence: string }
  | { type: 'save-rule'; sentence: string; domains: string[]; title: string }
  | { type: 'delete-rule'; id: string }
  | { type: 'sweep'; windowId: number }
  | { type: 'list-models' }
