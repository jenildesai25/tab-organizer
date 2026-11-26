/**
 * Popup/dashboard UI smoke: load dist/ extension, open pages, assert no
 * uncaught exceptions, critical DOM nodes exist, paint helpers don't throw,
 * and grain overlay CSS is gone.
 *
 * Usage: npm run build && node scripts/popup-ui-smoke.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.resolve(root, 'dist')

function fail(message, detail) {
  console.error(`\nFAIL: ${message}`)
  if (detail !== undefined) {
    console.error(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2))
  }
  process.exitCode = 1
}

function requireDist() {
  for (const name of ['manifest.json', 'popup/popup.html', 'dashboard/index.html', 'ui/shared.css']) {
    const file = path.join(dist, name)
    if (!existsSync(file)) {
      fail(`Missing ${file}. Run npm run build first.`)
      process.exit(1)
    }
  }
}

function extensionIdFromTargetUrl(url) {
  const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(url)
  return match?.[1] ?? null
}

async function waitForExtension(browser, timeoutMs) {
  const target = await browser.waitForTarget(
    (candidate) =>
      candidate.type() === 'service_worker' &&
      candidate.url().startsWith('chrome-extension://') &&
      candidate.url().endsWith('/background.js'),
    { timeout: timeoutMs },
  )
  const id = extensionIdFromTargetUrl(target.url())
  if (!id) throw new Error(`Could not parse extension id from ${target.url()}`)
  return { id, workerTarget: target }
}

async function tryLaunch(options) {
  const browser = await puppeteer.launch(options.launch)
  try {
    const ext = await waitForExtension(browser, options.swTimeoutMs ?? 20_000)
    return { browser, ...ext, mode: options.label }
  } catch (error) {
    await browser.close().catch(() => {})
    throw error
  }
}

async function launchWithExtension() {
  const common = {
    pipe: true,
    enableExtensions: [dist],
    args: ['--no-first-run', '--no-default-browser-check'],
  }
  const attempts = [
    {
      label: 'headless:true + enableExtensions',
      launch: { ...common, headless: true },
      swTimeoutMs: 25_000,
    },
    {
      label: 'headed + enableExtensions',
      launch: { ...common, headless: false },
      swTimeoutMs: 25_000,
    },
  ]
  const errors = []
  for (const attempt of attempts) {
    process.stdout.write(`Launching (${attempt.label})… `)
    try {
      const result = await tryLaunch(attempt)
      console.log('ok')
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log('failed')
      errors.push(`${attempt.label}: ${message}`)
    }
  }
  fail('Could not load the MV3 extension.', errors.join('\n'))
  process.exit(1)
}

function auditSelectors(tsRel, htmlRel) {
  const ts = readFileSync(path.join(root, tsRel), 'utf8')
  const html = readFileSync(path.join(root, htmlRel), 'utf8')
  const needed = new Set()
  for (const m of ts.matchAll(/querySelector(?:All)?(?:<[^>]+>)?\(['"`]#([A-Za-z0-9_-]+)['"`]\)/g)) {
    needed.add(m[1])
  }
  for (const m of ts.matchAll(/getElementById\(['"`]([A-Za-z0-9_-]+)['"`]\)/g)) {
    needed.add(m[1])
  }
  const present = new Set()
  for (const m of html.matchAll(/\bid=["']([^"']+)["']/g)) present.add(m[1])
  const missing = [...needed].filter((id) => !present.has(id))
  return { needed: [...needed].sort(), missing }
}

async function openAndProbe(browser, extensionId, pagePath, criticalIds) {
  const page = await browser.newPage()
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    pageErrors.push(err instanceof Error ? err.message : String(err))
  })

  const url = `chrome-extension://${extensionId}/${pagePath}`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForFunction(() => typeof chrome !== 'undefined' && !!chrome.runtime?.id, {
    timeout: 15_000,
  })
  // Let controllers finish first paint / storage reads.
  await new Promise((r) => setTimeout(r, 800))

  const probe = await page.evaluate(async (ids) => {
    const found = {}
    for (const id of ids) {
      found[id] = !!document.getElementById(id)
    }

    const themeButtons = document.querySelectorAll('.theme-toggle [data-theme]').length
    const grainBefore = getComputedStyle(document.body, '::before')
    const grainBg = grainBefore.backgroundImage || ''
    const grainContent = grainBefore.content || ''
    const hasGrain =
      grainContent !== 'none' &&
      grainContent !== 'normal' &&
      grainContent !== '""' &&
      /feTurbulence|fractalNoise|noise/i.test(grainBg)

    const paintErrors = []
    const popupGroupsList = document.getElementById('groups')
    const popupHasGroupRows = document.querySelectorAll('.groups-section .group-item, .groups-section .group-list').length
    if (location.pathname.includes('/popup/') && (popupGroupsList || popupHasGroupRows > 0)) {
      paintErrors.push('popup still renders a full groups list (expected summary only)')
    }
    const groupsSummary = document.getElementById('groups-summary')
    if (location.pathname.includes('/popup/') && !groupsSummary) {
      paintErrors.push('popup missing #groups-summary')
    }
    const dashGroups = document.getElementById('groups-list')
    try {
      if (dashGroups) {
        dashGroups.replaceChildren()
        const li = document.createElement('li')
        li.className = 'group-item'
        const copy = document.createElement('div')
        copy.className = 'group-copy'
        const name = document.createElement('span')
        name.className = 'group-name'
        name.textContent = 'YouTube'
        name.title = 'YouTube'
        copy.append(name)
        li.append(document.createElement('span'), copy)
        dashGroups.append(li)
        const shown = name.getBoundingClientRect().width
        const full = name.scrollWidth
        paintErrors.push(
          shown > 0 && full > shown + 1 ? `title truncated: shown=${shown} scroll=${full}` : null,
        )
      }
    } catch (error) {
      paintErrors.push(`group paint: ${error instanceof Error ? error.message : String(error)}`)
    }

    const progressPanel = document.getElementById('progress-panel')
    const progressBar = document.getElementById('organize-progress')
    try {
      if (progressPanel && progressBar) {
        progressPanel.hidden = false
        progressPanel.classList.toggle('is-running', true)
        progressBar.removeAttribute('value')
        progressPanel.hidden = true
        progressPanel.classList.remove('is-running')
      }
    } catch (error) {
      paintErrors.push(`progress paint: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Trigger refresh buttons if present (exercises list paint).
    for (const id of ['refresh-groups', 'refresh-activity']) {
      const btn = document.getElementById(id)
      if (btn) btn.click()
    }
    await new Promise((r) => setTimeout(r, 400))

    const themeToggle = document.querySelector('.theme-toggle')
    const themeRect = themeToggle?.getBoundingClientRect()
    const brand = document.querySelector('.brand-lockup, .hero-brand-row')
    const brandRect = brand?.getBoundingClientRect()
    const brandMark = document.querySelector('.brand-mark')
    const brandMarkRect = brandMark?.getBoundingClientRect()
    const statusEl = document.getElementById('status')
    const statusRect = statusEl?.getBoundingClientRect()
    let themeOverlapsBrand = false
    let themeOverlapsStatus = false
    let themeClipped = false
    if (themeRect && brandRect) {
      themeOverlapsBrand =
        themeRect.left < brandRect.right - 2 &&
        themeRect.right > brandRect.left + 2 &&
        themeRect.top < brandRect.bottom - 2 &&
        themeRect.bottom > brandRect.top + 2
    }
    if (themeRect && statusRect && statusEl && !statusEl.hidden) {
      themeOverlapsStatus =
        themeRect.left < statusRect.right - 2 &&
        themeRect.right > statusRect.left + 2 &&
        themeRect.top < statusRect.bottom - 2 &&
        themeRect.bottom > statusRect.top + 2
    }
    if (themeRect) {
      themeClipped = themeRect.left < -0.5 || themeRect.right > document.documentElement.clientWidth + 0.5
    }

    const rootWidth = Math.round(
      Math.max(document.documentElement.getBoundingClientRect().width, document.body.getBoundingClientRect().width),
    )
    const cssWidth = getComputedStyle(document.documentElement).width
    const mainMax =
      getComputedStyle(document.querySelector('main') || document.body).maxWidth || ''
    const hasFloatingStack = !!document.querySelector('.hero-visual, .stack-card')

    return {
      found,
      themeButtons,
      hasGrain,
      grainContent,
      grainBg: grainBg.slice(0, 120),
      paintErrors: paintErrors.filter(Boolean),
      bodyClass: document.body.className,
      rootWidth,
      cssWidth,
      mainMax,
      themeOverlapsBrand,
      themeOverlapsStatus,
      themeClipped,
      brandVisible: !!(brandRect && brandRect.width > 20 && brandRect.height > 10),
      brandMarkVisible: !!(brandMarkRect && brandMarkRect.width > 10 && brandMarkRect.height > 10),
      hasFloatingStack,
      pathname: location.pathname,
    }
  }, criticalIds)

  // Extra settle after refresh clicks
  await new Promise((r) => setTimeout(r, 500))

  return { page, consoleErrors, pageErrors, probe, url }
}

async function main() {
  requireDist()

  console.log('--- Selector audit (src) ---')
  for (const [ts, html, label] of [
    ['src/popup/popup.ts', 'src/popup/popup.html', 'popup'],
    ['src/dashboard/dashboard.ts', 'src/dashboard/index.html', 'dashboard'],
  ]) {
    const { missing, needed } = auditSelectors(ts, html)
    console.log(`${label}: ${needed.length} selectors`)
    if (missing.length) {
      fail(`${label} selectors missing from HTML`, missing)
      return
    }
    console.log(`${label}: all IDs present`)
  }

  const sharedCss = readFileSync(path.join(dist, 'ui/shared.css'), 'utf8')
  if (/feTurbulence|fractalNoise|--grain-opacity/.test(sharedCss)) {
    fail('dist/ui/shared.css still contains grain overlay CSS')
    return
  }
  console.log('shared.css: grain overlay absent')

  const { browser, id, mode } = await launchWithExtension()
  console.log(`Extension id: ${id}`)
  console.log(`Mode: ${mode}`)

  const popupCss = readFileSync(path.join(dist, 'popup/popup.css'), 'utf8')
  if (!/width:\s*520px/.test(popupCss)) {
    fail('dist/popup/popup.css must set width: 520px', popupCss.slice(0, 240))
    return
  }
  if (/max-width:\s*100vw/.test(popupCss)) {
    fail('dist/popup/popup.css must not use max-width: 100vw (caps Chrome popup width)')
    return
  }
  console.log('popup.css: width 520px present, no 100vw cap')

  const popupCritical = [
    'sweep',
    'organizer',
    'llm',
    'groups-summary',
    'manage-groups',
    'progress-panel',
    'organize-progress',
    'refresh-groups',
    'open-dashboard',
    'status',
  ]
  const dashCritical = [
    'sweep',
    'organizer',
    'llm',
    'groups-list',
    'progress-panel',
    'organize-progress',
    'rule-list',
    'theme-toggle-proxy-skip',
  ].filter((x) => x !== 'theme-toggle-proxy-skip')

  let popup
  let dash
  try {
    popup = await openAndProbe(browser, id, 'popup/popup.html', popupCritical)
    console.log('\n--- Popup ---')
    console.log(popup.url)

    const missingPopup = popupCritical.filter((idName) => !popup.probe.found[idName])
    if (missingPopup.length) fail('Popup missing critical elements', missingPopup)
    if (popup.probe.themeButtons < 3) fail('Popup theme controls missing', popup.probe.themeButtons)
    if (popup.probe.hasGrain) fail('Popup still has grain ::before', popup.probe)
    if (popup.probe.paintErrors.length) fail('Popup paint errors', popup.probe.paintErrors)
    if (popup.pageErrors.length) fail('Popup uncaught exceptions', popup.pageErrors)
    if (popup.probe.rootWidth < 480) {
      fail('Popup root width too narrow (want ≥480px)', {
        rootWidth: popup.probe.rootWidth,
        cssWidth: popup.probe.cssWidth,
      })
    }
    if (!popup.probe.brandVisible || !popup.probe.brandMarkVisible) {
      fail('Popup brand mark/title not visible', {
        brandVisible: popup.probe.brandVisible,
        brandMarkVisible: popup.probe.brandMarkVisible,
        rootWidth: popup.probe.rootWidth,
      })
    }
    if (popup.probe.themeClipped) {
      fail('Popup theme toggle is clipped by the popup edge', {
        themeClipped: popup.probe.themeClipped,
        rootWidth: popup.probe.rootWidth,
      })
    }
    if (popup.probe.themeOverlapsBrand || popup.probe.themeOverlapsStatus) {
      fail('Popup theme toggle overlaps brand/status', {
        themeOverlapsBrand: popup.probe.themeOverlapsBrand,
        themeOverlapsStatus: popup.probe.themeOverlapsStatus,
        rootWidth: popup.probe.rootWidth,
      })
    }
    // Filter noisy extension chrome errors that aren't our null DOM bugs
    const realConsole = popup.consoleErrors.filter(
      (line) =>
        !/favicon/i.test(line) &&
        !/Download the React DevTools/i.test(line),
    )
    if (realConsole.length) fail('Popup console errors', realConsole)
    if (!process.exitCode) console.log('PASS: popup UI')

    dash = await openAndProbe(browser, id, 'dashboard/index.html', dashCritical)
    console.log('\n--- Dashboard ---')
    console.log(dash.url)
    const missingDash = dashCritical.filter((idName) => !dash.probe.found[idName])
    if (missingDash.length) fail('Dashboard missing critical elements', missingDash)
    if (dash.probe.themeButtons < 3) fail('Dashboard theme controls missing', dash.probe.themeButtons)
    if (dash.probe.hasGrain) fail('Dashboard still has grain ::before', dash.probe)
    if (dash.probe.paintErrors.length) fail('Dashboard paint errors', dash.probe.paintErrors)
    if (dash.pageErrors.length) fail('Dashboard uncaught exceptions', dash.pageErrors)
    if (dash.probe.hasFloatingStack) {
      fail('Dashboard still has floating hero stack collage', dash.probe)
    }
    if (!/11\d{2}px/.test(dash.probe.mainMax || '')) {
      fail('Dashboard main max-width should be ~1100px', dash.probe.mainMax)
    }
    const realDashConsole = dash.consoleErrors.filter(
      (line) =>
        !/favicon/i.test(line) &&
        !/Download the React DevTools/i.test(line),
    )
    if (realDashConsole.length) fail('Dashboard console errors', realDashConsole)
    if (!process.exitCode) console.log('PASS: dashboard UI')

    if (!process.exitCode) {
      console.log('\nPASS: popup-ui-smoke')
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  } finally {
    if (popup?.page) await popup.page.close().catch(() => {})
    if (dash?.page) await dash.page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

await main()
