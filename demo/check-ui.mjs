// Usage: node demo/check-ui.mjs <file.gcode>   (needs `vite preview --port 4317`)
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(__dirname, 'preview')
const url = process.env.DEMO_URL || 'http://127.0.0.1:4317/'
const gcode = process.argv[2]

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))

async function report(name) {
  const metrics = await page.evaluate(() => ({
    scroll: document.documentElement.scrollHeight,
    width: document.documentElement.scrollWidth,
    view: innerWidth,
  }))
  console.log(name, metrics)
  await page.screenshot({ path: path.join(out, `ui-${name}.png`) })
}

// Orca's page host styles body text and inputs; reproduce that to catch inherited-colour bugs.
const hostCss = 'body{color:#3a3a3a;font:12px Arial} input{border:1px solid #fff}'
await page.addInitScript((css) => {
  addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
  })
}, hostCss)
await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.setItem('bottleneck3d.lang', 'ru'))
await page.reload({ waitUntil: 'networkidle' })
await report('intro-ru')

const started = Date.now()
if (gcode) await page.locator('input[type=file]').first().setInputFiles(gcode)
else await page.locator('.intro-actions .btn').click()

let sawActivity = false
for (let i = 0; i < 2400 && !(await page.locator('.ov-time').count()); i += 1) {
  if (await page.locator('.activity-bar.is-on').count()) sawActivity = true
  await page.waitForTimeout(50)
}
console.log('loaded in', Date.now() - started, 'ms; activity bar seen:', sawActivity)
await page.waitForTimeout(1500)
await report('overview-ru')

const tabs = page.locator('.tabs button')
await tabs.nth(1).click()
await page.waitForTimeout(1200)
await report('time-ru')

await tabs.nth(2).click()
await page.waitForTimeout(1500)
await report('upgrades-ru')

const range = page.locator('.lever input[type=range]').first()
const box = await range.boundingBox()
const before = await page.locator('.result-delta strong').innerText()
await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 8 })
await page.waitForTimeout(400)
const dragging = await page.locator('.lever.is-dragging').count()
const computingWhileDrag = await page.locator('.result-card.is-computing').count()
await page.screenshot({ path: path.join(out, 'ui-dragging.png') })
await page.mouse.up()
await page.waitForTimeout(60)
const computingAfter = await page.locator('.result-card.is-computing, .activity-bar.is-on').count()
await page.waitForTimeout(2500)
const after = await page.locator('.result-delta strong').innerText()
console.log({ before, after, dragging, computingWhileDrag, computingAfter })
await report('upgrades-after-drag')

await page.locator('.scenario').first().click()
await page.waitForTimeout(2000)
await report('upgrades-scenario')

await tabs.nth(3).click()
await page.waitForTimeout(600)
await report('details-ru')

await page.locator('.topbar .segmented button', { hasText: 'EN' }).click()
await tabs.nth(0).click()
await page.waitForTimeout(1200)
await report('overview-en')
await tabs.nth(2).click()
await page.waitForTimeout(1200)
await report('upgrades-en')

await page.setViewportSize({ width: 390, height: 844 })
await tabs.nth(0).click()
await page.waitForTimeout(1000)
await report('mobile-overview')
await tabs.nth(2).click()
await page.waitForTimeout(1000)
await report('mobile-upgrades')

console.log('errors:', errors)
await browser.close()
