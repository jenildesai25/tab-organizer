/**
 * Record a short Tab Organizer demo (popup → dashboard activity/rules).
 * Writes docs/demo/tab-organizer-demo.mp4 (+ .webm if size allows).
 *
 * Usage: npm run build && node scripts/record-demo.mjs
 */
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.resolve(root, 'dist')
const outDir = path.resolve(root, 'docs/demo')
const framesDir = path.resolve(root, '.scratch/demo-frames')
const FPS = 12
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 }

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

function requireDist() {
  for (const name of ['manifest.json', 'popup/popup.html', 'dashboard/index.html']) {
    if (!existsSync(path.join(dist, name))) fail(`Missing dist/${name}. Run npm run build first.`)
  }
}

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

async function launchWithExtension() {
  const common = {
    pipe: true,
    enableExtensions: [dist],
    defaultViewport: VIEWPORT,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    ],
  }
  for (const headless of [true, false]) {
    try {
      process.stdout.write(`Launching (headless=${headless})… `)
      const browser = await puppeteer.launch({ ...common, headless })
      const id = await waitForExtension(browser)
      console.log('ok')
      return { browser, id }
    } catch (error) {
      console.log('failed')
      console.error(error instanceof Error ? error.message : error)
    }
  }
  fail('Could not load the MV3 extension.')
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exited ${code}\n${stderr.slice(-2000)}`))
    })
  })
}

async function seedDemoState(browser, extensionId) {
  const worker = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().includes(extensionId),
    { timeout: 15_000 },
  )
  const sw = await worker.worker()
  if (!sw) throw new Error('No service worker')

  await sw.evaluate(async () => {
    const now = Date.now()
    await chrome.storage.local.set({
      organizerOn: true,
      llmOn: true,
      model: 'llama3.2',
      uiColorScheme: 'light',
      rules: [
        {
          id: 'r1',
          sentence: 'use gb for github',
          domains: ['github.com'],
          title: 'gb',
        },
        {
          id: 'r2',
          sentence: 'put github and gitlab in Code',
          domains: ['github.com', 'gitlab.com'],
          title: 'Code',
        },
        {
          id: 'r3',
          sentence: 'call linear Work',
          domains: ['linear.app'],
          title: 'Work',
        },
      ],
      activityLog: [
        {
          id: 'a1',
          ts: now - 5 * 60_000,
          actor: 'sweep',
          action: 'group.create',
          groupTitle: 'gb',
          tabCount: 2,
          siteKey: 'github.com',
        },
        {
          id: 'a2',
          ts: now - 4 * 60_000,
          actor: 'organizer',
          action: 'tab.file',
          groupTitle: 'Code',
          siteKey: 'gitlab.com',
        },
        {
          id: 'a3',
          ts: now - 3 * 60_000,
          actor: 'user',
          action: 'group.rename',
          oldTitle: 'Misc',
          newTitle: 'Work',
          groupTitle: 'Work',
        },
        {
          id: 'a4',
          ts: now - 2 * 60_000,
          actor: 'ai',
          action: 'group.rename',
          oldTitle: 'Repos',
          newTitle: 'Code',
          groupTitle: 'Code',
          model: 'llama3.2',
        },
        {
          id: 'a5',
          ts: now - 60_000,
          actor: 'rule',
          action: 'group.create',
          groupTitle: 'Work',
          siteKey: 'linear.app',
        },
      ],
    })

    const urls = [
      'https://github.com/',
      'https://gitlab.com/',
      'https://linear.app/',
      'https://example.com/',
      'https://www.wikipedia.org/',
    ]
    const tabs = []
    for (const url of urls) {
      const tab = await chrome.tabs.create({ url, active: false })
      tabs.push(tab.id)
    }
    await new Promise((r) => setTimeout(r, 1500))
    const g1 = await chrome.tabs.group({ tabIds: [tabs[0]] })
    await chrome.tabGroups.update(g1, { title: 'gb', color: 'green' })
    const g2 = await chrome.tabs.group({ tabIds: [tabs[1], tabs[3]] })
    await chrome.tabGroups.update(g2, { title: 'Code', color: 'blue' })
    const g3 = await chrome.tabs.group({ tabIds: [tabs[2]] })
    await chrome.tabGroups.update(g3, { title: 'Work', color: 'purple' })
  })
}

class FrameRecorder {
  constructor(page, dir) {
    this.page = page
    this.dir = dir
    this.index = 0
  }

  start() {
    mkdirSync(this.dir, { recursive: true })
  }

  async capture() {
    const file = path.join(this.dir, `frame-${String(this.index).padStart(5, '0')}.jpg`)
    try {
      await this.page.screenshot({
        path: file,
        type: 'jpeg',
        quality: 82,
        captureBeyondViewport: false,
      })
      this.index += 1
    } catch {
      // page may be navigating / closed
    }
  }

  /** Hold on the current view while writing frames at FPS. */
  async hold(ms) {
    const frameMs = Math.round(1000 / FPS)
    const end = Date.now() + ms
    while (Date.now() < end) {
      const tick = Date.now()
      await this.capture()
      const spent = Date.now() - tick
      const wait = frameMs - spent
      if (wait > 0) await sleep(wait)
    }
  }
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

async function stagePopupCanvas(page) {
  await page.evaluate(() => {
    document.documentElement.style.width = '100%'
    document.documentElement.style.height = '100%'
    document.body.style.minHeight = '100vh'
    document.body.style.margin = '0'
    document.body.style.display = 'flex'
    document.body.style.justifyContent = 'center'
    document.body.style.alignItems = 'flex-start'
    document.body.style.padding = '48px 24px'
    document.body.style.boxSizing = 'border-box'
    document.body.style.background =
      'radial-gradient(ellipse at 15% 0%, #ccfbf1 0%, transparent 42%), radial-gradient(ellipse at 90% 100%, #ffedd5 0%, transparent 40%), #f1f5f9'
    const root = document.querySelector('.popup-body') || document.body
    root.style.width = '520px'
    root.style.maxWidth = '520px'
    root.style.boxShadow = '0 24px 60px rgba(15,23,42,.18)'
    root.style.borderRadius = '16px'
    root.style.overflow = 'hidden'
  })
}

async function showTitleCard(page, recorder, title, subtitle, holdMs = 1600) {
  await page.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;height:100%;font-family:"Segoe UI",system-ui,sans-serif;background:
      radial-gradient(ellipse at 20% 10%, #ccfbf1 0%, transparent 45%),
      radial-gradient(ellipse at 90% 80%, #ffedd5 0%, transparent 40%),
      linear-gradient(160deg,#f8fafc,#ecfeff 55%,#fff7ed);}
    .wrap{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;
      height:100%;padding:72px 96px;box-sizing:border-box;gap:18px;}
    .mark{display:inline-flex;gap:10px;align-items:center;font-weight:700;letter-spacing:.02em;
      color:#0f766e;font-size:18px;}
    .mark svg{display:block}
    h1{margin:0;font-size:56px;line-height:1.05;color:#0f172a;font-weight:750;max-width:16ch;}
    p{margin:0;font-size:22px;color:#334155;max-width:38ch;line-height:1.4;}
  </style></head><body><div class="wrap">
    <div class="mark"><svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="7" height="16" rx="2" fill="#0f766e"/>
      <rect x="12" y="4" width="9" height="7" rx="2" fill="#14b8a6"/>
      <rect x="12" y="13" width="9" height="7" rx="2" fill="#ea580c"/>
    </svg>Tab Organizer</div>
    <h1>${title}</h1>
    <p>${subtitle}</p>
  </div></body></html>`)
  await recorder.hold(holdMs)
}

async function ensureModelPicker(page) {
  await page.evaluate(() => {
    const controls = document.getElementById('llm-controls')
    if (controls) controls.hidden = false
    const list = document.getElementById('model-list')
    const value = document.getElementById('model-value')
    if (list) {
      list.replaceChildren()
      for (const name of ['llama3.2', 'qwen2.5:7b', 'mistral']) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.setAttribute('role', 'option')
        btn.textContent = name
        btn.dataset.value = name
        list.append(btn)
      }
    }
    if (value) value.textContent = 'llama3.2'
  })
}

async function main() {
  requireDist()
  rmSync(framesDir, { recursive: true, force: true })
  mkdirSync(framesDir, { recursive: true })
  mkdirSync(outDir, { recursive: true })

  const { browser, id } = await launchWithExtension()

  try {
    await seedDemoState(browser, id)

    const page = await browser.newPage()
    await page.setViewport(VIEWPORT)
    const recorder = new FrameRecorder(page, framesDir)
    recorder.start()

    await showTitleCard(
      page,
      recorder,
      'File tabs into native groups',
      'Plain-language rules · optional local Ollama · activity stays on your device',
      2200,
    )

    // Popup tour
    await page.goto(`chrome-extension://${id}/popup/popup.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await page.waitForFunction(() => !!chrome?.runtime?.id, { timeout: 15_000 })
    await page.evaluate(() => {
      document.querySelector('.theme-toggle [data-theme="light"]')?.click()
    })
    await stagePopupCanvas(page)
    await recorder.hold(1800)

    const llm = await page.$('#llm')
    if (llm) {
      const checked = await page.$eval('#llm', (el) => el.checked)
      if (!checked) await llm.click()
    }
    await ensureModelPicker(page)
    await stagePopupCanvas(page)
    await recorder.hold(1200)

    const trigger = await page.$('#model-trigger')
    if (trigger) {
      await trigger.click()
      await page.evaluate(() => {
        const list = document.getElementById('model-list')
        if (list) list.hidden = false
      })
      await recorder.hold(1800)
      await trigger.click()
      await recorder.hold(600)
    }

    const organizer = await page.$('#organizer')
    if (organizer) {
      await organizer.click()
      await recorder.hold(700)
      await organizer.click()
      await recorder.hold(700)
    }

    const refresh = await page.$('#refresh-groups')
    if (refresh) {
      await refresh.click()
      await recorder.hold(1000)
    }

    const sweep = await page.$('#sweep')
    if (sweep) {
      await sweep.hover()
      await recorder.hold(1600)
    }
    await recorder.hold(800)

    await showTitleCard(page, recorder, 'Dashboard', 'Rules, groups, and a local activity history', 1800)

    await page.goto(`chrome-extension://${id}/dashboard/index.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await page.waitForFunction(() => !!chrome?.runtime?.id, { timeout: 15_000 })
    await page.evaluate(() => {
      document.querySelector('.theme-toggle [data-theme="light"]')?.click()
    })
    await recorder.hold(1000)

    await page.evaluate(() => {
      document.getElementById('rules')?.scrollIntoView({ behavior: 'instant', block: 'start' })
    })
    await recorder.hold(2600)

    await page.evaluate(() => {
      document.getElementById('groups')?.scrollIntoView({ behavior: 'instant', block: 'start' })
    })
    await recorder.hold(1000)
    const refreshGroups = await page.$('#refresh-groups')
    if (refreshGroups) {
      await refreshGroups.click()
      await recorder.hold(1200)
    }
    await recorder.hold(1200)

    await page.evaluate(() => {
      document.getElementById('activity')?.scrollIntoView({ behavior: 'instant', block: 'start' })
    })
    await recorder.hold(1600)

    for (const filter of ['ai', 'rules', 'organize', 'all']) {
      await page.evaluate((value) => {
        document.querySelector(`.activity-filter-chip[data-filter="${value}"]`)?.click()
      }, filter)
      await recorder.hold(800)
    }
    await recorder.hold(900)

    await showTitleCard(
      page,
      recorder,
      'Private by default',
      'No Tab Organizer cloud — optional Local model talks only to Ollama on localhost',
      2800,
    )

    await page.close().catch(() => {})
  } finally {
    await browser.close().catch(() => {})
  }

  const frames = readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).sort()
  if (frames.length < 10) fail(`Too few frames captured (${frames.length})`)
  console.log(`Captured ${frames.length} frames`)

  const mp4 = path.join(outDir, 'tab-organizer-demo.mp4')
  const webm = path.join(outDir, 'tab-organizer-demo.webm')

  await run('ffmpeg', [
    '-y',
    '-framerate',
    String(FPS),
    '-i',
    path.join(framesDir, 'frame-%05d.jpg'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    'scale=1280:800:flags=lanczos',
    '-movflags',
    '+faststart',
    '-crf',
    '23',
    '-preset',
    'medium',
    mp4,
  ])
  console.log(`Wrote ${mp4}`)

  try {
    await run('ffmpeg', [
      '-y',
      '-i',
      mp4,
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '0',
      '-crf',
      '32',
      '-an',
      webm,
    ])
    console.log(`Wrote ${webm}`)
  } catch (error) {
    console.warn('webm encode skipped:', error instanceof Error ? error.message : error)
  }

  const { readFileSync } = await import('node:fs')
  const meta = {
    version: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version,
    frames: frames.length,
    fps: FPS,
    viewport: VIEWPORT,
    files: [mp4, webm].filter((f) => existsSync(f)).map((f) => path.relative(root, f)),
    recordedAt: new Date().toISOString(),
  }
  writeFileSync(path.join(outDir, 'demo-meta.json'), JSON.stringify(meta, null, 2) + '\n')
  console.log(JSON.stringify(meta, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
