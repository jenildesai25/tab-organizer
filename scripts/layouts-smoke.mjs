/**
 * Save a layout from current groups, ungroup, apply layout, assert regroup.
 * Usage: npm run build && node scripts/layouts-smoke.mjs
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
    if (!match) fail('No extension id')
    const extensionId = match[1]
    const dash = await browser.newPage()
    await dash.goto(`chrome-extension://${extensionId}/dashboard/index.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    })
    await dash.waitForFunction(() => !!chrome.runtime?.id, { timeout: 10_000 })

    const a = await browser.newPage()
    await a.goto('https://example.com/layout-a', { waitUntil: 'domcontentloaded', timeout: 20_000 })
    const b = await browser.newPage()
    await b.goto('https://example.com/layout-b', { waitUntil: 'domcontentloaded', timeout: 20_000 })

    const result = await dash.evaluate(async () => {
      const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] })
      if (win.id == null) return { ok: false, stage: 'window' }
      const tabs = await chrome.tabs.query({ windowId: win.id })
      const targets = tabs.filter(
        (tab) => typeof tab.id === 'number' && typeof tab.url === 'string' && tab.url.includes('example.com/layout'),
      )
      if (targets.length < 2) return { ok: false, stage: 'tabs', urls: tabs.map((t) => t.url) }
      const tabIds = targets.map((tab) => tab.id)
      const groupId = await chrome.tabs.group({ tabIds })
      await chrome.tabGroups.update(groupId, { title: 'LayoutSmoke', color: 'blue' })

      const saved = await chrome.runtime.sendMessage({
        type: 'save-layout',
        name: 'Smoke desk',
        windowId: win.id,
      })
      if (!saved.ok) return { ok: false, stage: 'save', saved }
      const layoutId = saved.layouts[0]?.id
      await chrome.tabs.ungroup(tabIds)
      const applied = await chrome.runtime.sendMessage({
        type: 'apply-layout',
        id: layoutId,
        windowId: win.id,
      })
      const groups = await chrome.tabGroups.query({ windowId: win.id })
      const titled = groups.filter((group) => (group.title || '') === 'LayoutSmoke')
      await chrome.runtime.sendMessage({ type: 'delete-layout', id: layoutId })
      return {
        ok: true,
        savedSummary: saved.summary,
        applied,
        titled: titled.length,
      }
    })

    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) fail('Layout smoke setup failed', result)
    if (!result.applied?.ok || result.applied.grouped < 2) fail('apply-layout failed', result)
    if (result.titled < 1) fail('LayoutSmoke group missing after apply', result)
    console.log('PASS: saved layout re-applied to open tabs.')
  } finally {
    await browser.close().catch(() => {})
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
