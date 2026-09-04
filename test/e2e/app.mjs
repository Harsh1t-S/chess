// Application-level QA: variants, engine play, clocks, settings, resign,
// two-player flows, mobile, accessibility and race conditions.
import { openApp, makeBoard, reporter, moveList, openPlay, isFlipped, selectBot, selectTimeControl } from './lib.mjs'

const { browser, page, errors } = await openApp()
const board = makeBoard(page)
const t = reporter('app')

const setMode = async (mode) => { await openPlay(page); await page.locator(`[data-mode="${mode}"]`).click(); await page.waitForTimeout(700) }
const setVariant = async (v) => { await openPlay(page); await page.locator(`[data-variant="${v}"]`).click(); await page.waitForTimeout(900) }
const setLevel = (id) => selectBot(page, id)
const dismissModal = async () => { await page.locator('.fc-modal [data-close]').first().click().catch(() => {}); await page.waitForTimeout(250) }
// "New" now asks before discarding a game, so tests must answer it.
const forceNewGame = async () => {
  await openPlay(page)
  await page.locator('#action-new').click()
  await page.waitForTimeout(400)
  if (await page.locator('.confirm-card').isVisible().catch(() => false)) {
    await page.locator('.confirm-card [data-close="yes"]').click()
  }
  await page.waitForTimeout(600)
  await dismissModal()
}

// --- engine actually replies -------------------------------------------
await setMode('ai')
await setLevel('nova')
await board.drag('e2', 'e4')
await page.waitForTimeout(3500)
const afterFirst = await moveList(page)
t.check('engine answers the first move', afterFirst.split(' ').length >= 3, afterFirst)
t.check('eval bar shows a number', /\d/.test(await page.locator('#eval-text').innerText()))

// --- the human must not be able to move on the engine's turn -----------
await setLevel('forge')
await forceNewGame()
await board.drag('e2', 'e4')
await page.waitForTimeout(300)
// engine is still searching here: every one of these is black's or a re-move
for (const [from, to] of [['d2', 'd4'], ['e4', 'e5'], ['g1', 'f3']]) await board.drag(from, to)
const duringSearch = await moveList(page)
const duringPlies = duringSearch ? duringSearch.split(/\s+/).filter((x) => !x.endsWith('.')).length : 0
t.check('board is locked while the engine searches', duringPlies === 1, `${duringPlies} plies: ${duringSearch}`)
await page.waitForTimeout(5000)
const afterSearch = await moveList(page)
t.check('queued clicks did not fire once the engine replied', afterSearch.split(/\s+/).filter((x) => !x.endsWith('.')).length === 2, afterSearch)
await setLevel('nova')

// --- resign -------------------------------------------------------------
await openPlay(page)
await page.locator('#action-resign').click()
await page.waitForTimeout(400)
t.check('resign asks for confirmation', await page.locator('.confirm-card').isVisible().catch(() => false))
await page.locator('.confirm-card [data-close="yes"]').click()
await page.waitForTimeout(600)
const resignTitle = await page.locator('.result-title').innerText().catch(() => '')
t.check('resigning loses the game', resignTitle === 'You lost', resignTitle)
t.check('resignation is named as the reason', (await page.locator('.result-reason').innerText().catch(() => '')).includes('resignation'))
await dismissModal()

// --- draw offer ---------------------------------------------------------
await forceNewGame()
await page.locator('#action-draw').click()
await page.waitForTimeout(900)
const drawEnded = await page.locator('.result-card').isVisible().catch(() => false)
const toastText = await page.locator('.toast').first().innerText().catch(() => '')
t.check('draw offer from an equal start is accepted or declined with a reason', drawEnded || toastText.length > 0, toastText)
if (drawEnded) await dismissModal()

// --- clocks -------------------------------------------------------------
await openPlay(page)
await selectTimeControl(page, 'bullet1')
const clocks = await page.locator('.clock').count()
t.check('clocks appear for a timed game', clocks === 2, `${clocks} clocks`)
const readClocks = () => page.evaluate(() => ({
  top: document.querySelector('#player-top .clock')?.textContent,
  bottom: document.querySelector('#player-bottom .clock')?.textContent
}))
const startClocks = await readClocks()
await board.drag('e2', 'e4')
await page.waitForTimeout(3000)
const laterClocks = await readClocks()
t.check('the mover\'s clock counts down', startClocks.bottom !== laterClocks.bottom, `${startClocks.bottom} -> ${laterClocks.bottom}`)
t.check('the idle clock does not', startClocks.top === laterClocks.top, `${startClocks.top} -> ${laterClocks.top}`)
await selectTimeControl(page, 'unlimited')
t.check('unlimited hides the clocks', (await page.locator('.clock').count()) === 0)

// --- setup chess --------------------------------------------------------
await setVariant('setup')
t.check('setup shows the piece bank', (await page.locator('[data-bank]').count()) === 6)
t.check('setup shows prebuilt armies', (await page.locator('[data-template]').count()) === 10)
await page.locator('[data-bank="q"]').click()
await page.waitForTimeout(250)
const queenTargets = await page.locator('.square.target').count()
t.check('choosing a queen highlights legal placement squares', queenTargets > 0, `${queenTargets}`)
await board.click('d1')
await page.waitForTimeout(700)
t.check('queen placed on d1', (await board.pieceAt('d1')) === 'wq')
const budget = await page.locator('.budget-line strong').innerText()
t.check('budget drops by nine after a queen', budget.startsWith('30'), budget)
await page.locator('#action-undo').click()
await page.waitForTimeout(600)
t.check('undo removes the placement', (await board.pieceAt('d1')) === null)
await page.locator('[data-template="classic"]').click()
await page.waitForTimeout(6000)
const setupStatus = await page.locator('.status-card h2').innerText()
t.check('a prebuilt army completes the setup phase', !setupStatus.includes('place'), setupStatus)
t.check('the game has pieces on the board after setup', (await page.locator('.piece').count()) > 20)

// --- setup chess in two-player mode -------------------------------------
await setVariant('setup')
await setMode('local')
await page.waitForTimeout(600)
await page.locator('[data-template="cavalry"]').click()
await page.waitForTimeout(1200)
const localTemplatePlaced = await page.locator('.piece').count()
t.check('prebuilt armies work in two-player setup too', localTemplatePlaced > 0, `${localTemplatePlaced} pieces placed`)

// --- fog of war ---------------------------------------------------------
await setMode('ai')
await setVariant('fog')
const fogged = await page.locator('.square.fogged').count()
t.check('fog hides half the board at the start', fogged === 32, `${fogged} fogged`)
await board.click('e2')
await page.waitForTimeout(200)
t.check('own pieces are selectable through the fog', (await page.locator('.square.target').count()) > 0)
await board.drag('e2', 'e4')
await page.waitForTimeout(3500)
// the opponent's reply is invisible by design, so check the turn came back
const fogStatus = await page.locator('.status-card h2').innerText()
t.check('fog engine replies and hands the turn back', fogStatus.includes('White'), fogStatus)
t.check('fog keeps the opponent hidden', (await page.locator('.square.fogged').count()) > 20, `${await page.locator('.square.fogged').count()} fogged`)
t.check('draw offer is disabled in fog', await page.locator('#action-draw').isDisabled())

// --- fog two-player handoff ---------------------------------------------
await setMode('local')
await page.waitForTimeout(700)
t.check('two-player fog starts behind a handoff veil', await page.locator('#fog-handoff').isVisible())
await page.locator('#fog-handoff').click()
await page.waitForTimeout(400)
t.check('tapping the veil reveals the board', !(await page.locator('#fog-handoff').isVisible()))
await board.drag('e2', 'e4')
await page.waitForTimeout(600)
t.check('veil returns after a move', await page.locator('#fog-handoff').isVisible())

// --- hint ----------------------------------------------------------------
await setMode('ai')
await setVariant('classic')
await page.waitForTimeout(500)
await page.locator('#action-hint').click()
await page.waitForTimeout(4000)
t.check('hint draws a suggestion arrow', (await page.locator('.board-arrows .hint-arrow').count()) === 1)
await board.drag('e2', 'e4')
await page.waitForTimeout(2500)
t.check('hint clears once a move is played', (await page.locator('.board-arrows .hint-arrow').count()) === 0)

// --- new game confirmation -----------------------------------------------
await page.locator('#action-new').click()
await page.waitForTimeout(400)
t.check('starting a new game mid-play asks first', await page.locator('.confirm-card').isVisible().catch(() => false))
await page.locator('.confirm-card [data-close="no"]').click()
await page.waitForTimeout(300)
t.check('declining keeps the game', (await moveList(page)).includes('e4'))
await openPlay(page)
await page.locator('#action-new').click()
await page.waitForTimeout(400)
await page.locator('.confirm-card [data-close="yes"]').click()
await page.waitForTimeout(700)
t.check('confirming starts a fresh game', !(await moveList(page)).includes('e4'))
await openPlay(page)

// --- auto-flip in two-player ---------------------------------------------
await setMode('local')
const orientationBefore = await isFlipped(page)
await board.drag('e2', 'e4')
await page.waitForTimeout(800)
const orientationAfter = await isFlipped(page)
t.check('board turns to face the player on move', orientationBefore !== orientationAfter, `flipped ${orientationBefore} -> ${orientationAfter}`)
await board.drag('e7', 'e5')
await page.waitForTimeout(800)
t.check('and turns back for the reply', (await isFlipped(page)) === orientationBefore)
await setMode('ai')

// --- settings persistence ------------------------------------------------
await setMode('ai')
await setVariant('classic')
await page.locator('#open-settings').click()
await page.waitForTimeout(400)
await page.locator('[data-board-theme="walnut"]').click()
await page.locator('[data-piece-theme="wood"]').click()
await page.locator('#set-sound').click()
await page.waitForTimeout(300)
await page.locator('.settings-card [data-close="done"]').click()
await page.waitForTimeout(300)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.board-view .piece')
await page.waitForTimeout(900)
const bg = await page.locator('.board-view').evaluate((el) => getComputedStyle(el).backgroundImage)
t.check('board theme survives a reload', bg.includes('walnut'), bg.slice(0, 60))
const pieceSrc = await page.locator('.piece img').first().getAttribute('src')
t.check('piece theme survives a reload', (pieceSrc || '').includes('/wood/'), pieceSrc)
await page.locator('#open-settings').click()
await page.waitForTimeout(400)
t.check('sound toggle survives a reload', !(await page.locator('#set-sound').isChecked()))
await page.locator('.settings-card [data-close="done"]').click()
await page.waitForTimeout(300)

// --- accessibility -------------------------------------------------------
const a11y = await page.evaluate(() => {
  const square = document.querySelector('.square')
  const piece = document.querySelector('.piece')
  return {
    boardRole: document.querySelector('.board-view')?.getAttribute('role'),
    squareLabel: square?.getAttribute('aria-label'),
    squareTag: square?.tagName,
    pieceLabel: piece?.getAttribute('aria-label'),
    statusLive: document.querySelector('.status-card')?.getAttribute('aria-live'),
    focusable: [...document.querySelectorAll('.square')].some((el) => el.tabIndex >= 0)
  }
})
t.check('board exposes a grid role', !!a11y.boardRole, JSON.stringify(a11y))
t.check('squares carry an accessible name', !!a11y.squareLabel, JSON.stringify(a11y))
t.check('status is announced to screen readers', !!a11y.statusLive, JSON.stringify(a11y))
t.check('board is reachable by keyboard', a11y.focusable, JSON.stringify(a11y))

// --- keyboard play --------------------------------------------------------
await setMode('local')
await setVariant('classic')
await page.waitForTimeout(600)
await page.locator('.square[data-square="e2"]').focus()
await page.keyboard.press('Enter')
await page.waitForTimeout(250)
t.check('Enter selects the focused square', (await board.classes('e2')).includes('selected'))
await page.keyboard.press('ArrowUp')
await page.keyboard.press('ArrowUp')
await page.keyboard.press('Enter')
await page.waitForTimeout(500)
t.check('arrows plus Enter play a move', (await board.pieceAt('e4')) === 'wp', await board.pieceAt('e4'))
t.check('arrow keys inside the board do not scrub history', (await moveList(page)).includes('e4'))

// --- the whole play panel must be reachable -------------------------------
await openPlay(page)
const reach = await page.evaluate(() => {
  const scroll = document.querySelector('.panel-scroll')
  return {
    clipped: scroll.scrollHeight > scroll.clientHeight + 1,
    scrollable: (() => { const before = scroll.scrollTop; scroll.scrollTop = 9999; const moved = scroll.scrollTop > before; scroll.scrollTop = before; return moved })(),
    startVisible: !!document.querySelector('#panel-new')
  }
})
t.check('the start button exists in the play panel', reach.startVisible)
t.check('play panel content is either fully visible or actually scrollable',
  !reach.clipped || reach.scrollable, JSON.stringify(reach))

// --- mobile --------------------------------------------------------------
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(700)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
t.check('no horizontal overflow on a phone', overflow === 0, `${overflow}px`)
const boardBox = await page.locator('.board-view').boundingBox()
t.check('board fits the phone width', boardBox.width <= 390 && boardBox.width > 300, `${Math.round(boardBox.width)}px`)
t.check('board stays square on mobile', Math.abs(boardBox.width - boardBox.height) < 2, `${Math.round(boardBox.width)}x${Math.round(boardBox.height)}`)

console.log(errors.length ? `\nconsole errors:\n${errors.slice(0, 10).join('\n')}` : '\nno console errors')
const failed = t.summary()
await browser.close()
process.exit(failed ? 1 : 0)
