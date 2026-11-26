import type { StateResult, SweepResult, ToBackground } from '../protocol.js'

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
): void {
  button.addEventListener('click', () => {
    void (async () => {
      const label = button.textContent
      button.disabled = true
      button.textContent = 'Organizing…'
      button.setAttribute('aria-busy', 'true')
      try {
        const win = await browserWindow()
        if (win?.id == null) {
          showResult(result, 'This window has no tab strip to organize.')
          return
        }
        const response = await send<SweepResult>({ type: 'sweep', windowId: win.id })
        if (!response.ok) {
          showResult(result, resultText(response))
          onDone?.(response)
          return
        }
        onState(response)
        showResult(result, resultText(response))
        onDone?.(response)
      } catch {
        showResult(result, 'Could not group this window.')
      } finally {
        button.disabled = false
        button.textContent = label || 'Organize this window'
        button.removeAttribute('aria-busy')
      }
    })()
  })
}
