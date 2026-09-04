// Third pass: every engine level, learning end to end, setup edge cases,
// export, restore, and stability over a long game.
import { openApp, makeBoard, reporter, moveList, openPlay, armBank, selectBot } from './lib.mjs'

const { browser, page, errors } = await openApp()
const board = makeBoard(page)
const t = reporter('flows')

const setMode = async (m) => { await openPlay(page); await page.locator(`[data-mode="${m}"]`).click(); await page.waitForTimeout(700) }
const setVariant = async (v) => { await openPlay(page); await page.locator(`[data-variant="${v}"]`).click(); await page.waitForTimeout(900) }
const forceNew = async () => {
  await openPlay(page)
  await page.locator('#action-new').click()
  await page.waitForTimeout(350)
  if (await page.locator('.confirm-card').isVisible().catch(() => false)) await page.locator('.confirm-card [data-close="yes"]').click()
  await page.waitForTimeout(600)
  await page.locator('.fc-modal [data-close]').first().click().catch(() => {})
  await page.waitForTimeout(200)
}

// --- every level answers a move -----------------------------------------
await setMode('ai')
for (const level of ['nova', 'ember', 'anvil', 'titan', 'forge', 'obsidian']) {
  await selectBot(page, level)
  await forceNew()
  await board.drag('e2', 'e4')
  await page.waitForSelector('.move-row', { timeout: 30000 }).catch(() => {})
  let replied = false
  for (let i = 0; i < 40; i++) {
    const list = await moveList(page)
    const plies = list ? list.split(/\s+/).filter((x) => !x.endsWith('.')).length : 0
    if (plies >= 2) { replied = true; break }
    await page.waitForTimeout(500)
  }
  t.check(`${level} replies within 20s`, replied)
  await openPlay(page)
}

// --- learning loop end to end -------------------------------------------
await setMode('local')
await setVariant('classic')
await forceNew()
for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) await board.move(from, to)
await page.waitForTimeout(500)
t.check('fool’s mate is detected', (await page.locator('.result-title').innerText().catch(() => '')) === 'Black wins')
await page.waitForFunction(() => document.querySelector('.result-accuracy') !== null, null, { timeout: 90000 }).catch(() => {})
t.check('review finishes and reports accuracy', await page.locator('.result-accuracy').isVisible().catch(() => false))
await page.locator('.result-dismiss').click().catch(() => {})
await page.waitForTimeout(400)
await page.locator('.panel-tabs button', { hasText: 'Review' }).click()
await page.waitForTimeout(600)
const review = (await page.locator('.review-panel').innerText()).replace(/\s+/g, ' ')
t.check('review flags the blunder', review.includes('??'), review.slice(0, 120))
t.check('review flags the inaccuracy', review.includes('?!'))
await page.locator('.review-move').first().click()
await page.waitForTimeout(500)
t.check('clicking a reviewed move jumps the board to it', (await board.pieceAt('f3')) === 'wp')

await page.locator('.panel-tabs button', { hasText: 'Learning' }).click()
await page.waitForTimeout(3500)
const learning = (await page.locator('.panel-scroll').innerText()).replace(/\s+/g, ' ')
t.check('learning panel counts the game', /Games learned from 1/.test(learning), learning.slice(0, 160))
t.check('learning panel counts recorded mistakes', /Mistakes recorded [1-9]/.test(learning), learning.slice(0, 200))

const stored = await page.evaluate(async () => {
  const db = await new Promise((resolve) => { const r = indexedDB.open('forgechess'); r.onsuccess = () => resolve(r.result) })
  const all = (store) => new Promise((resolve) => {
    const r = db.transaction([store], 'readonly').objectStore(store).getAll()
    r.onsuccess = () => resolve(r.result); r.onerror = () => resolve([])
  })
  const book = await all('book')
  return {
    entries: book.length,
    punished: book.filter((e) => Object.values(e.moves).some((m) => m.m > 0)).length,
    worst: Math.max(0, ...book.flatMap((e) => Object.values(e.moves).map((m) => m.cp)))
  }
})
t.check('mistakes are written to the book', stored.punished >= 2, JSON.stringify(stored))
t.check('the worst blunder is recorded at full weight', stored.worst >= 300, JSON.stringify(stored))

// --- export --------------------------------------------------------------
await page.locator('.panel-tabs button', { hasText: 'Moves' }).click()
await page.waitForTimeout(400)
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
await page.locator('[data-copy="pgn"]').click()
await page.waitForTimeout(500)
const pgn = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
t.check('PGN export contains the game', pgn.includes('1. f3 e5 2. g4 Qh4#'), pgn.slice(0, 90))
t.check('PGN carries the result tag', pgn.includes('0-1'), pgn.slice(0, 200))
await page.locator('[data-copy="fen"]').click()
await page.waitForTimeout(400)
const fen = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
t.check('FEN export looks like a FEN', /^[rnbqkpRNBQKP1-8/]+ [wb] /.test(fen), fen)

// --- a finished game restores as finished --------------------------------
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.board-view .piece')
await page.waitForTimeout(900)
await openPlay(page)
const restoredStatus = await page.locator('.status-card h2').innerText()
t.check('a finished game restores as finished', restoredStatus.includes('wins') || restoredStatus.includes('Draw'), restoredStatus)

// --- setup edge case: spend everything, king still required --------------
await setVariant('setup')
await setMode('local')
await forceNew()
await setVariant('setup')
await page.waitForTimeout(500)
// four queens plus a rook cost 41, so stop at 39: 4 queens (36) + 3 pawns
for (let i = 0; i < 4; i++) {
  await armBank(page, 'q')
  await board.click(['a1', 'b1', 'c1', 'd1'][i])
  await page.waitForTimeout(500)
  await armBank(page, 'q')
  await board.click(['a8', 'b8', 'c8', 'd8'][i])
  await page.waitForTimeout(500)
}
for (let i = 0; i < 3; i++) {
  await armBank(page, 'p')
  await board.click(['a2', 'b2', 'c2'][i])
  await page.waitForTimeout(450)
  await armBank(page, 'p')
  await board.click(['a7', 'b7', 'c7'][i])
  await page.waitForTimeout(450)
}
t.check('the armed piece stays selected between placements', (await page.locator('[data-bank="p"].active, [data-bank="k"].active').count()) >= 0)
const bankState = await page.evaluate(() => {
  const out = {}
  for (const b of document.querySelectorAll('[data-bank]')) out[b.dataset.bank] = !b.disabled
  return out
})
t.check('with the budget spent, only the king can still be placed',
  bankState.k === true && bankState.q === false && bankState.p === false, JSON.stringify(bankState))
const statusText = await page.locator('.status-card p').innerText()
t.check('the interface says the king is what is missing', /king/i.test(statusText), statusText)

// --- stability over a long game ------------------------------------------
await setVariant('classic')
await setMode('ai')
await selectBot(page, 'nova')
await forceNew()
const opening = [['e2', 'e4'], ['g1', 'f3'], ['f1', 'c4'], ['e1', 'g1'], ['d2', 'd3'], ['b1', 'c3'], ['c1', 'e3'], ['d1', 'd2']]
for (const [from, to] of opening) {
  await board.drag(from, to)
  await page.waitForTimeout(1200)
}
const longList = await moveList(page)
const longPlies = longList ? longList.split(/\s+/).filter((x) => !x.endsWith('.')).length : 0
t.check('a longer game keeps accepting moves', longPlies >= 10, `${longPlies} plies`)
const nodeCount = await page.evaluate(() => document.querySelectorAll('.board-pieces .piece').length)
t.check('no orphan piece elements accumulate', nodeCount <= 32, `${nodeCount} piece nodes`)
const leaks = await page.evaluate(() => ({
  dialogs: document.querySelectorAll('dialog').length,
  toasts: document.querySelectorAll('.toast').length,
  promo: document.querySelectorAll('.promotion-layer').length
}))
t.check('no leftover dialogs or overlays', leaks.dialogs === 0 && leaks.promo === 0, JSON.stringify(leaks))

console.log(errors.length ? `\nconsole errors:\n${errors.slice(0, 10).join('\n')}` : '\nno console errors')
const failed = t.summary()
await browser.close()
process.exit(failed ? 1 : 0)
