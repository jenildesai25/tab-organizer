import type { ActivityActor } from '../domain/activity-log.js'
import type { ChromeColor, CompiledRule } from '../domain/types.js'
import type { TabGroupView } from '../domain/tab-groups.js'
import type { LocalModel } from '../ollama.js'
import type {
  ActivityLogResult,
  ClearActivityResult,
  ListGroupsResult,
  ModelsResult,
  PreviewResult,
  RetitleGroupsResult,
  StateResult,
  TestOllamaResult,
  ToBackground,
  UngroupResult,
  UpdateGroupResult,
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
const testOllama = document.querySelector<HTMLButtonElement>('#test-ollama')!
const modelStatus = document.querySelector<HTMLElement>('#model-status')!
const retitleBlock = document.querySelector<HTMLDivElement>('#retitle-block')!
const retitleButton = document.querySelector<HTMLButtonElement>('#retitle-groups')!
const groupsList = document.querySelector<HTMLUListElement>('#groups')!
const groupsEmpty = document.querySelector<HTMLParagraphElement>('#groups-empty')!
const groupsError = document.querySelector<HTMLParagraphElement>('#groups-error')!
const refreshGroups = document.querySelector<HTMLButtonElement>('#refresh-groups')!
const activityList = document.querySelector<HTMLUListElement>('#activity')!
const activityEmpty = document.querySelector<HTMLParagraphElement>('#activity-empty')!
const refreshActivity = document.querySelector<HTMLButtonElement>('#refresh-activity')!
const clearActivity = document.querySelector<HTMLButtonElement>('#clear-activity')!
const activityActor = document.querySelector<HTMLSelectElement>('#activity-actor')!

const RETITLE_LABEL = 'Rename all groups with AI'
const TEST_LABEL = 'Test connection'

let draft: { domains: string[]; title: string } | null = null
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
let retitleBusy = false
let testBusy = false
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
      void (async () => {
        renderState(await send<StateResult>({ type: 'delete-rule', id: rule.id }))
      })()
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

function closeOverlays(): void {
  groupUi = { ...groupUi, openPickerId: null, openMenuId: null }
}

async function commitTitle(group: TabGroupView, title: string): Promise<void> {
  if (!group.editable) return
  if (title === group.title) return
  const result = await send<UpdateGroupResult>({
    type: 'update-group',
    groupId: group.id,
    title,
  })
  if (!result.ok) {
    showGroupsError(result.message)
    renderGroups()
    return
  }
  showGroupsError('')
  await loadGroups()
  await loadActivity()
}

async function commitColor(group: TabGroupView, color: ChromeColor): Promise<void> {
  if (!group.editable || color === group.color) {
    closeOverlays()
    renderGroups()
    return
  }
  const result = await send<UpdateGroupResult>({
    type: 'update-group',
    groupId: group.id,
    color,
  })
  closeOverlays()
  if (!result.ok) {
    showGroupsError(result.message)
    renderGroups()
    return
  }
  showGroupsError('')
  await loadGroups()
  await loadActivity()
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
  onColor: (group, color) => {
    void commitColor(group, color)
  },
  onTitleCommit: (group, title) => {
    void commitTitle(group, title)
  },
  onRequestUngroup: (groupId) => {
    groupUi = { ...groupUi, pendingDeleteId: groupId, openMenuId: null, openPickerId: null }
    renderGroups()
  },
  onConfirmUngroup: (groupId) => {
    void confirmUngroup(groupId)
  },
  onCancelUngroup: () => {
    groupUi = { ...groupUi, pendingDeleteId: null }
    renderGroups()
  },
  onTogglePicker: (groupId) => {
    groupUi = {
      ...groupUi,
      openPickerId: groupId,
      openMenuId: null,
      pendingDeleteId: null,
    }
    renderGroups()
  },
  onToggleMenu: (groupId) => {
    groupUi = {
      ...groupUi,
      openMenuId: groupId,
      openPickerId: null,
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
  renderGroupList(groupsList, groups, 'manage', groupUi, groupHandlers, renamedFlashIds)
}

function syncRetitleControls(): void {
  const ready = llmOn && selected !== ''
  retitleBlock.hidden = !llmOn
  if (retitleBusy) {
    retitleButton.disabled = true
    return
  }
  retitleButton.disabled = !ready
  if (!retitleBusy) retitleButton.textContent = RETITLE_LABEL
}

function syncTestControls(): void {
  if (testBusy) {
    testOllama.disabled = true
    testOllama.setAttribute('aria-busy', 'true')
    return
  }
  testOllama.removeAttribute('aria-busy')
  testOllama.textContent = TEST_LABEL
  testOllama.disabled = !llmOn
}

function renderState(state: StateResult): void {
  llmOn = state.llmOn
  llm.checked = state.llmOn
  selected = state.model
  status.textContent = state.status
  renderRules(state.rules)
  renderModels()
  if (retitleBusy && state.retitle && state.retitle.total > 0) {
    const label = `Renaming ${state.retitle.current}/${state.retitle.total}…`
    retitleButton.textContent = label
    if (state.retitle.results && state.retitle.results.length > 0) {
      paintRetitleResults(modelStatus, label, state.retitle.results)
    }
  }
  syncRetitleControls()
  syncTestControls()
}

function clearDraft(): void {
  draft = null
  save.disabled = true
  confirmation.hidden = true
  confirmation.textContent = ''
}

async function loadGroups(): Promise<void> {
  refreshGroups.disabled = true
  refreshGroups.setAttribute('aria-busy', 'true')
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
    refreshGroups.removeAttribute('aria-busy')
  }
}

async function loadModels(): Promise<void> {
  refresh.disabled = true
  refresh.setAttribute('aria-busy', 'true')
  const hadModels = models.length > 0
  try {
    const listed = await send<ModelsResult>({ type: 'list-models' })
    listedOnce = true
    if (!listed.ok) {
      if (!hadModels) models = []
      showModelStatus(
        listed.message ??
          "Ollama isn't running. Start it with `ollama serve`, then hit Refresh.",
      )
      renderModels()
      return
    }
    models = listed.models
    showModelStatus(listed.models.length === 0 ? 'Ollama has no models yet.' : '')
    renderModels()
  } catch {
    listedOnce = true
    if (!hadModels) models = []
    showModelStatus("Ollama isn't running. Start it with `ollama serve`, then hit Refresh.")
    renderModels()
  } finally {
    refresh.disabled = false
    refresh.removeAttribute('aria-busy')
  }
}

function selectedActivityActor(): ActivityActor | 'all' {
  const value = activityActor.value
  if (
    value === 'ai' ||
    value === 'rule' ||
    value === 'sweep' ||
    value === 'organizer' ||
    value === 'user' ||
    value === 'system'
  ) {
    return value
  }
  return 'all'
}

async function loadActivity(): Promise<void> {
  refreshActivity.disabled = true
  try {
    const result = await send<ActivityLogResult>({
      type: 'get-activity',
      actor: selectedActivityActor(),
    })
    paintActivityList(activityList, activityEmpty, result.ok ? result.entries : [], {
      emptyText: 'No activity yet.',
    })
  } catch {
    paintActivityList(activityList, activityEmpty, [], { emptyText: 'Could not load activity.' })
  } finally {
    refreshActivity.disabled = false
  }
}

bindSweep(sweep, resultLine, renderState, (response) => {
  if (response.ok) clearRetitleResults()
  void loadGroups()
  void loadActivity()
})

refreshGroups.addEventListener('click', () => {
  groupUi = { openPickerId: null, pendingDeleteId: null, openMenuId: null }
  void loadGroups()
})

refreshActivity.addEventListener('click', () => {
  void loadActivity()
})

activityActor.addEventListener('change', () => {
  void loadActivity()
})

clearActivity.addEventListener('click', () => {
  void (async () => {
    clearActivity.disabled = true
    try {
      await send<ClearActivityResult>({ type: 'clear-activity' })
      await loadActivity()
    } finally {
      clearActivity.disabled = false
    }
  })()
})

document.addEventListener('click', () => {
  if (groupUi.openPickerId == null && groupUi.openMenuId == null) return
  closeOverlays()
  renderGroups()
})

llm.addEventListener('change', () => {
  void (async () => {
    const state = await send<StateResult>({ type: 'set-llm', on: llm.checked })
    renderState(state)
    if (state.llmOn) await loadModels()
    else showModelStatus('')
  })()
})

modelSelect.addEventListener('change', () => {
  const name = modelSelect.value
  selected = name
  syncRetitleControls()
  syncTestControls()
  if (!name) return
  void (async () => {
    renderState(await send<StateResult>({ type: 'set-model', model: name }))
  })()
})

refresh.addEventListener('click', () => {
  void loadModels()
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
    syncTestControls()
    testOllama.textContent = 'Warming…'
    showModelStatus('Warming model…')
    try {
      const result = await send<TestOllamaResult>({ type: 'test-ollama' })
      showModelStatus(result.message)
    } catch {
      showModelStatus('Could not reach Ollama.')
    } finally {
      testBusy = false
      syncTestControls()
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
    retitleButton.disabled = true
    retitleButton.setAttribute('aria-busy', 'true')
    retitleButton.textContent = 'Renaming…'
    clearRetitleResults()
    flashRenamed([])
    retitlePoll = setInterval(() => {
      void (async () => {
        if (!retitleBusy) return
        const state = await send<StateResult>({ type: 'get-state' })
        if (!retitleBusy) return
        if (state.retitle && state.retitle.total > 0) {
          const label = `Renaming ${state.retitle.current}/${state.retitle.total}…`
          retitleButton.textContent = label
          if (state.retitle.results && state.retitle.results.length > 0) {
            paintRetitleResults(modelStatus, label, state.retitle.results)
          }
        }
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
      syncRetitleControls()
    }
  })()
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
    await loadActivity()
  })()
})

void (async () => {
  const state = await send<StateResult>({ type: 'get-state' })
  renderState(state)
  if (state.llmOn) await loadModels()
})()
void loadGroups()
void loadActivity()
