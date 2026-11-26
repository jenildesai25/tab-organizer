/**
 * Browser smoke: load dist/ into Chrome for Testing, crowd a window with https
 * tabs (including about:blank→navigate and discarded tabs), run Organize via
 * the same chrome.runtime sweep path the popup/dashboard use, and assert real
 * chrome.tabGroups appear.
 *
 * Usage: npm run build && npm run test:browser
 *
 * MV3 note: prefers Puppeteer enableExtensions (pipe) with headless:true;
 * falls back to headed if the service worker never appears.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.resolve(root, 'dist')
const TIMEOUT_MS = Number(process.env.BROWSER_SMOKE_TIMEOUT_MS || 120_000)

function fail(message, detail) {
  console.error(`\nFAIL: ${message}`)
  if (detail !== undefined) {
    console.error(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2))
  }
  process.exitCode = 1
}

function requireDist() {
  for (const name of ['manifest.json', 'background.js', 'dashboard/index.html']) {
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
      label: "headless:true + enableExtensions (Chrome for Testing)",
      launch: { ...common, headless: true },
      swTimeoutMs: 25_000,
    },
    {
      label: 'headed + enableExtensions',
      launch: { ...common, headless: false },
      swTimeoutMs: 25_000,
    },
    {
      label: 'headed + classic --load-extension flags',
      launch: {
        headless: false,
        args: [
          ...common.args,
          `--disable-extensions-except=${dist}`,
          `--load-extension=${dist}`,
        ],
      },
      swTimeoutMs: 25_000,
    },
  ]

  const errors = []
  for (const attempt of attempts) {
    process.stdout.write(`Launching (${attempt.label})… `)
    try {
      const result = await tryLaunch(attempt)
      console.log('ok')
      console.log(`Extension id: ${result.id}`)
      console.log(`Mode that works: ${result.mode}`)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log('failed')
      errors.push(`${attempt.label}: ${message}`)
    }
  }

  fail('Could not load the MV3 extension in any launch mode.', errors.join('\n'))
  process.exit(1)
}

async function openDashboard(browser, extensionId) {
  const page = await browser.newPage()
  const url = `chrome-extension://${extensionId}/dashboard/index.html`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForFunction(() => typeof chrome !== 'undefined' && !!chrome.runtime?.id, {
    timeout: 15_000,
  })
  return page
}

/** Crowd a normal window and run the same sweep message the popup uses. */
async function runOrganizeFlow(dashboard) {
  return dashboard.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    const seedUrls = [
      'https://example.com/',
      'https://example.com/user/alpha',
      'https://example.com/user/bravo',
      'https://example.org/',
      'https://example.org/page/one',
      'https://example.org/page/two',
      'https://www.example.com/',
      'https://www.example.org/',
      'https://httpbin.org/html',
      'https://httpbin.org/links/5/0',
      'https://httpbin.org/json',
      'https://example.net/',
      'https://example.net/docs',
      'https://example.net/help',
    ]

    const win = await chrome.windows.create({
      url: seedUrls.slice(0, 8),
      focused: true,
      type: 'normal',
    })
    if (win.id == null) throw new Error('windows.create returned no id')

    for (const url of seedUrls.slice(8)) {
      await chrome.tabs.create({ windowId: win.id, url, active: false })
    }

    // Failure-mode: about:blank then navigate to https (pendingUrl / blank races).
    const blankTabs = []
    for (let i = 0; i < 3; i += 1) {
      blankTabs.push(await chrome.tabs.create({ windowId: win.id, url: 'about:blank', active: false }))
    }
    await sleep(400)
    const blankTargets = [
      'https://example.com/blank-nav-1',
      'https://example.org/blank-nav-2',
      'https://httpbin.org/get',
    ]
    for (let i = 0; i < blankTabs.length; i += 1) {
      const tab = blankTabs[i]
      if (tab.id == null) continue
      await chrome.tabs.update(tab.id, { url: blankTargets[i] })
    }

    // A couple of browser pages (should be skipped, not kill eligibility).
    for (const url of ['chrome://version/', 'chrome://settings/']) {
      try {
        await chrome.tabs.create({ windowId: win.id, url, active: false })
      } catch {
        // Some Chrome builds block chrome:// creation from extensions.
      }
    }

    // Let navigations settle, then discard a few background https tabs.
    await sleep(2500)
    const beforeDiscard = await chrome.tabs.query({ windowId: win.id })
    let discarded = 0
    for (const tab of beforeDiscard) {
      if (tab.id == null || tab.active || tab.pinned) continue
      const address = tab.url || tab.pendingUrl || ''
      if (!address.startsWith('http')) continue
      try {
        await chrome.tabs.discard(tab.id)
        discarded += 1
        if (discarded >= 3) break
      } catch {
        // discard can fail for chrome:// or already-discarded tabs
      }
    }

    await sleep(800)

    const tabsBefore = await chrome.tabs.query({ windowId: win.id })
    const groupsBefore = await chrome.tabGroups.query({ windowId: win.id })
    const sampleBefore = tabsBefore.slice(0, 20).map((tab) => ({
      id: tab.id,
      url: tab.url || '',
      pendingUrl: tab.pendingUrl || '',
      title: (tab.title || '').slice(0, 80),
      groupId: tab.groupId,
      discarded: tab.discarded === true,
      status: tab.status || '',
    }))

    const sweep = await chrome.runtime.sendMessage({ type: 'sweep', windowId: win.id })

    const tabsAfter = await chrome.tabs.query({ windowId: win.id })
    const groupsAfter = await chrome.tabGroups.query({ windowId: win.id })
    const groupedTabs = tabsAfter.filter((tab) => tab.groupId != null && tab.groupId >= 0)
    const listed = await chrome.runtime.sendMessage({ type: 'list-groups', windowId: win.id })

    return {
      windowId: win.id,
      discarded,
      tabCount: tabsAfter.length,
      groupsBefore: groupsBefore.length,
      groupsAfter: groupsAfter.length,
      groupedTabCount: groupedTabs.length,
      groups: groupsAfter.map((group) => ({
        id: group.id,
        title: group.title || '',
        color: group.color,
      })),
      listed,
      sweep,
      sampleBefore,
      sampleAfter: tabsAfter.slice(0, 20).map((tab) => ({
        id: tab.id,
        url: tab.url || '',
        pendingUrl: tab.pendingUrl || '',
        title: (tab.title || '').slice(0, 80),
        groupId: tab.groupId,
        discarded: tab.discarded === true,
        status: tab.status || '',
      })),
    }
  })
}

function assertOrganize(outcome) {
  const { sweep, groupsAfter, groupedTabCount, sampleBefore, listed } = outcome
  console.log('\n--- Organize outcome ---')
  console.log(`Tabs: ${outcome.tabCount}, discarded attempts: ${outcome.discarded}`)
  console.log(`Groups before→after: ${outcome.groupsBefore}→${groupsAfter}`)
  console.log(`Grouped tabs: ${groupedTabCount}`)
  console.log(`Sweep: ${JSON.stringify(sweep, null, 2)}`)
  console.log(`list-groups: ${JSON.stringify(listed, null, 2)}`)
  if (sweep?.diag) console.log(`Diag: ${JSON.stringify(sweep.diag, null, 2)}`)
  console.log('Sample tabs before sweep:')
  console.log(JSON.stringify(sampleBefore, null, 2))

  if (!sweep || typeof sweep !== 'object') {
    fail('Sweep response missing', outcome)
    return false
  }

  if (sweep.ok !== true) {
    fail(`Sweep failed: ${sweep.message || 'unknown'}`, {
      sweep,
      sampleBefore,
      sampleAfter: outcome.sampleAfter,
    })
    return false
  }

  const summary = String(sweep.summary || '')
  const httpsPresent = sampleBefore.some(
    (tab) =>
      (tab.url || '').startsWith('http') ||
      (tab.pendingUrl || '').startsWith('http') ||
      (tab.url || '').startsWith('about:blank'),
  )

  if (httpsPresent && /Eligible 0\b/.test(summary)) {
    fail('Summary says Eligible 0 while https/about:blank tabs exist', {
      summary,
      sampleBefore,
      diag: sweep.diag,
    })
    return false
  }

  if (groupsAfter < 1) {
    fail('Expected at least one chrome.tabGroups entry after Organize', {
      summary,
      groups: outcome.groups,
      sampleAfter: outcome.sampleAfter,
      diag: sweep.diag,
    })
    return false
  }

  if (groupedTabCount < 1) {
    fail('Expected grouped tab count > 0', {
      summary,
      sampleAfter: outcome.sampleAfter,
      diag: sweep.diag,
    })
    return false
  }

  if (!listed || listed.ok !== true || !Array.isArray(listed.groups) || listed.groups.length < 1) {
    fail('Expected list-groups to return ≥1 group after Organize', { listed, groups: outcome.groups })
    return false
  }

  console.log('\nPASS: real tab groups created in Chromium.')
  console.log(`Groups: ${outcome.groups.map((g) => g.title || g.id).join(', ')}`)
  console.log(`list-groups count: ${listed.groups.length}`)
  console.log(`Summary: ${summary}`)
  return true
}

/**
 * Watch-mode refile: land on Google inside a Google group, navigate to
 * whatsapp.com, and assert the tab leaves Google for a WhatsApp group.
 *
 * Avoid google.com/search in headless (bot interstitial). Prefer homepage.
 * Do not manually chrome.tabs.group the traveler — that marks it sticky via
 * onMoved and watch mode would leave it put.
 */
async function runRefileOnSiteChangeFlow(dashboard) {
  return dashboard.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    await chrome.runtime.sendMessage({ type: 'set-organizer', on: true })

    const win = await chrome.windows.create({
      url: ['https://www.google.com/', 'https://www.google.com/'],
      focused: true,
      type: 'normal',
    })
    if (win?.id == null) throw new Error('windows.create returned no id')
    const windowId = win.id
    await chrome.windows.update(windowId, { focused: true })

    // Let the organizer create the Google site group from the two seeds.
    await sleep(4500)
    let groups = await chrome.tabGroups.query({})
    let googleGroup = groups.find((group) => (group.title || '').toLowerCase() === 'google')
    if (!googleGroup) {
      throw new Error(
        `Expected organizer to create a Google group, got ${JSON.stringify(
          groups.map((group) => group.title || group.id),
        )}`,
      )
    }
    const googleGroupId = googleGroup.id

    // Traveler lands on Google and is filed into Google (extension-owned, not sticky).
    const created = await chrome.tabs.create({
      windowId,
      url: 'https://www.google.com/',
      active: true,
    })
    if (created.id == null) throw new Error('tabs.create returned no id')
    const tabId = created.id

    await sleep(4500)
    let afterGoogle = await chrome.tabs.get(tabId)
    if (afterGoogle.groupId !== googleGroupId) {
      throw new Error(
        `Expected traveler in Google group ${googleGroupId}, got ${afterGoogle.groupId}`,
      )
    }
    const groupAfterGoogle = afterGoogle.groupId

    await chrome.tabs.update(tabId, { url: 'https://www.whatsapp.com/' })

    let afterWhatsapp = afterGoogle
    let whatsappGroup = null
    for (let i = 0; i < 12; i += 1) {
      await sleep(1000)
      afterWhatsapp = await chrome.tabs.get(tabId)
      groups = await chrome.tabGroups.query({})
      whatsappGroup = groups.find((group) => (group.title || '').toLowerCase().includes('whatsapp'))
      if (whatsappGroup && afterWhatsapp.groupId === whatsappGroup.id) break
    }

    googleGroup = groups.find((group) => group.id === googleGroupId) ?? googleGroup

    return {
      windowId,
      tabId,
      groupAfterGoogle,
      groupAfterWhatsapp: afterWhatsapp.groupId,
      googleGroupId,
      googleTitle: googleGroup?.title || '',
      whatsappGroupId: whatsappGroup?.id ?? null,
      whatsappTitle: whatsappGroup?.title || '',
      groups: groups.map((group) => ({ id: group.id, title: group.title || '' })),
      finalUrl: afterWhatsapp.url || afterWhatsapp.pendingUrl || '',
    }
  })
}

function assertRefile(outcome) {
  console.log('\n--- Refile-on-site-change outcome ---')
  console.log(JSON.stringify(outcome, null, 2))

  if (!outcome || typeof outcome !== 'object') {
    fail('Refile flow returned nothing', outcome)
    return false
  }

  if (!(outcome.finalUrl || '').includes('whatsapp')) {
    fail('Expected tab URL to be whatsapp.com after navigation', outcome)
    return false
  }

  if (outcome.groupAfterWhatsapp == null || outcome.groupAfterWhatsapp < 0) {
    fail('Expected tab to be in a group after navigating to WhatsApp', outcome)
    return false
  }

  if (outcome.groupAfterWhatsapp === outcome.googleGroupId) {
    fail('Tab stayed in the Google group after navigating to WhatsApp', outcome)
    return false
  }

  const title = String(outcome.whatsappTitle || '').toLowerCase()
  if (!title.includes('whatsapp')) {
    fail('Expected a WhatsApp-titled group after refile', outcome)
    return false
  }

  if (outcome.whatsappGroupId != null && outcome.groupAfterWhatsapp !== outcome.whatsappGroupId) {
    fail('Tab group id does not match the WhatsApp group', outcome)
    return false
  }

  console.log('\nPASS: google→whatsapp refiled out of Google into WhatsApp.')
  return true
}

async function main() {
  requireDist()
  console.log(`Loading extension from ${dist}`)

  const started = Date.now()
  const { browser, id, mode } = await launchWithExtension()
  let dashboard
  try {
    dashboard = await openDashboard(browser, id)
    const outcome = await Promise.race([
      runOrganizeFlow(dashboard),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Organize flow timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
      ),
    ])
    assertOrganize(outcome)

    const refile = await Promise.race([
      runRefileOnSiteChangeFlow(dashboard),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Refile flow timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
      ),
    ])
    assertRefile(refile)

    console.log(`\nBrowser mode used: ${mode}`)
    console.log(`Elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  } finally {
    if (dashboard) await dashboard.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

await main()
