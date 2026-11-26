import type { ActivityFilter } from '../domain/activity-log.js'
import { CLEANUP_AGE_PRESETS, formatCleanupAgeLabel } from '../domain/tab-cleanup.js'
import type { ChromeColor, CompiledRule } from '../domain/types.js'
import type { TabGroupView } from '../domain/tab-groups.js'
import type { LocalModel } from '../ollama.js'
import type {
  ActivityLogResult,
  ApplyLayoutResult,
  CleanupPreviewResult,
  CleanupRunResult,
  CleanupUndoResult,
  ClearActivityResult,
  LayoutsResult,
  ListGroupsResult,
  ModelsResult,
  PreviewResult,
  ProtectUpdateResult,
  RetitleGroupsResult,
  SaveLayoutResult,
  StateResult,
  TestOllamaResult,
  ToBackground,
  UngroupResult,
  UpdateGroupResult,
  WorkspaceLayout,
} from '../protocol.js'
import { paintActivityList } from '../ui/activity.js'
import {
  renderGroupList,
  type GroupListController,
  type GroupListHandlers,
} from '../ui/groups.js'
import { bindModelPicker } from '../ui/model-picker.js'
import { paintOllamaStatus } from '../ui/ollama-status.js'
import { paintRetitleResults } from '../ui/retitle-results.js'
import { bindSweep, browserWindow } from '../ui/sweep.js'
import { bindThemeToggle } from '../ui/theme.js'

const status = document.querySelector<HTMLParagraphElement>('#status')!
const organizer = document.querySelector<HTMLInputElement>('#organizer')!
const quietHoursOn = document.querySelector<HTMLInputElement>('#quiet-hours-on')!
const quietHoursStart = document.querySelector<HTMLInputElement>('#quiet-hours-start')!
const quietHoursEnd = document.querySelector<HTMLInputElement>('#quiet-hours-end')!
const sweep = document.querySelector<HTMLButtonElement>('#sweep')!
const resultLine = document.querySelector<HTMLParagraphElement>('#result')!
const sentence = document.querySelector<HTMLTextAreaElement>('#sentence')!
const save = document.querySelector<HTMLButtonElement>('#save')!
const confirmation = document.querySelector<HTMLParagraphElement>('#confirmation')!
const rules = document.querySelector<HTMLUListElement>('#rule-list')!
const form = document.querySelector<HTMLFormElement>('#rule-form')!
const llm = document.querySelector<HTMLInputElement>('#llm')!
const modelPickerRoot = document.querySelector<HTMLElement>('#model-picker')!
const refresh = document.querySelector<HTMLButtonElement>('#refresh-models')!
const testOllama = document.querySelector<HTMLButtonElement>('#test-ollama')!
const modelStatus = document.querySelector<HTMLElement>('#model-status')!
const retitleButton = document.querySelector<HTMLButtonElement>('#retitle-groups')!
const groupsList = document.querySelector<HTMLUListElement>('#groups-list')!
const groupsEmpty = document.querySelector<HTMLParagraphElement>('#groups-empty')!
const groupsError = document.querySelector<HTMLParagraphElement>('#groups-error')!
const refreshGroups = document.querySelector<HTMLButtonElement>('#refresh-groups')!
const layoutForm = document.querySelector<HTMLFormElement>('#layout-form')!
const layoutName = document.querySelector<HTMLInputElement>('#layout-name')!
const saveLayout = document.querySelector<HTMLButtonElement>('#save-layout')!
const layoutsNote = document.querySelector<HTMLElement>('#layouts-note')!
const layoutsEmpty = document.querySelector<HTMLParagraphElement>('#layouts-empty')!
const layoutsList = document.querySelector<HTMLUListElement>('#layouts-list')!
const activityList = document.querySelector<HTMLUListElement>('#activity-list')!
const activityEmpty = document.querySelector<HTMLParagraphElement>('#activity-empty')!
const refreshActivity = document.querySelector<HTMLButtonElement>('#refresh-activity')!
const clearActivity = document.querySelector<HTMLButtonElement>('#clear-activity')!
const activityFilters = document.querySelector<HTMLElement>('.activity-filters')!
const clearActivityDialog = document.querySelector<HTMLDialogElement>('#clear-activity-dialog')!
const cleanupConfirmDialog = document.querySelector<HTMLDialogElement>('#cleanup-confirm-dialog')!
const cleanupConfirmBody = document.querySelector<HTMLElement>('#cleanup-confirm-body')!
const cleanupOn = document.querySelector<HTMLInputElement>('#cleanup-on')!
const cleanupAgeDays = document.querySelector<HTMLInputElement>('#cleanup-age-days')!
const cleanupAgePresets = document.querySelector<HTMLElement>('.cleanup-age-presets')!
const cleanupNow = document.querySelector<HTMLButtonElement>('#cleanup-now')!
const cleanupUndo = document.querySelector<HTMLButtonElement>('#cleanup-undo')!
const cleanupNote = document.querySelector<HTMLElement>('#cleanup-note')!
const protectDomains = document.querySelector<HTMLTextAreaElement>('#protect-domains')!
const protectPresets = document.querySelector<HTMLElement>('#protect-presets')!
const protectHandRenamed = document.querySelector<HTMLInputElement>('#protect-hand-renamed')!
const saveProtectDomains = document.querySelector<HTMLButtonElement>('#save-protect-domains')!
const protectActiveSite = document.querySelector<HTMLButtonElement>('#protect-active-site')!
const protectActivePage = document.querySelector<HTMLButtonElement>('#protect-active-page')!
const protectNote = document.querySelector<HTMLElement>('#protect-note')!
const protectEmpty = document.querySelector<HTMLParagraphElement>('#protect-empty')!
const protectList = document.querySelector<HTMLUListElement>('#protect-list')!
const progressPanel = document.querySelector<HTMLElement>('#progress-panel')
const progressBar = document.querySelector<HTMLProgressElement>('#organize-progress')
const progressLabel = document.querySelector<HTMLElement>('#progress-label')
const progressValue = document.querySelector<HTMLElement>('#progress-value')
const snapTabs = document.querySelector<HTMLElement>('#snap-tabs')!
const snapGroups = document.querySelector<HTMLElement>('#snap-groups')!
const snapFiling = document.querySelector<HTMLElement>('#snap-filing')!
const snapModel = document.querySelector<HTMLElement>('#snap-model')!
const healthConnected = document.querySelector<HTMLElement>('#health-connected')!
const healthModels = document.querySelector<HTMLElement>('#health-models')!
const healthWarm = document.querySelector<HTMLElement>('#health-warm')!
const versionLabel = document.querySelector<HTMLElement>('#version-label')

let latestState: StateResult | null = null
let pendingCleanupConfirm: { windowId?: number; tabIds: number[] } | null = null
let groupTitleById = new Map<number, string>()

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
let organizerOn = false
let retitleBusy = false
let testBusy = false
let retitlePoll: ReturnType<typeof setInterval> | null = null
let renamedFlashIds: Set<number> = new Set()
let renamedFlashTimer: ReturnType<typeof setTimeout> | null = null
let tabCountEstimate = 0

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

function showLayoutsNote(text: string): void {
  layoutsNote.textContent = text
  layoutsNote.hidden = text === ''
}

function renderLayouts(list: WorkspaceLayout[]): void {
  layoutsList.replaceChildren()
  layoutsEmpty.hidden = list.length > 0
  for (const layout of list) {
    const item = document.createElement('li')
    item.className = 'rule-row'
    const copy = document.createElement('div')
    const title = document.createElement('strong')
    title.textContent = layout.name
    const meta = document.createElement('span')
    const groupNoun = layout.groups.length === 1 ? 'group' : 'groups'
    meta.textContent = `${layout.groups.length} ${groupNoun}`
    copy.append(title, meta)
    const actions = document.createElement('div')
    actions.className = 'buttons'
    const apply = document.createElement('button')
    apply.type = 'button'
    apply.className = 'btn btn-ghost btn-tiny'
    apply.textContent = 'Apply'
    apply.setAttribute('aria-label', `Apply layout ${layout.name}`)
    apply.addEventListener('click', () => {
      void (async () => {
        apply.disabled = true
        showLayoutsNote('Applying layout…')
        try {
          const win = await browserWindow()
          const result = await send<ApplyLayoutResult>({
            type: 'apply-layout',
            id: layout.id,
            windowId: win?.id,
          })
          showLayoutsNote(result.ok ? result.summary : result.message)
          if (result.ok) {
            await loadGroups()
            await loadActivity()
          }
        } catch {
          showLayoutsNote('Could not apply layout.')
        } finally {
          apply.disabled = false
        }
      })()
    })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'btn btn-ghost btn-tiny'
    remove.textContent = 'Delete'
    remove.setAttribute('aria-label', `Delete layout ${layout.name}`)
    remove.addEventListener('click', () => {
      void (async () => {
        const result = await send<LayoutsResult>({ type: 'delete-layout', id: layout.id })
        if (result.ok) {
          renderLayouts(result.layouts)
          showLayoutsNote('Removed layout.')
        }
      })()
    })
    actions.append(apply, remove)
    item.append(copy, actions)
    layoutsList.append(item)
  }
}

async function loadLayouts(): Promise<void> {
  try {
    const result = await send<LayoutsResult>({ type: 'list-layouts' })
    if (result.ok) renderLayouts(result.layouts)
  } catch {
    showLayoutsNote('Could not load layouts.')
  }
}

function renderRules(list: CompiledRule[]): void {
  rules.replaceChildren()
  for (const rule of list) {
    const item = document.createElement('li')
    item.className = 'rule-row'
    const copy = document.createElement('div')
    const title = document.createElement('strong')
    title.textContent = rule.sentence
    const meta = document.createElement('span')
    meta.textContent =
      rule.domains.length > 0
        ? `${rule.domains.join(', ')} → ${rule.title}`
        : `→ ${rule.title}`
    copy.append(title, meta)
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'btn btn-ghost btn-tiny'
    remove.textContent = 'Delete'
    remove.setAttribute('aria-label', `Delete rule ${rule.sentence}`)
    remove.addEventListener('click', () => {
      void (async () => {
        renderState(await send<StateResult>({ type: 'delete-rule', id: rule.id }))
      })()
    })
    item.append(copy, remove)
    rules.append(item)
  }
}

const modelPicker = bindModelPicker(modelPickerRoot, {
  onChange: (name) => {
    selected = name
    syncRetitleControls()
    syncTestControls()
    paintSnapshot()
    paintHealth({ connected: listedOnce ? true : null })
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

function paintHealth(opts: {
  connected?: boolean | null
  message?: string
}): void {
  healthConnected.classList.remove('is-ok', 'is-warn')
  if (opts.connected === true) {
    healthConnected.classList.add('is-ok')
    healthConnected.replaceChildren()
    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.setAttribute('aria-hidden', 'true')
    healthConnected.append(dot, document.createTextNode(' Connected · localhost:11434'))
  } else if (opts.connected === false) {
    healthConnected.classList.add('is-warn')
    healthConnected.replaceChildren()
    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.setAttribute('aria-hidden', 'true')
    healthConnected.append(
      dot,
      document.createTextNode(opts.message?.trim() ? opts.message : ' Offline'),
    )
  } else {
    healthConnected.replaceChildren()
    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.setAttribute('aria-hidden', 'true')
    healthConnected.append(dot, document.createTextNode(' Not checked'))
  }

  if (models.length > 0) {
    healthModels.hidden = false
    healthModels.textContent = `${models.length} model${models.length === 1 ? '' : 's'} installed`
  } else {
    healthModels.hidden = true
  }

  if (llmOn && selected) {
    healthWarm.hidden = false
    healthWarm.textContent = `Warm · ${selected}`
  } else {
    healthWarm.hidden = true
  }
}

function paintSnapshot(): void {
  snapTabs.textContent = tabCountEstimate > 0 ? String(tabCountEstimate) : '—'
  snapGroups.textContent = String(groups.length)
  snapFiling.textContent = organizerOn ? 'On' : 'Off'
  snapFiling.classList.toggle('ok-text', organizerOn)
  if (llmOn && selected) {
    snapModel.textContent = selected
    snapModel.classList.add('ok-text')
  } else {
    snapModel.textContent = llmOn ? 'On' : 'Off'
    snapModel.classList.toggle('ok-text', llmOn)
  }
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
  onToggleCleanupProtect: (group) => {
    void (async () => {
      groupUi = { ...groupUi, openMenuId: null }
      const result = await send<ProtectUpdateResult>({
        type: 'protect-group',
        groupId: group.id,
        protect: !group.cleanupProtected,
      })
      showProtectNote(result.ok ? result.summary : result.message)
      if (result.ok) {
        latestState = latestState
          ? { ...latestState, protect: result.protect }
          : latestState
        paintProtect(result.protect)
      }
      await loadGroups()
    })()
  },
}

function showCleanupNote(text: string): void {
  cleanupNote.textContent = text
  cleanupNote.hidden = text === ''
}

function showProtectNote(text: string): void {
  protectNote.textContent = text
  protectNote.hidden = text === ''
}

function paintCleanupAge(days: number): void {
  cleanupAgeDays.value = String(days)
  for (const chip of Array.from(
    cleanupAgePresets.querySelectorAll<HTMLButtonElement>('.cleanup-age-chip'),
  )) {
    const value = Number(chip.dataset.days)
    chip.classList.toggle('is-active', value === days)
  }
}

function paintCleanupUndo(hint: StateResult['cleanupUndo']): void {
  const live = Boolean(hint && hint.closed > 0 && hint.expiresAt > Date.now())
  cleanupUndo.hidden = !live
  cleanupUndo.disabled = !live
  if (!live || !hint) {
    cleanupUndo.textContent = 'Undo last clean-up'
    return
  }
  cleanupUndo.textContent =
    hint.closed === 1 ? 'Undo last clean-up (1 tab)' : `Undo last clean-up (${hint.closed} tabs)`
}

function paintProtect(protect: StateResult['protect']): void {
  protectDomains.value = protect.domains.join('\n')
  protectList.replaceChildren()
  const rows: { kind: string; label: string; detail: string; remove: () => void }[] = []

  for (const domain of protect.domains) {
    rows.push({
      kind: 'Site',
      label: domain,
      detail: 'Don’t auto-close tabs from this site',
      remove: () => {
        void (async () => {
          const result = await send<ProtectUpdateResult>({
            type: 'remove-protect-domain',
            domain,
          })
          showProtectNote(result.ok ? result.summary : result.message)
          if (result.ok) {
            latestState = latestState ? { ...latestState, protect: result.protect } : latestState
            paintProtect(result.protect)
            await loadGroups()
          }
        })()
      },
    })
  }

  for (const groupId of protect.groupIds) {
    const title = groupTitleById.get(groupId) || `Group #${groupId}`
    rows.push({
      kind: 'Group',
      label: title,
      detail: 'Don’t auto-close tabs in this group',
      remove: () => {
        void (async () => {
          const result = await send<ProtectUpdateResult>({
            type: 'remove-protect-group',
            groupId,
          })
          showProtectNote(result.ok ? result.summary : result.message)
          if (result.ok) {
            latestState = latestState ? { ...latestState, protect: result.protect } : latestState
            paintProtect(result.protect)
            await loadGroups()
          }
        })()
      },
    })
  }

  for (const url of protect.urlPatterns) {
    rows.push({
      kind: 'Page',
      label: url,
      detail: 'Don’t auto-close this page (saved by address, not tab id)',
      remove: () => {
        void (async () => {
          const result = await send<ProtectUpdateResult>({
            type: 'remove-protect-url',
            url,
          })
          showProtectNote(result.ok ? result.summary : result.message)
          if (result.ok) {
            latestState = latestState ? { ...latestState, protect: result.protect } : latestState
            paintProtect(result.protect)
          }
        })()
      },
    })
  }

  protectEmpty.hidden = rows.length > 0
  for (const row of rows) {
    const item = document.createElement('li')
    item.className = 'protect-row'
    const copy = document.createElement('div')
    copy.className = 'protect-row-copy'
    const title = document.createElement('strong')
    title.textContent = row.label
    title.title = row.label
    const meta = document.createElement('span')
    meta.textContent = `${row.kind} · ${row.detail}`
    copy.append(title, meta)
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'btn btn-ghost btn-tiny'
    remove.textContent = 'Remove'
    remove.setAttribute('aria-label', `Remove protection for ${row.label}`)
    remove.addEventListener('click', row.remove)
    item.append(copy, remove)
    protectList.append(item)
  }
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
  } else {
    renderGroupList(groupsList, groups, 'manage', groupUi, groupHandlers, renamedFlashIds)
  }
  paintSnapshot()
}

function syncRetitleControls(): void {
  const ready = llmOn && selected !== ''
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
  latestState = state
  llmOn = state.llmOn
  llm.checked = state.llmOn
  organizerOn = state.organizerOn
  organizer.checked = state.organizerOn
  cleanupOn.checked = state.cleanupOn
  paintCleanupAge(state.cleanupAgeDays)
  paintCleanupUndo(state.cleanupUndo ?? null)
  protectHandRenamed.checked = state.protectHandRenamed === true
  quietHoursOn.checked = state.quietHoursOn === true
  quietHoursStart.value = String(state.quietHoursStart ?? 23)
  quietHoursEnd.value = String(state.quietHoursEnd ?? 7)
  quietHoursStart.disabled = !quietHoursOn.checked
  quietHoursEnd.disabled = !quietHoursOn.checked
  paintProtect(state.protect)
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
  paintSnapshot()
  paintHealth({ connected: listedOnce ? models.length > 0 || Boolean(selected) : null })
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
      tabCountEstimate = 0
      showGroupsError('This window has no tab strip to inspect.')
      renderGroups()
      return
    }
    const listed = await send<ListGroupsResult>({ type: 'list-groups', windowId: win.id })
    if (!listed.ok) {
      groups = []
      tabCountEstimate = 0
      showGroupsError(listed.message)
      renderGroups()
      return
    }
    groups = listed.groups
    groupTitleById = new Map(
      listed.groups.map((group) => [group.id, group.title.trim() || 'Untitled group']),
    )
    if (latestState) paintProtect(latestState.protect)
    tabCountEstimate = listed.groups.reduce((sum, group) => sum + group.tabCount, 0)
    try {
      const tabs = await chrome.tabs.query({ windowId: win.id })
      tabCountEstimate = tabs.length
    } catch {
      /* keep group sum */
    }
    showGroupsError('')
    renderGroups()
  } catch {
    groups = []
    tabCountEstimate = 0
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
      paintHealth({ connected: false, message: listed.message ?? ' Offline' })
      renderModels()
      return
    }
    models = listed.models
    showModelStatus(listed.models.length === 0 ? 'Ollama has no models yet.' : '')
    paintHealth({ connected: true })
    renderModels()
  } catch {
    listedOnce = true
    if (!hadModels) models = []
    showModelStatus("Ollama isn't running. Start it with `ollama serve`, then hit Refresh.")
    paintHealth({ connected: false, message: ' Offline' })
    renderModels()
  } finally {
    refresh.disabled = false
    refresh.removeAttribute('aria-busy')
    syncRetitleControls()
    syncTestControls()
    paintSnapshot()
  }
}

let activityFilter: ActivityFilter = 'all'

const ACTIVITY_EMPTY =
  'Nothing here yet. When you organize tabs, rename groups, or save a rule that fires, those steps will show up in this list.'
const ACTIVITY_EMPTY_FILTERED =
  'No matching activity for this filter. Try All, or organize a window to create new entries.'

function selectedActivityFilter(): ActivityFilter {
  return activityFilter
}

function setActivityFilter(next: ActivityFilter): void {
  activityFilter = next
  for (const chip of Array.from(
    activityFilters.querySelectorAll<HTMLButtonElement>('.activity-filter-chip'),
  )) {
    const active = chip.dataset.filter === next
    chip.classList.toggle('is-active', active)
    chip.setAttribute('aria-pressed', active ? 'true' : 'false')
  }
}

async function loadActivity(): Promise<void> {
  refreshActivity.disabled = true
  try {
    const filter = selectedActivityFilter()
    const result = await send<ActivityLogResult>({
      type: 'get-activity',
      filter,
    })
    paintActivityList(activityList, activityEmpty, result.ok ? result.entries : [], {
      emptyText: filter === 'all' ? ACTIVITY_EMPTY : ACTIVITY_EMPTY_FILTERED,
    })
  } catch {
    paintActivityList(activityList, activityEmpty, [], { emptyText: 'Could not load activity.' })
  } finally {
    refreshActivity.disabled = false
  }
}

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

activityFilters.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  const chip = target.closest<HTMLButtonElement>('.activity-filter-chip')
  if (!chip || !activityFilters.contains(chip)) return
  const value = chip.dataset.filter
  if (value !== 'all' && value !== 'ai' && value !== 'you' && value !== 'organize' && value !== 'rules') {
    return
  }
  if (value === activityFilter) return
  setActivityFilter(value)
  void loadActivity()
})

clearActivity.addEventListener('click', () => {
  clearActivityDialog.showModal()
})

clearActivityDialog.addEventListener('close', () => {
  if (clearActivityDialog.returnValue !== 'confirm') {
    clearActivityDialog.returnValue = ''
    return
  }
  clearActivityDialog.returnValue = ''
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

organizer.addEventListener('change', () => {
  void (async () => {
    renderState(await send<StateResult>({ type: 'set-organizer', on: organizer.checked }))
  })()
})

async function persistQuietHours(): Promise<void> {
  renderState(
    await send<StateResult>({
      type: 'set-quiet-hours',
      on: quietHoursOn.checked,
      startHour: Number(quietHoursStart.value),
      endHour: Number(quietHoursEnd.value),
    }),
  )
}

quietHoursOn.addEventListener('change', () => {
  void persistQuietHours()
})
quietHoursStart.addEventListener('change', () => {
  void persistQuietHours()
})
quietHoursEnd.addEventListener('change', () => {
  void persistQuietHours()
})

cleanupOn.addEventListener('change', () => {
  void (async () => {
    renderState(await send<StateResult>({ type: 'set-cleanup', on: cleanupOn.checked }))
    showCleanupNote(
      cleanupOn.checked
        ? `Automatic clean-up is on · unused for ${formatCleanupAgeLabel(Number(cleanupAgeDays.value) || 30)} · all normal windows`
        : 'Automatic clean-up is off.',
    )
  })()
})

cleanupAgePresets.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  const chip = target.closest<HTMLButtonElement>('.cleanup-age-chip')
  if (!chip || !cleanupAgePresets.contains(chip)) return
  const days = Number(chip.dataset.days)
  if (!CLEANUP_AGE_PRESETS.includes(days as (typeof CLEANUP_AGE_PRESETS)[number])) return
  void (async () => {
    renderState(await send<StateResult>({ type: 'set-cleanup-age', days }))
    showCleanupNote(`Will close tabs unused for ${formatCleanupAgeLabel(days)}.`)
  })()
})

cleanupAgeDays.addEventListener('change', () => {
  void (async () => {
    const days = Number(cleanupAgeDays.value)
    renderState(await send<StateResult>({ type: 'set-cleanup-age', days }))
    showCleanupNote(`Will close tabs unused for ${formatCleanupAgeLabel(days)}.`)
  })()
})

cleanupNow.addEventListener('click', () => {
  void (async () => {
    cleanupNow.disabled = true
    showCleanupNote('Counting unused tabs…')
    try {
      const win = await browserWindow()
      const preview = await send<CleanupPreviewResult>({
        type: 'preview-cleanup',
        scope: 'window',
        windowId: win?.id,
      })
      if (!preview.ok) {
        showCleanupNote(preview.message)
        return
      }
      if (preview.count === 0) {
        showCleanupNote(preview.summary)
        return
      }
      const sample =
        preview.sampleSiteKeys.length > 0
          ? ` Includes sites like ${preview.sampleSiteKeys.join(', ')}.`
          : ''
      cleanupConfirmBody.textContent = `${preview.summary}${sample} Pinned, active, and protected tabs stay open.`
      pendingCleanupConfirm = { windowId: preview.windowId, tabIds: preview.tabIds }
      cleanupConfirmDialog.showModal()
    } catch {
      showCleanupNote('Could not preview clean-up.')
    } finally {
      cleanupNow.disabled = false
    }
  })()
})

cleanupConfirmDialog.addEventListener('close', () => {
  const pending = pendingCleanupConfirm
  const confirmed = pending !== null && cleanupConfirmDialog.returnValue === 'confirm'
  pendingCleanupConfirm = null
  cleanupConfirmDialog.returnValue = ''
  if (!confirmed || !pending) return
  void (async () => {
    cleanupNow.disabled = true
    showCleanupNote('Closing old tabs…')
    try {
      const result = await send<CleanupRunResult>({
        type: 'run-cleanup',
        scope: 'window',
        windowId: pending.windowId,
        tabIds: pending.tabIds,
        confirm: true,
      })
      if (result.ok) {
        paintCleanupUndo(result.cleanupUndo ?? null)
        showCleanupNote(
          result.cleanupUndo
            ? `${result.summary} You can undo for a few minutes.`
            : result.summary,
        )
        await loadActivity()
      } else {
        showCleanupNote(result.message)
      }
    } catch {
      showCleanupNote('Could not clean up tabs.')
    } finally {
      cleanupNow.disabled = false
    }
  })()
})

cleanupUndo.addEventListener('click', () => {
  void (async () => {
    cleanupUndo.disabled = true
    showCleanupNote('Reopening tabs…')
    try {
      const result = await send<CleanupUndoResult>({ type: 'undo-cleanup' })
      paintCleanupUndo(null)
      showCleanupNote(result.ok ? result.summary : result.message)
      if (result.ok) {
        await loadActivity()
        await loadGroups()
      }
    } catch {
      showCleanupNote('Could not undo clean-up.')
    } finally {
      const state = await send<StateResult>({ type: 'get-state' }).catch(() => null)
      paintCleanupUndo(state?.cleanupUndo ?? null)
      cleanupUndo.disabled = cleanupUndo.hidden
    }
  })()
})

protectPresets.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const chip = target.closest<HTMLButtonElement>('[data-preset]')
  if (!chip || !protectPresets.contains(chip)) return
  const id = chip.dataset.preset
  if (!id) return
  void (async () => {
    chip.disabled = true
    try {
      const result = await send<ProtectUpdateResult>({ type: 'apply-protect-preset', id })
      if (result.ok) {
        paintProtect(result.protect)
        if (latestState) latestState = { ...latestState, protect: result.protect }
        showProtectNote(result.summary)
      } else {
        showProtectNote(result.message)
      }
    } catch {
      showProtectNote('Could not apply that protect preset.')
    } finally {
      chip.disabled = false
    }
  })()
})

protectHandRenamed.addEventListener('change', () => {
  void (async () => {
    renderState(
      await send<StateResult>({
        type: 'set-protect-hand-renamed',
        on: protectHandRenamed.checked,
      }),
    )
    showProtectNote(
      protectHandRenamed.checked
        ? 'Groups you rename by hand stay protected from auto-clean.'
        : 'Renaming a group no longer auto-protects it.',
    )
  })()
})

saveProtectDomains.addEventListener('click', () => {
  void (async () => {
    const state = await send<StateResult>({
      type: 'set-protect-domains',
      domains: protectDomains.value.split(/[\n,]+/).map((row) => row.trim()).filter(Boolean),
    })
    renderState(state)
    showProtectNote(
      state.protect.domains.length === 0
        ? 'No protected sites saved.'
        : `Protecting ${state.protect.domains.length} site${state.protect.domains.length === 1 ? '' : 's'}.`,
    )
  })()
})

protectActiveSite.addEventListener('click', () => {
  void (async () => {
    const state = await send<StateResult>({ type: 'get-state' })
    const site = state.activeTab?.siteKey
    if (!site) {
      showProtectNote('Open an http(s) tab first, then try again.')
      return
    }
    const result = await send<ProtectUpdateResult>({
      type: 'protect-domain',
      domain: site,
      protect: true,
    })
    showProtectNote(result.ok ? result.summary : result.message)
    if (result.ok) renderState({ ...state, protect: result.protect })
  })()
})

protectActivePage.addEventListener('click', () => {
  void (async () => {
    const state = await send<StateResult>({ type: 'get-state' })
    const pattern = state.activeTab?.urlPattern
    if (!pattern) {
      showProtectNote('Open an http(s) page first, then try again.')
      return
    }
    const result = await send<ProtectUpdateResult>({
      type: 'protect-url',
      url: pattern,
      protect: true,
    })
    showProtectNote(result.ok ? result.summary : result.message)
    if (result.ok) renderState({ ...state, protect: result.protect })
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
      paintHealth({
        connected: result.ok,
        message: result.ok ? undefined : result.message,
      })
    } catch {
      showModelStatus('Could not reach Ollama.')
      paintHealth({ connected: false, message: ' Could not reach Ollama' })
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

layoutForm.addEventListener('submit', (event) => {
  event.preventDefault()
  void (async () => {
    saveLayout.disabled = true
    showLayoutsNote('Saving layout…')
    try {
      const win = await browserWindow()
      const result = await send<SaveLayoutResult>({
        type: 'save-layout',
        name: layoutName.value,
        windowId: win?.id,
      })
      if (result.ok) {
        layoutName.value = ''
        renderLayouts(result.layouts)
        showLayoutsNote(result.summary)
      } else {
        showLayoutsNote(result.message)
      }
    } catch {
      showLayoutsNote('Could not save layout.')
    } finally {
      saveLayout.disabled = false
    }
  })()
})

void bindThemeToggle()
if (versionLabel) {
  versionLabel.textContent = `v${chrome.runtime.getManifest().version}`
}
void (async () => {
  const state = await send<StateResult>({ type: 'get-state' })
  renderState(state)
  if (state.llmOn) await loadModels()
})()
void loadGroups()
void loadActivity()
void loadLayouts()
