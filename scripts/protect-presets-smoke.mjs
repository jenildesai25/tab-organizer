/** Usage: npm run build && node scripts/protect-presets-smoke.mjs */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')

function fail(message, detail) {
  console.error(`FAIL: ${message}`)
  if (detail !== undefined) console.error(detail)
  process.exit(1)
}

async function main() {
  if (!existsSync(path.join(dist, 'background.js'))) fail('Missing dist/')
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
    const id = /^chrome-extension:\/\/([a-p]{32})\//.exec(workerTarget.url())?.[1]
    if (!id) fail('No extension id')
    const dash = await browser.newPage()
    await dash.goto(`chrome-extension://${id}/dashboard/index.html`, { waitUntil: 'domcontentloaded' })
    await dash.waitForFunction(() => !!chrome.runtime?.id)

    const result = await dash.evaluate(async () => {
      const mail = await chrome.runtime.sendMessage({ type: 'apply-protect-preset', id: 'mail' })
      const bank = await chrome.runtime.sendMessage({ type: 'apply-protect-preset', id: 'banking' })
      const again = await chrome.runtime.sendMessage({ type: 'apply-protect-preset', id: 'mail' })
      const hand = await chrome.runtime.sendMessage({ type: 'set-protect-hand-renamed', on: true })
      return { mail, bank, again, protectHandRenamed: hand.protectHandRenamed }
    })

    console.log(JSON.stringify(result, null, 2))
    if (!result.mail?.ok || !result.mail.protect.urlPatterns.includes('https://mail.google.com/')) {
      fail('mail preset missing gmail pattern', result.mail)
    }
    if (result.mail.protect.domains.includes('google.com')) fail('mail preset should not protect all google.com')
    if (!result.bank?.ok || !result.bank.protect.domains.includes('chase.com')) fail('banking preset', result.bank)
    if (!result.again?.ok || !/already protected/i.test(result.again.summary)) fail('idempotent mail summary', result.again)
    if (result.protectHandRenamed !== true) fail('protectHandRenamed not set')
    console.log('PASS: protect presets applied.')
  } finally {
    await browser.close().catch(() => {})
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
