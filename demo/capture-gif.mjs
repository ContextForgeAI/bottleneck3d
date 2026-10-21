import { chromium } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const framesDir = path.join(__dirname, 'frames')
const url = process.env.DEMO_URL || 'http://127.0.0.1:5173/'

await rm(framesDir, { recursive: true, force: true })
await mkdir(framesDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
})

let frame = 0
async function shot(hold = 1) {
  for (let i = 0; i < hold; i += 1) {
    await page.screenshot({
      path: path.join(framesDir, `frame-${String(frame).padStart(3, '0')}.png`),
      type: 'png',
    })
    frame += 1
  }
}

async function setNumberField(label, value) {
  const field = page.locator('label.field', { hasText: label }).locator('input')
  await field.fill(String(value))
  await field.blur()
  await page.waitForTimeout(150)
}

async function setRange(index, value) {
  await page.locator('.sliders input[type="range"]').nth(index).evaluate(
    (el, next) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set
      setter?.call(el, String(next))
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    },
    value,
  )
  await page.waitForTimeout(400)
}

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.brand')
await shot(6)

// Make the demo story readable: no min-layer soak eating flow gains.
await setNumberField('Мин. время слоя', 0)
await setNumberField('Макс. объёмный поток', 10)
await shot(4)

await page.getByRole('button', { name: 'Запустить демо' }).click()
await page.waitForSelector('.panel.result .badge')
await page.waitForTimeout(500)
await shot(8)

await page.locator('.breakdown').scrollIntoViewIfNeeded()
await page.waitForTimeout(200)
await shot(12)

await page.locator('.panel.simulator').scrollIntoViewIfNeeded()
await page.waitForTimeout(200)
await shot(6)

for (const value of [14, 18, 24, 32, 45]) {
  await setRange(0, value)
  await shot(3)
}
await shot(8)

for (const value of [12000, 25000, 40000]) {
  await setRange(1, value)
  await shot(3)
}
await shot(10)

const after = await page.locator('.time-comparison .after strong').innerText()
const saved = await page.locator('.time-comparison .saved b').innerText()
const badge = await page.locator('.panel.result .badge').innerText()
console.log({ badge, after, saved, frame })

await browser.close()
