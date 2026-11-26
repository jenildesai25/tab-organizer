import type { StateResult, SweepResult, ToBackground } from '../protocol.js'

export type SweepProgressEls = {
  panel: HTMLElement | null
  bar: HTMLProgressElement | null
  label?: HTMLElement | null
  value?: HTMLElement | null
}

function showResult(result: HTMLElement, text: string): void {
  result.textContent = text
  result.hidden = text === ''
}

function resultText(response: SweepResult): string {
  if (response.ok) {
    const diag = response.diag?.line
    if (diag && !response.summary.includes(diag)) return `${response.summary}\n${diag}`
    return response.summary
  }
  const diag = response.diag?.line
  return diag ? `${response.message}\n${diag}` : response.message
}

async function send<T>(message: ToBackground): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>
}

function setProgress(
  progress: SweepProgressEls | undefined,
  state: 'idle' | 'running' | 'done',
  message?: string,
): void {
  if (!progress) return
  const { panel, bar, label, value } = progress
  // Markup must include #progress-panel / #organize-progress; skip if absent.
  if (!panel || !bar) return
  if (state === 'idle') {
    panel.hidden = true
    bar.removeAttribute('value')
    return
  }
  panel.hidden = false
  if (state === 'running') {
    bar.removeAttribute('value')
    if (label) label.textContent = message ?? 'Filing tabs…'
    if (value) value.textContent = '…'
    return
  }
  bar.value = 100
  if (label) label.textContent = message ?? 'Done'
  if (value) value.textContent = '100%'
  window.setTimeout(() => {
    if (!bar.hasAttribute('value') || bar.value === 100) panel.hidden = true
  }, 900)
}

/**
 * A normal browser window to ask the background to sweep.
 * The service worker re-checks and may switch to a window that actually has
 * http(s) tabs (so Organize still works while sitting on chrome://extensions).
 */
export async function browserWindow(): Promise<chrome.windows.Window | null> {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] })
    if (win.id != null && !win.incognito && (win.type === undefined || win.type === 'normal')) return win
  } catch {
    // Some Chrome builds reject the type filter; fall through.
  }

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
      windowType: 'normal',
    })
    if (tab?.windowId == null) return null
    const win = await chrome.windows.get(tab.windowId)
    if (win.incognito || (win.type !== undefined && win.type !== 'normal')) return null
    return win
  } catch {
    return null
  }
}

export function bindSweep(
  button: HTMLButtonElement,
  result: HTMLElement,
  onState: (state: StateResult) => void,
  onDone?: (response: SweepResult) => void,
  progress?: SweepProgressEls,
): void {
  button.addEventListener('click', () => {
    void (async () => {
      const label = button.textContent
      button.disabled = true
      button.textContent = 'Organizing…'
      button.setAttribute('aria-busy', 'true')
      showResult(result, '')
      setProgress(progress, 'running', 'Filing tabs into groups…')
      try {
        const win = await browserWindow()
        if (win?.id == null) {
          showResult(result, 'This window has no tab strip to organize.')
          setProgress(progress, 'idle')
          return
        }
        const response = await send<SweepResult>({ type: 'sweep', windowId: win.id })
        if (!response.ok) {
          showResult(result, resultText(response))
          setProgress(progress, 'idle')
          onDone?.(response)
          return
        }
        onState(response)
        showResult(result, resultText(response))
        setProgress(progress, 'done')
        onDone?.(response)
      } catch {
        showResult(result, 'Could not group this window.')
        setProgress(progress, 'idle')
      } finally {
        button.disabled = false
        button.textContent = label || 'Organize this window'
        button.removeAttribute('aria-busy')
      }
    })()
  })
}
