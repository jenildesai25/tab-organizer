import type { StateResult, ToBackground } from '../protocol.js'
import { bindSweep } from '../ui/sweep.js'

const organizer = document.querySelector<HTMLInputElement>('#organizer')!
const sweep = document.querySelector<HTMLButtonElement>('#sweep')!
const resultLine = document.querySelector<HTMLParagraphElement>('#result')!
const status = document.querySelector<HTMLParagraphElement>('#status')!
const openDashboard = document.querySelector<HTMLButtonElement>('#open-dashboard')!

async function send<T>(message: ToBackground): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>
}

function renderState(state: StateResult): void {
  organizer.checked = state.organizerOn
  status.textContent = state.status
}

organizer.addEventListener('change', () => {
  void send<StateResult>({ type: 'set-organizer', on: organizer.checked }).then(renderState)
})

bindSweep(sweep, resultLine, renderState)

openDashboard.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') })
})

void send<StateResult>({ type: 'get-state' }).then(renderState)
