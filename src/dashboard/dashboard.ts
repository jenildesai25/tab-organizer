import type { CompiledRule } from '../domain/types.js'
import type { LocalModel } from '../ollama.js'
import type { ModelsResult, PreviewResult, StateResult, ToBackground } from '../protocol.js'
import { bindSweep } from '../ui/sweep.js'

const status = document.querySelector<HTMLParagraphElement>('#status')!
const sweep = document.querySelector<HTMLButtonElement>('#sweep')!
const resultLine = document.querySelector<HTMLParagraphElement>('#result')!
const sentence = document.querySelector<HTMLTextAreaElement>('#sentence')!
const save = document.querySelector<HTMLButtonElement>('#save')!
const confirmation = document.querySelector<HTMLParagraphElement>('#confirmation')!
const rules = document.querySelector<HTMLUListElement>('#rules')!
const form = document.querySelector<HTMLFormElement>('#rule-form')!
const llm = document.querySelector<HTMLInputElement>('#llm')!
const modelSelect = document.querySelector<HTMLSelectElement>('#model')!
const refresh = document.querySelector<HTMLButtonElement>('#refresh-models')!
const modelStatus = document.querySelector<HTMLParagraphElement>('#model-status')!

let draft: { domains: string[]; title: string } | null = null
let models: LocalModel[] = []
let selected = ''
let listedOnce = false

async function send<T>(message: ToBackground): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>
}

function showModelStatus(text: string): void {
  modelStatus.textContent = text
  modelStatus.hidden = text === ''
}

function optionLabel(model: LocalModel): string {
  return model.parameterSize ? `${model.name} · ${model.parameterSize}` : model.name
}

function renderRules(list: CompiledRule[]): void {
  rules.replaceChildren()
  for (const rule of list) {
    const item = document.createElement('li')
    const text = document.createElement('p')
    text.textContent = rule.sentence
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = 'Delete'
    remove.addEventListener('click', () => {
      void send<StateResult>({ type: 'delete-rule', id: rule.id }).then(renderState)
    })
    item.append(text, remove)
    rules.append(item)
  }
}

function renderModels(): void {
  const match = models.some((model) => model.name === selected)
  modelSelect.replaceChildren()
  if (models.length === 0 || !match) {
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = listedOnce && models.length === 0 ? 'No models' : 'Choose a model'
    modelSelect.append(placeholder)
  }
  for (const model of models) {
    const option = document.createElement('option')
    option.value = model.name
    option.textContent = optionLabel(model)
    modelSelect.append(option)
  }
  modelSelect.value = match ? selected : ''
}

function renderState(state: StateResult): void {
  llm.checked = state.llmOn
  selected = state.model
  status.textContent = state.status
  renderRules(state.rules)
  renderModels()
}

function clearDraft(): void {
  draft = null
  save.disabled = true
  confirmation.hidden = true
  confirmation.textContent = ''
}

async function loadModels(): Promise<void> {
  refresh.disabled = true
  refresh.setAttribute('aria-busy', 'true')
  try {
    const listed = await send<ModelsResult>({ type: 'list-models' })
    listedOnce = true
    if (!listed.ok) {
      models = []
      showModelStatus(listed.message ?? "Ollama isn't running.")
      renderModels()
      return
    }
    models = listed.models
    showModelStatus(listed.models.length === 0 ? 'Ollama has no models yet.' : '')
    renderModels()
  } catch {
    listedOnce = true
    models = []
    showModelStatus("Ollama isn't running.")
    renderModels()
  } finally {
    refresh.disabled = false
    refresh.removeAttribute('aria-busy')
  }
}

bindSweep(sweep, resultLine, renderState)

llm.addEventListener('change', () => {
  void send<StateResult>({ type: 'set-llm', on: llm.checked }).then((state) => {
    renderState(state)
    if (state.llmOn) void loadModels()
  })
})

modelSelect.addEventListener('change', () => {
  const name = modelSelect.value
  if (!name) return
  void send<StateResult>({ type: 'set-model', model: name }).then(renderState)
})

refresh.addEventListener('click', () => {
  void loadModels()
})

sentence.addEventListener('input', clearDraft)

form.addEventListener('submit', (event) => {
  event.preventDefault()
  void (async () => {
    const preview = await send<PreviewResult>({ type: 'preview-rule', sentence: sentence.value })
    confirmation.hidden = false
    if (!preview.ok) {
      draft = null
      save.disabled = true
      confirmation.textContent = preview.message
      return
    }
    draft = { domains: preview.domains, title: preview.title }
    save.disabled = false
    confirmation.textContent = preview.confirmation
  })()
})

save.addEventListener('click', () => {
  const pending = draft
  if (!pending) return
  void (async () => {
    const saved = await send<PreviewResult & { rules?: CompiledRule[] }>({
      type: 'save-rule',
      sentence: sentence.value,
      domains: pending.domains,
      title: pending.title,
    })
    confirmation.hidden = false
    confirmation.textContent = saved.ok ? saved.confirmation : saved.message
    if (!saved.ok) return
    sentence.value = ''
    clearDraft()
    renderState(await send<StateResult>({ type: 'get-state' }))
  })()
})

void send<StateResult>({ type: 'get-state' }).then((state) => {
  renderState(state)
  if (state.llmOn) void loadModels()
})
