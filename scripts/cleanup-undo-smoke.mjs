/**
 * End-to-end: seed a clean-up undo snapshot, confirm get-state exposes it,
 * undo-cleanup reopens the tabs, then clears the hint.
 *
 * Usage: npm run build && node scripts/cleanup-undo-smoke.mjs
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.resolve(root, 'dist')

function fail(message, detail) {
  console.error(`FAIL: ${message}`)
  if (detail !== undefined) console.error(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2))
  process.exit(1)
}

async function main() {
  if (!existsSync(path.join(dist, 'background.js'))) fail('Missing dist/. Run npm run build first.')

  const browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: [dist],
    args: ['--no-first-run', '--no-default-browser-check'],
  })

  try {
    const workerTarget = await browser.waitForTarget(
      (t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'),
      { timeout: 25_000 },
    )
    const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(workerTarget.url())
    if (!match) fail('No extension id', workerTarget.url())
    const extensionId = match[1]

    const dash = await browser.newPage()
    await dash.goto(`chrome-extension://${extensionId}/dashboard/index.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    })
    await dash.waitForFunction(() => typeof chrome !== 'undefined' && !!chrome.runtime?.id, {
      timeout: 10_000,
    })

    const victim = await browser.newPage()
    await victim.goto('https://example.com/undo-smoke', { waitUntil: 'domcontentloaded', timeout: 20_000 })

    // Keep another tab focused so example.com is inactive if we ever close by id.
    const focus = await browser.newPage()
    await focus.goto('https://example.org/', { waitUntil: 'domcontentloaded', timeout: 20_000 })

    const seeded = await dash.evaluate(async () => {
      const tabs = await chrome.tabs.query({})
      const target = tabs.find(
        (tab) => typeof tab.id === 'number' && typeof tab.url === 'string' && tab.url.includes('example.com/undo-smoke'),
      )
      if (!target?.id) return { ok: false, reason: 'missing-tab', tabs: tabs.map((t) => t.url) }
      const windowId = target.windowId ?? -1
      await chrome.tabs.remove(target.id)
      const now = Date.now()
      await chrome.storage.session.set({
        cleanupUndo: {
          closedAt: now,
          expiresAt: now + 10 * 60 * 1000,
          tabs: [
            {
              url: 'https://example.com/undo-smoke',
              title: 'Example Domain',
              windowId,
              pinned: false,
              groupTitle: 'UndoSmoke',
              groupColor: 'blue',
            },
          ],
        },
      })
      const state = await chrome.runtime.sendMessage({ type: 'get-state' })
      return { ok: true, stateUndo: state.cleanupUndo }
    })

    if (!seeded.ok) fail('Could not seed undo snapshot', seeded)
    if (!seeded.stateUndo || seeded.stateUndo.closed !== 1) fail('get-state missing cleanupUndo', seeded)

    const undone = await dash.evaluate(async () => {
      const undo = await chrome.runtime.sendMessage({ type: 'undo-cleanup' })
      const state = await chrome.runtime.sendMessage({ type: 'get-state' })
      const tabs = await chrome.tabs.query({})
      const restored = tabs.filter((tab) => {
        const url = `${tab.url || ''} ${tab.pendingUrl || ''}`
        return url.includes('example.com/undo-smoke') || url.includes('example.com')
      })
      const groups = await chrome.tabGroups.query({})
      const titled = groups.filter((group) => (group.title || '') === 'UndoSmoke')
      const groupedTabs =
        titled.length > 0 ? tabs.filter((tab) => titled.some((group) => tab.groupId === group.id)) : []
      return {
        undo,
        stateUndo: state.cleanupUndo,
        restored: restored.length,
        undoGroups: titled.length,
        groupedTabs: groupedTabs.length,
        sampleUrls: tabs.slice(0, 8).map((tab) => ({ url: tab.url, pending: tab.pendingUrl, groupId: tab.groupId })),
      }
    })

    console.log(JSON.stringify({ seeded, undone }, null, 2))
    if (!undone.undo?.ok || undone.undo.restored !== 1) fail('undo-cleanup failed', undone)
    if (undone.groupedTabs < 1 && undone.restored < 1) fail('Tab was not restored', undone)
    if (undone.stateUndo) fail('cleanupUndo hint should clear after undo', undone)
    if (undone.undoGroups < 1) fail('Restored tab was not regrouped', undone)
    console.log('PASS: undo-cleanup restored the closed tab and cleared the hint.')
  } finally {
    await browser.close().catch(() => {})
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
