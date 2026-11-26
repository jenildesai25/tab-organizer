import type { TabGroupView } from '../domain/tab-groups.js'
import type { LocalModel } from '../ollama.js'
import type {
  ActivityLogResult,
  ListGroupsResult,
  ModelsResult,
  RetitleGroupsResult,
  StateResult,
  TestOllamaResult,
  ToBackground,
  UngroupResult,
} from '../protocol.js'
import { paintActivityList } from '../ui/activity.js'
import {
  renderGroupList,
  type GroupListController,
  type GroupListHandlers,
} from '../ui/groups.js'
import { paintOllamaStatus } from '../ui/ollama-status.js'
import { paintRetitleResults } from '../ui/retitle-results.js'
import { bindSweep, browserWindow } from '../ui/sweep.js'
import { bindThemeToggle } from '../ui/theme.js'

const organizer = document.querySelector<HTMLInputElement>('#organizer')!
const llm = document.querySelector<HTMLInputElement>('#llm')!
const llmControls = document.querySelector<HTMLDivElement>('#llm-controls')!
const modelSelect = document.querySelector<HTMLSelectElement>('#model')!
const testOllama = document.querySelector<HTMLButtonElement>('#test-ollama')!
const retitleButton = document.querySelector<HTMLButtonElement>('#retitle-groups')!
const modelStatus = document.querySelector<HTMLElement>('#model-status')!
const sweep = document.querySelector<HTMLButtonElement>('#sweep')!
const resultLine = document.querySelector<HTMLParagraphElement>('#result')!
const status = document.querySelector<HTMLParagraphElement>('#status')!
const openDashboard = document.querySelector<HTMLButtonElement>('#open-dashboard')!
const groupsList = document.querySelector<HTMLUListElement>('#groups')!
const groupsEmpty = document.querySelector<HTMLParagraphElement>('#groups-empty')!
const groupsError = document.querySelector<HTMLParagraphElement>('#groups-error')!
const refreshGroups = document.querySelector<HTMLButtonElement>('#refresh-groups')!
const activityList = document.querySelector<HTMLUListElement>('#activity')!
const activityEmpty = document.querySelector<HTMLParagraphElement>('#activity-empty')!
const refreshActivity = document.querySelector<HTMLButtonElement>('#refresh-activity')!
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
let groups: TabGroupView[] = []
let groupUi: GroupListController = {
  openPickerId: null,
  pendingDeleteId: null,
  openMenuId: null,
}
let llmOn = false
let testBusy = false
let retitleBusy = false
let retitlePoll: ReturnType<typeof setInterval> | null = null
let renamedFlashIds: Set<number> = new Set()
let renamedFlashTimer: ReturnType<typeof setTimeout> | null = null

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

function paintOllamaPill(ok: boolean, label: string, title: string): void {
  if (!label) {
    ollamaPill.hidden = true
    return
  }
  ollamaPill.hidden = false
  ollamaPill.classList.toggle('is-ok', ok)
  ollamaPill.classList.toggle('is-warn', !ok)
  ollamaPill.title = title
  ollamaPillLabel.textContent = label
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

function syncLlmControls(): void {
  llmControls.hidden = !llmOn
  llmControls.classList.toggle('is-collapsed', !llmOn)
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
    ollamaPill.hidden = true
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

async function confirmUngroup(groupId: number): Promise<void> {
  const result = await send<UngroupResult>({ type: 'ungroup', groupId })
  groupUi = { ...groupUi, pendingDeleteId: null, openMenuId: null }
  if (!result.ok) {
    showGroupsError(result.message)
    renderGroups()
    return
  }
  showGroupsError('')
  await loadGroups()
  await loadActivity()
}

const groupHandlers: GroupListHandlers = {
  onColor: () => {
    // Compact popup rows are read-mostly; recolor lives on the dashboard.
  },
  onTitleCommit: () => {
    // Compact popup rows are read-mostly; rename lives on the dashboard.
  },
  onRequestUngroup: (groupId) => {
    groupUi = { ...groupUi, pendingDeleteId: groupId, openMenuId: null }
    renderGroups()
  },
  onConfirmUngroup: (groupId) => {
    void confirmUngroup(groupId)
  },
  onCancelUngroup: () => {
    groupUi = { ...groupUi, pendingDeleteId: null }
    renderGroups()
  },
  onTogglePicker: () => {
    // no-op in compact mode
  },
  onToggleMenu: (groupId) => {
    groupUi = {
      ...groupUi,
      openMenuId: groupId,
      pendingDeleteId: groupId == null ? groupUi.pendingDeleteId : null,
    }
    renderGroups()
  },
}

function clearRetitleResults(): void {
  paintOllamaStatus(modelStatus, '')
}

function flashRenamed(ids: Iterable<number>): void {
  if (renamedFlashTimer) {
    clearTimeout(renamedFlashTimer)
    renamedFlashTimer = null
  }
  renamedFlashIds = new Set(ids)
  renderGroups()
  if (renamedFlashIds.size === 0) return
  renamedFlashTimer = setTimeout(() => {
    renamedFlashIds = new Set()
    renamedFlashTimer = null
    renderGroups()
  }, 1800)
}

function renderGroups(): void {
  const empty = groups.length === 0
  groupsEmpty.hidden = !empty || !groupsError.hidden
  if (empty) {
    groupsList.replaceChildren()
    return
  }
  renderGroupList(groupsList, groups, 'compact', groupUi, groupHandlers, renamedFlashIds)
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
      groups = []
      showGroupsError('This window has no tab strip to inspect.')
      renderGroups()
      return
    }
    const listed = await send<ListGroupsResult>({ type: 'list-groups', windowId: win.id })
    if (!listed.ok) {
      groups = []
      showGroupsError(listed.message)
      renderGroups()
      return
    }
    groups = listed.groups
    showGroupsError('')
    renderGroups()
  } catch {
    groups = []
    showGroupsError('Could not list groups.')
    renderGroups()
  } finally {
    refreshGroups.disabled = false
  }
}

async function loadActivity(): Promise<void> {
  refreshActivity.disabled = true
  try {
    const result = await send<ActivityLogResult>({ type: 'get-activity', limit: 15 })
    paintActivityList(activityList, activityEmpty, result.ok ? result.entries : [], {
      limit: 15,
      emptyText: 'No activity yet.',
    })
  } catch {
    paintActivityList(activityList, activityEmpty, [], { emptyText: 'Could not load activity.' })
  } finally {
    refreshActivity.disabled = false
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
    else {
      showModelStatus('')
      ollamaPill.hidden = true
    }
  })()
})

modelSelect.addEventListener('change', () => {
  const name = modelSelect.value
  selected = name
  syncLlmControls()
  if (!name) return
  void (async () => {
    renderState(await send<StateResult>({ type: 'set-model', model: name }))
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
    flashRenamed([])
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
      flashRenamed(
        result.results.filter((entry) => entry.status === 'renamed').map((entry) => entry.groupId),
      )
      await loadGroups()
      await loadActivity()
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
    void loadActivity()
  },
  {
    panel: progressPanel,
    bar: progressBar,
    label: progressLabel,
    value: progressValue,
  },
)

refreshGroups.addEventListener('click', () => {
  groupUi = { openPickerId: null, pendingDeleteId: null, openMenuId: null }
  void loadGroups()
})

refreshActivity.addEventListener('click', () => {
  void loadActivity()
})

document.addEventListener('click', () => {
  if (groupUi.openMenuId == null) return
  groupUi = { ...groupUi, openMenuId: null }
  renderGroups()
})

openDashboard.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') })
})

void bindThemeToggle()
void (async () => {
  const state = await send<StateResult>({ type: 'get-state' })
  renderState(state)
  if (state.llmOn) await loadModels()
})()
void loadGroups()
void loadActivity()
