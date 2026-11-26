/**
 * Proof shots: compact popup without Recent activity, and dashboard Activity
 * audit log with sample entries. Writes under .scratch/ui-mock/shots/
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.resolve(root, 'dist')
const outDir = path.resolve(root, '.scratch/ui-mock/shots')
mkdirSync(outDir, { recursive: true })

function extensionIdFromTargetUrl(url) {
  const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(url)
  return match?.[1] ?? null
}

async function waitForExtension(browser, timeoutMs = 25_000) {
  const target = await browser.waitForTarget(
    (candidate) =>
      candidate.type() === 'service_worker' &&
      candidate.url().startsWith('chrome-extension://') &&
      candidate.url().endsWith('/background.js'),
    { timeout: timeoutMs },
  )
  const id = extensionIdFromTargetUrl(target.url())
  if (!id) throw new Error(`Could not parse extension id from ${target.url()}`)
  return id
}

async function launch() {
  const common = {
    pipe: true,
    enableExtensions: [dist],
    args: ['--no-first-run', '--no-default-browser-check', '--window-size=1200,900'],
  }
  for (const headless of [true, false]) {
    try {
      const browser = await puppeteer.launch({ ...common, headless })
      const id = await waitForExtension(browser)
      return { browser, id, headless }
    } catch {
      /* try next */
    }
  }
  throw new Error('Could not launch extension')
}

function sampleEntries(now = Date.now()) {
  return [
    {
      id: 'proof-1',
      ts: now - 20_000,
      actor: 'sweep',
      action: 'tab.file',
      groupTitle: 'GitHub',
      tabCount: 3,
    },
    {
      id: 'proof-2',
      ts: now - 3 * 60_000,
      actor: 'ai',
      action: 'group.rename',
      oldTitle: 'Misc',
      newTitle: 'Research',
      groupTitle: 'Research',
      model: 'llama3.2',
    },
    {
      id: 'proof-3',
      ts: now - 18 * 60_000,
      actor: 'user',
      action: 'group.recolor',
      groupTitle: 'Amazon',
      color: 'orange',
    },
    {
      id: 'proof-4',
      ts: now - 45 * 60_000,
      actor: 'organizer',
      action: 'tab.file',
      groupTitle: 'Local',
      tabCount: 1,
    },
    {
      id: 'proof-5',
      ts: now - 2 * 60 * 60_000,
      actor: 'rule',
      action: 'group.create',
      groupTitle: 'Code',
    },
    {
      id: 'proof-6',
      ts: now - 26 * 60 * 60_000,
      actor: 'ai',
      action: 'rename.skip',
      oldTitle: 'Cloud',
      reason: 'Low confidence',
      model: 'llama3.2',
    },
  ]
}

async function seedActivity(page, entries) {
  await page.evaluate(async (rows) => {
    await chrome.storage.local.set({
      activityLog: rows,
      organizerOn: true,
      llmOn: true,
      model: 'llama3.2',
    })
  }, entries)
}

async function main() {
  const { browser, id, headless } = await launch()
  console.log(`extension=${id} headless=${headless}`)

  const seedPage = await browser.newPage()
  await seedPage.goto(`chrome-extension://${id}/popup/popup.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 20_000,
  })
  await seedActivity(seedPage, sampleEntries())
  await seedPage.close()

  const popup = await browser.newPage()
  await popup.setViewport({ width: 480, height: 720, deviceScaleFactor: 2 })
  await popup.goto(`chrome-extension://${id}/popup/popup.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 20_000,
  })
  await popup.waitForSelector('#open-rules')
  await new Promise((r) => setTimeout(r, 400))

  const popupMetrics = await popup.evaluate(() => {
    const rootWidth = Math.round(
      Math.max(
        document.documentElement.getBoundingClientRect().width,
        document.body.getBoundingClientRect().width,
      ),
    )
    const cssWidth = getComputedStyle(document.documentElement).width
    return {
      rootWidth,
      cssWidth,
      hasActivityHeading: !!document.getElementById('activity-heading'),
      hasActivityList: !!document.getElementById('activity'),
      hasOpenRules: !!document.getElementById('open-rules'),
      hasOpenSettings: !!document.getElementById('open-settings'),
      ollamaPill: document.getElementById('ollama-pill-label')?.textContent?.trim() || '',
      groupsSummary: document.getElementById('groups-summary')?.textContent?.trim() || '',
    }
  })

  const popupClean = path.join(outDir, 'popup-no-activity-clean.png')
  await popup.screenshot({ path: popupClean, fullPage: true })
  console.log('wrote', popupClean, popupMetrics)

  await popup.evaluate((metrics) => {
    const el = document.createElement('div')
    el.id = 'proof-overlay'
    el.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:2147483647;padding:8px 10px;border-radius:8px;background:rgba(15,23,42,.88);color:#f8fafc;font:12px/1.35 ui-monospace,Menlo,monospace;pointer-events:none;max-width:92%'
    el.textContent = `w=${metrics.rootWidth} css=${metrics.cssWidth} | activity=${metrics.hasActivityHeading ? 'YES' : 'no'} | rules=${metrics.hasOpenRules} | settings=${metrics.hasOpenSettings}`
    document.body.append(el)
  }, popupMetrics)
  const popupAnnotated = path.join(outDir, 'popup-no-activity-annotated.png')
  await popup.screenshot({ path: popupAnnotated, fullPage: true })
  console.log('wrote', popupAnnotated)

  const dash = await browser.newPage()
  await dash.setViewport({ width: 1100, height: 900, deviceScaleFactor: 2 })
  await dash.goto(`chrome-extension://${id}/dashboard/index.html#activity`, {
    waitUntil: 'domcontentloaded',
    timeout: 20_000,
  })
  await dash.waitForSelector('#activity-list')
  await new Promise((r) => setTimeout(r, 500))
  await dash.evaluate(() => {
    document.getElementById('activity')?.scrollIntoView({ block: 'start' })
  })
  await new Promise((r) => setTimeout(r, 200))

  const dashMetrics = await dash.evaluate(() => {
    const items = [...document.querySelectorAll('#activity-list .activity-item')]
    const chips = [...document.querySelectorAll('.activity-filter-chip')].map((el) => ({
      label: el.textContent?.trim(),
      active: el.classList.contains('is-active'),
    }))
    return {
      itemCount: items.length,
      firstCopy: items[0]?.querySelector('.activity-copy')?.textContent?.trim() || '',
      firstTime: items[0]?.querySelector('.activity-time')?.textContent?.trim() || '',
      chips,
      hasHelp: !!document.querySelector('.activity-help'),
      hasClearDialog: !!document.getElementById('clear-activity-dialog'),
      emptyHidden: document.getElementById('activity-empty')?.hidden ?? null,
    }
  })

  const dashClean = path.join(outDir, 'dashboard-activity-sample-clean.png')
  await dash.screenshot({ path: dashClean, fullPage: false })
  console.log('wrote', dashClean, dashMetrics)

  await dash.evaluate((metrics) => {
    const el = document.createElement('div')
    el.id = 'proof-overlay'
    el.style.cssText =
      'position:fixed;left:12px;bottom:12px;z-index:2147483647;padding:8px 10px;border-radius:8px;background:rgba(15,23,42,.88);color:#f8fafc;font:12px/1.35 ui-monospace,Menlo,monospace;pointer-events:none;max-width:92%'
    el.textContent = `items=${metrics.itemCount} | first="${metrics.firstCopy}" | time=${metrics.firstTime} | help=${metrics.hasHelp}`
    document.body.append(el)
  }, dashMetrics)
  const dashAnnotated = path.join(outDir, 'dashboard-activity-sample-annotated.png')
  await dash.screenshot({ path: dashAnnotated, fullPage: false })
  console.log('wrote', dashAnnotated)

  const metricsPath = path.join(outDir, 'activity-home-proof-metrics.json')
  writeFileSync(
    metricsPath,
    JSON.stringify(
      {
        version: '0.3.19',
        popup: popupMetrics,
        dashboard: dashMetrics,
        shots: {
          popupClean,
          popupAnnotated,
          dashClean,
          dashAnnotated,
        },
      },
      null,
      2,
    ),
  )
  console.log('wrote', metricsPath)

  const ok =
    popupMetrics.rootWidth >= 420 &&
    popupMetrics.rootWidth <= 440 &&
    !popupMetrics.hasActivityHeading &&
    !popupMetrics.hasActivityList &&
    popupMetrics.hasOpenRules &&
    popupMetrics.hasOpenSettings &&
    dashMetrics.itemCount >= 5 &&
    dashMetrics.hasHelp &&
    dashMetrics.hasClearDialog

  await browser.close()
  if (!ok) {
    console.error('Proof checks failed', { popupMetrics, dashMetrics })
    process.exit(1)
  }
  console.log('proof ok')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
