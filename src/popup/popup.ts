import type { LocalModel } from '../ollama.js'
import type {
  ListGroupsResult,
  ModelsResult,
  RetitleGroupsResult,
  StateResult,
  ToBackground,
  TestOllamaResult,
} from '../protocol.js'
import { bindModelPicker } from '../ui/model-picker.js'
import { paintOllamaStatus } from '../ui/ollama-status.js'
import { paintRetitleResults } from '../ui/retitle-results.js'
import { bindSweep, browserWindow } from '../ui/sweep.js'
import { bindThemeToggle } from '../ui/theme.js'

const organizer = document.querySelector<HTMLInputElement>('#organizer')!
const llm = document.querySelector<HTMLInputElement>('#llm')!
const llmControls = document.querySelector<HTMLDivElement>('#llm-controls')!
const modelPickerRoot = document.querySelector<HTMLElement>('#model-picker')!
const testOllama = document.querySelector<HTMLButtonElement>('#test-ollama')!
const retitleButton = document.querySelector<HTMLButtonElement>('#retitle-groups')!
const modelStatus = document.querySelector<HTMLElement>('#model-status')!
const sweep = document.querySelector<HTMLButtonElement>('#sweep')!
const resultLine = document.querySelector<HTMLParagraphElement>('#result')!
const status = document.querySelector<HTMLParagraphElement>('#status')!
const openRules = document.querySelector<HTMLButtonElement>('#open-rules')!
const openSettings = document.querySelector<HTMLButtonElement>('#open-settings')!
const manageGroups = document.querySelector<HTMLButtonElement>('#manage-groups')!
const groupsSummary = document.querySelector<HTMLParagraphElement>('#groups-summary')!
const groupsError = document.querySelector<HTMLParagraphElement>('#groups-error')!
const refreshGroups = document.querySelector<HTMLButtonElement>('#refresh-groups')!
const progressPanel = document.querySelector<HTMLElement>('#progress-panel')
const progressBar = document.querySelector<HTMLProgressElement>('#organize-progress')
const progressLabel = document.querySelector<HTMLElement>('#progress-label')
const progressValue = document.querySelector<HTMLElement>('#progress-value')
const ollamaPill = document.querySelector<HTMLElement>('#ollama-pill')!
const ollamaPillLabel = document.querySelector<HTMLElement>('#ollama-pill-label')!

const TEST_LABEL = 'Test connection'
const RETITLE_LABEL = 'AI rename'

let models: LocalModel[] = []
let selected = ''
let listedOnce = false
let groupCount = 0
let llmOn = false
let testBusy = false
let retitleBusy = false
let retitlePoll: ReturnType<typeof setInterval> | null = null

async function send<T>(message: ToBackground): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>
}

function showModelStatus(text: string): void {
  paintOllamaStatus(modelStatus, text)
}

function showGroupsError(text: string): void {
  groupsError.textContent = text
  groupsError.hidden = text === ''
}

function optionLabel(model: LocalModel): string {
  return model.parameterSize ? `${model.name} · ${model.parameterSize}` : model.name
}

function paintOllamaPill(ok: boolean | null, label: string, title: string): void {
  if (!label) {
    ollamaPill.hidden = true
    return
  }
  ollamaPill.hidden = false
  ollamaPill.classList.toggle('is-ok', ok === true)
  ollamaPill.classList.toggle('is-warn', ok === false)
  ollamaPill.title = title
  ollamaPillLabel.textContent = label
}

const modelPicker = bindModelPicker(modelPickerRoot, {
  onChange: (name) => {
    selected = name
    syncLlmControls()
    if (!name) return
    void (async () => {
      renderState(await send<StateResult>({ type: 'set-model', model: name }))
    })()
  },
})

function renderModels(): void {
  const match = models.some((model) => model.name === selected)
  const emptyLabel = listedOnce && models.length === 0 ? 'No models' : 'Choose a model'
  modelPicker.setOptions(
    models.map((model) => ({ value: model.name, label: optionLabel(model) })),
    match ? selected : '',
    emptyLabel,
  )
}

function syncLlmControls(): void {
  llmControls.hidden = !llmOn
  llmControls.classList.toggle('is-collapsed', !llmOn)
  if (!llmOn) modelPicker.close()
  const ready = llmOn && selected !== ''
  if (testBusy) {
    testOllama.disabled = true
    testOllama.setAttribute('aria-busy', 'true')
  } else {
    testOllama.removeAttribute('aria-busy')
    testOllama.textContent = TEST_LABEL
    testOllama.disabled = !llmOn
  }
  if (retitleBusy) {
    retitleButton.disabled = true
  } else {
    retitleButton.textContent = RETITLE_LABEL
    retitleButton.disabled = !ready
  }
  if (!llmOn) {
    paintOllamaPill(null, 'Local model off', 'Turn on Local model to use Ollama')
  } else if (selected) {
    paintOllamaPill(true, selected, `Local model · ${selected}`)
  } else if (listedOnce && models.length === 0) {
    paintOllamaPill(false, 'no models', "Ollama has no models yet")
  } else {
    paintOllamaPill(false, 'pick model', 'Choose a local model')
  }
}

function applyRetitleProgress(state: StateResult): void {
  if (!retitleBusy || !state.retitle || state.retitle.total <= 0) return
  const label = `Renaming ${state.retitle.current}/${state.retitle.total}…`
  retitleButton.textContent = label
  if (state.retitle.results && state.retitle.results.length > 0) {
    paintRetitleResults(modelStatus, label, state.retitle.results)
  }
}

function clearRetitleResults(): void {
  paintOllamaStatus(modelStatus, '')
}

function renderGroupsSummary(): void {
  if (groupCount === 0) {
    groupsSummary.textContent = 'No groups in this window'
    return
  }
  groupsSummary.textContent =
    groupCount === 1 ? '1 group in this window' : `${groupCount} groups in this window`
}

function renderState(state: StateResult): void {
  organizer.checked = state.organizerOn
  llmOn = state.llmOn
  llm.checked = state.llmOn
  selected = state.model
  status.textContent = state.status
  renderModels()
  syncLlmControls()
}

async function loadGroups(): Promise<void> {
  refreshGroups.disabled = true
  try {
    const win = await browserWindow()
    if (win?.id == null) {
      groupCount = 0
      showGroupsError('This window has no tab strip to inspect.')
      renderGroupsSummary()
      return
    }
    const listed = await send<ListGroupsResult>({ type: 'list-groups', windowId: win.id })
    if (!listed.ok) {
      groupCount = 0
      showGroupsError(listed.message)
      renderGroupsSummary()
      return
    }
    groupCount = listed.groups.length
    showGroupsError('')
    renderGroupsSummary()
  } catch {
    groupCount = 0
    showGroupsError('Could not list groups.')
    renderGroupsSummary()
  } finally {
    refreshGroups.disabled = false
  }
}

async function loadModels(): Promise<void> {
  const hadModels = models.length > 0
  try {
    const listed = await send<ModelsResult>({ type: 'list-models' })
    listedOnce = true
    if (!listed.ok) {
      if (!hadModels) models = []
      showModelStatus(
        listed.message ??
          "Ollama isn't running. Start it with `ollama serve`, then try again.",
      )
      paintOllamaPill(false, 'offline', listed.message ?? "Ollama isn't running")
      renderModels()
      syncLlmControls()
      return
    }
    models = listed.models
    showModelStatus(listed.models.length === 0 ? 'Ollama has no models yet.' : '')
    renderModels()
    syncLlmControls()
  } catch {
    listedOnce = true
    if (!hadModels) models = []
    showModelStatus("Ollama isn't running. Start it with `ollama serve`, then try again.")
    paintOllamaPill(false, 'offline', "Ollama isn't running")
    renderModels()
    syncLlmControls()
  }
}

function openDashboardPage(hash = ''): void {
  const path = hash ? `dashboard/index.html${hash}` : 'dashboard/index.html'
  void chrome.tabs.create({ url: chrome.runtime.getURL(path) })
}

organizer.addEventListener('change', () => {
  void (async () => {
    renderState(await send<StateResult>({ type: 'set-organizer', on: organizer.checked }))
  })()
})

llm.addEventListener('change', () => {
  void (async () => {
    const state = await send<StateResult>({ type: 'set-llm', on: llm.checked })
    renderState(state)
    if (state.llmOn) await loadModels()
    else showModelStatus('')
  })()
})

testOllama.addEventListener('click', () => {
  if (testBusy) return
  if (!llmOn) {
    showModelStatus('Turn on the local model.')
    return
  }
  if (!selected) {
    showModelStatus('Choose a local model.')
    return
  }
  void (async () => {
    testBusy = true
    syncLlmControls()
    testOllama.textContent = 'Warming…'
    showModelStatus('Warming model…')
    try {
      const result = await send<TestOllamaResult>({ type: 'test-ollama' })
      showModelStatus(result.message)
      paintOllamaPill(result.ok, selected, result.message)
    } catch {
      showModelStatus('Could not reach Ollama.')
      paintOllamaPill(false, 'offline', 'Could not reach Ollama.')
    } finally {
      testBusy = false
      syncLlmControls()
    }
  })()
})

retitleButton.addEventListener('click', () => {
  if (retitleBusy) return
  if (!llmOn) {
    showModelStatus('Turn on the local model.')
    return
  }
  if (!selected) {
    showModelStatus('Choose a local model.')
    return
  }
  void (async () => {
    retitleBusy = true
    retitleButton.setAttribute('aria-busy', 'true')
    retitleButton.textContent = 'Renaming…'
    syncLlmControls()
    clearRetitleResults()
    retitlePoll = setInterval(() => {
      void (async () => {
        if (!retitleBusy) return
        const state = await send<StateResult>({ type: 'get-state' })
        if (!retitleBusy) return
        applyRetitleProgress(state)
      })()
    }, 400)
    try {
      const win = await browserWindow()
      if (win?.id == null) {
        showModelStatus('This window has no tab strip to rename.')
        return
      }
      const result = await send<RetitleGroupsResult>({ type: 'retitle-groups', windowId: win.id })
      if (!result.ok) {
        showModelStatus(result.message)
        return
      }
      paintRetitleResults(modelStatus, result.summary, result.results)
      await loadGroups()
    } catch {
      showModelStatus('Could not rename groups.')
    } finally {
      if (retitlePoll) {
        clearInterval(retitlePoll)
        retitlePoll = null
      }
      retitleBusy = false
      retitleButton.removeAttribute('aria-busy')
      retitleButton.textContent = RETITLE_LABEL
      syncLlmControls()
    }
  })()
})

bindSweep(
  sweep,
  resultLine,
  renderState,
  (response) => {
    if (response.ok) clearRetitleResults()
    void loadGroups()
  },
  {
    panel: progressPanel,
    bar: progressBar,
    label: progressLabel,
    value: progressValue,
  },
)

refreshGroups.addEventListener('click', () => {
  void loadGroups()
})

openRules.addEventListener('click', () => {
  openDashboardPage('#rules')
})
openSettings.addEventListener('click', () => {
  openDashboardPage('#settings')
})
manageGroups.addEventListener('click', () => {
  openDashboardPage('#groups')
})

void bindThemeToggle()
void (async () => {
  const state = await send<StateResult>({ type: 'get-state' })
  renderState(state)
  if (state.llmOn) await loadModels()
})()
void loadGroups()
