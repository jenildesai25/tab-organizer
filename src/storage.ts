import type { CompiledRule } from './domain/types.js'

export type Settings = {
  organizerOn: boolean
  llmOn: boolean
  model: string
  rules: CompiledRule[]
}

export const DEFAULT_SETTINGS: Settings = {
  organizerOn: false,
  llmOn: false,
  model: '',
  rules: [],
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS)
  return {
    organizerOn: stored.organizerOn === true,
    llmOn: stored.llmOn === true,
    model: typeof stored.model === 'string' ? stored.model : '',
    rules: Array.isArray(stored.rules) ? (stored.rules as CompiledRule[]) : [],
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set(settings)
}
