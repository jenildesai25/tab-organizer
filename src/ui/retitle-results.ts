import type { RetitleGroupResult } from '../protocol.js'

function displayTitle(title: string): string {
  const trimmed = title.trim()
  return trimmed === '' ? 'Untitled' : trimmed
}

/** One scannable line for a retitle outcome (old → new, or title — reason). */
export function formatRetitleResultLine(result: RetitleGroupResult): string {
  const oldTitle = displayTitle(result.oldTitle)
  if (result.status === 'renamed') {
    const next = result.newTitle?.trim()
    return next ? `${oldTitle} → ${next}` : `${oldTitle} → ?`
  }
  if (result.reason === 'Shared') {
    return result.oldTitle.trim() ? `${oldTitle} — Shared` : 'Shared — skipped'
  }
  const reason = result.reason?.trim()
  if (reason) return `${oldTitle} — ${reason}`
  if (result.status === 'failed') return `${oldTitle} — failed`
  return `${oldTitle} — skipped`
}

/** Paint the one-line summary plus a scrollable per-group list under it. */
export function paintRetitleResults(
  target: HTMLElement,
  summary: string,
  results: readonly RetitleGroupResult[],
): void {
  target.replaceChildren()
  if (!summary && results.length === 0) {
    target.hidden = true
    target.setAttribute('role', 'status')
    return
  }
  target.hidden = false
  // Announce the summary only; the scannable list is available by browsing.
  target.removeAttribute('role')

  const body = document.createElement('div')
  body.className = 'status-body'
  body.setAttribute('role', 'status')
  body.textContent = summary
  target.append(body)

  if (results.length === 0) return

  const list = document.createElement('ul')
  list.className = 'retitle-results'
  list.setAttribute('aria-label', 'Rename results')
  for (const result of results) {
    const item = document.createElement('li')
    item.className = `retitle-result retitle-result-${result.status}`
    item.dataset.groupId = String(result.groupId)
    item.textContent = formatRetitleResultLine(result)
    list.append(item)
  }
  target.append(list)
}
