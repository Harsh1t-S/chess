// Shared helpers for the browser QA passes.
import { loadChromium } from './browser.mjs'
import { readFileSync, existsSync } from 'node:fs'

const CDN = process.env.CDN_DIR
export const BASE = process.env.FORGECHESS_URL || 'http://localhost:4173/'

export async function openApp ({ viewport = { width: 1440, height: 940 }, fresh = true } = {}) {
  const chromium = await loadChromium()
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (text.includes('Failed to load resource')) return
    errors.push(text)
  })
  // Optional: serve the theme artwork from a local mirror so the suite can run
// with no access to the theme CDN. Set CDN_DIR to a directory holding
// pieces/<theme>/<code>.png and boards/<theme>.png.
  if (CDN) {
    await page.route(/chess\.com\/chess-themes\/pieces\//, (route) => {
      const match = route.request().url().match(/pieces\/([^/]+)\/\d+\/(\w\w)\.png/)
      const file = match ? `${CDN}/pieces/${match[1]}/${match[2]}.png` : null
      return file && existsSync(file)
        ? route.fulfill({ contentType: 'image/png', body: readFileSync(file) })
        : route.abort()
    })
    await page.route(/chesscomfiles\.com\/chess-themes\/boards\//, (route) => {
      const match = route.request().url().match(/boards\/([^/]+)\//)
      const file = match ? `${CDN}/boards/${match[1]}.png` : null
      return file && existsSync(file)
        ? route.fulfill({ contentType: 'image/png', body: readFileSync(file) })
        : route.abort()
    })
  }
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.board-view')
  if (fresh) {
    await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('forgechess') })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.board-view')
  }
  return { browser, context, page, errors }
}

export function makeBoard (page) {
  const box = async () => page.locator('.board-view').boundingBox()
  // Orientation is expressed through CSS grid placement, not DOM order.
  const flipped = async () => page.evaluate(() => {
    const a8 = document.querySelector('.square[data-square="a8"]')
    return a8 ? getComputedStyle(a8).gridColumnStart !== '1' : false
  })
  const centre = async (square) => {
    const rect = await box()
    const isFlipped = await flipped()
    const file = 'abcdefgh'.indexOf(square[0])
    const rank = Number(square[1]) - 1
    const column = isFlipped ? 7 - file : file
    const row = isFlipped ? rank : 7 - rank
    const size = rect.width / 8
    return { x: rect.x + column * size + size / 2, y: rect.y + row * size + size / 2 }
  }
  return {
    centre,
    async click (square) {
      const point = await centre(square)
      await page.mouse.click(point.x, point.y)
      await page.waitForTimeout(80)
    },
    async drag (from, to) {
      const a = await centre(from)
      const b = await centre(to)
      await page.mouse.move(a.x, a.y)
      await page.mouse.down()
      await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 })
      await page.mouse.move(b.x, b.y, { steps: 6 })
      await page.mouse.up()
      await page.waitForTimeout(120)
    },
    async move (from, to) {
      await this.click(from)
      await this.click(to)
    },
    async pieceAt (square) {
      return page.evaluate((sq) => {
        const el = document.querySelector(`.board-pieces .piece[data-square="${sq}"]`)
        return el ? el.dataset.code : null
      }, square)
    },
    async classes (square) {
      return page.evaluate((sq) => {
        const el = document.querySelector(`.square[data-square="${sq}"]`)
        return el ? [...el.classList] : []
      }, square)
    }
  }
}

export function reporter (name) {
  const results = []
  return {
    check (label, condition, detail = '') {
      results.push({ label, ok: !!condition, detail })
      console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` — ${detail}`}`)
    },
    summary () {
      const failed = results.filter((r) => !r.ok)
      console.log(`\n${name}: ${results.length - failed.length}/${results.length} passed`)
      return failed.length
    }
  }
}

export const moveList = async (page) => {
  await page.locator('.panel-tabs button', { hasText: 'Moves' }).click()
  await page.waitForTimeout(250)
  return (await page.locator('.move-list').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
}
export const openPlay = async (page) => {
  await page.locator('.panel-tabs button', { hasText: 'Play' }).click()
  await page.waitForTimeout(250)
}

export const isFlipped = (page) => page.evaluate(() => {
  const a8 = document.querySelector('.square[data-square="a8"]')
  return a8 ? getComputedStyle(a8).gridColumnStart !== '1' : false
})

// The bank keeps a piece armed between placements, so only click it when it is
// not already selected — clicking an armed piece disarms it.
export async function armBank (page, type) {
  const already = await page.locator(`[data-bank="${type}"].active`).count()
  if (!already) {
    await page.locator(`[data-bank="${type}"]`).click()
    await page.waitForTimeout(160)
  }
}

// The opponent lives behind a picker modal now, and the time control is a
// select rather than a row of chips.
export async function selectBot (page, id) {
  await openPlay(page)
  await page.locator('#pick-opponent').click()
  await page.waitForTimeout(250)
  await page.locator(`[data-pick-level="${id}"]`).click()
  await page.waitForTimeout(500)
}

export async function selectTimeControl (page, id) {
  await openPlay(page)
  await page.locator('#time-control').selectOption(id)
  await page.waitForTimeout(700)
}
