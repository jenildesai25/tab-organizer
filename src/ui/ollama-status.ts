import { ollamaOriginsLaunchCommand } from '../ollama.js'

/** Paint a model-status line; for 403, append a one-click copy of the launch command. */
export function paintOllamaStatus(target: HTMLElement, text: string): void {
  target.replaceChildren()
  target.setAttribute('role', 'status')
  if (!text) {
    target.hidden = true
    return
  }
  target.hidden = false

  const body = document.createElement('div')
  body.className = 'status-body'
  body.textContent = text
  target.append(body)

  if (!/blocked this extension \(403\)/i.test(text)) return

  const launch = ollamaOriginsLaunchCommand(chrome.runtime.id)
  const actions = document.createElement('div')
  actions.className = 'status-actions'

  const copy = document.createElement('button')
  copy.type = 'button'
  copy.className = 'btn btn-ghost btn-tiny copy-env'
  copy.textContent = 'Copy launch command'
  copy.title = launch
  copy.addEventListener('click', () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(launch)
        copy.textContent = 'Copied'
        window.setTimeout(() => {
          copy.textContent = 'Copy launch command'
        }, 1600)
      } catch {
        copy.textContent = 'Copy failed'
      }
    })()
  })
  actions.append(copy)
  target.append(actions)
}
