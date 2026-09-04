// Rules-level QA in the real UI: promotion, en passant, castling, draws,
// history navigation, undo, persistence.
import { openApp, makeBoard, reporter, moveList, openPlay } from './lib.mjs'

const { browser, page, errors } = await openApp()
const board = makeBoard(page)
const t = reporter('rules')

const setLocal = async () => { await openPlay(page); await page.locator('[data-mode="local"]').click(); await page.waitForTimeout(600) }
const setVariant = async (v) => { await openPlay(page); await page.locator(`[data-variant="${v}"]`).click(); await page.waitForTimeout(800) }

// --- castling -----------------------------------------------------------
await setLocal()
for (const [from, to] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'c4'], ['f8', 'c5']]) await board.move(from, to)
await board.click('e1')
const castleTargets = await page.locator('.square.target, .square.target-capture').count()
t.check('castling target offered from e1', (await board.classes('g1')).includes('target'), `targets ${castleTargets}`)
await board.click('g1')
await page.waitForTimeout(300)
t.check('king landed on g1', (await board.pieceAt('g1')) === 'wk')
t.check('rook jumped to f1', (await board.pieceAt('f1')) === 'wr')
t.check('h1 is empty after castling', (await board.pieceAt('h1')) === null)
t.check('castling recorded as O-O', (await moveList(page)).includes('O-O'))

// --- en passant ---------------------------------------------------------
await setLocal()
for (const [from, to] of [['e2', 'e4'], ['a7', 'a6'], ['e4', 'e5'], ['d7', 'd5']]) await board.move(from, to)
await board.click('e5')
t.check('en passant square is a legal target', (await board.classes('d6')).includes('target-capture') || (await board.classes('d6')).includes('target'))
await board.click('d6')
await page.waitForTimeout(300)
t.check('pawn moved to d6', (await board.pieceAt('d6')) === 'wp')
t.check('captured pawn removed from d5', (await board.pieceAt('d5')) === null)
t.check('en passant recorded', (await moveList(page)).includes('exd6'))

// --- promotion ----------------------------------------------------------
await setLocal()
// 1.h4 g5 2.hxg5 a6 3.g6 a5 4.gxh7 a4 — leaves the knight on g8 to capture into a promotion
const promoLine = [['h2', 'h4'], ['g7', 'g5'], ['h4', 'g5'], ['a7', 'a6'], ['g5', 'g6'], ['a6', 'a5'], ['g6', 'h7'], ['a5', 'a4']]
for (const [from, to] of promoLine) await board.move(from, to)
await board.click('h7')
await board.click('g8')
await page.waitForTimeout(400)
t.check('promotion picker appears', await page.locator('.promotion-choices').isVisible().catch(() => false))
const choices = await page.locator('.promotion-choice').count()
t.check('picker offers four pieces', choices === 4, `got ${choices}`)
await page.locator('.promotion-choice[data-piece="n"]').click()
await page.waitForTimeout(400)
t.check('promoted to the chosen knight, not a queen', (await board.pieceAt('g8')) === 'wn', await board.pieceAt('g8'))
t.check('promotion recorded as =N', (await moveList(page)).includes('=N'))

// cancelling promotion must leave the position untouched
await setLocal()
for (const [from, to] of promoLine) await board.move(from, to)
await board.click('h7')
await board.click('g8')
await page.waitForTimeout(350)
await page.locator('.promotion-cancel').click()
await page.waitForTimeout(300)
t.check('cancelling promotion leaves the pawn on h7', (await board.pieceAt('h7')) === 'wp')
t.check('cancelling promotion adds no move', !(await moveList(page)).includes('=') )

// --- history navigation and undo ---------------------------------------
await setLocal()
for (const [from, to] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6']]) await board.move(from, to)
await page.keyboard.press('ArrowLeft')
await page.keyboard.press('ArrowLeft')
await page.waitForTimeout(300)
t.check('arrow keys step back through history', (await board.pieceAt('f3')) === null && (await board.pieceAt('g1')) === 'wn')
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(250)
t.check('arrow right steps forward', (await board.pieceAt('f3')) === 'wn')
await page.locator('#action-last').click()
await page.waitForTimeout(250)
t.check('last-move button returns to the live position', (await board.pieceAt('c6')) === 'bn')
await page.locator('#action-undo').click()
await page.waitForTimeout(300)
t.check('undo removes the last move', (await board.pieceAt('c6')) === null)
t.check('move list shrank after undo', !(await moveList(page)).includes('Nc6'))

// --- moving while browsing history --------------------------------------
await openPlay(page)
await page.locator('#action-first').click()
await page.waitForTimeout(250)
const beforeBrowse = await moveList(page)
await openPlay(page)
await board.drag('d2', 'd4')
await page.waitForTimeout(400)
t.check('cannot move while browsing an earlier position', (await moveList(page)) === beforeBrowse, 'a move was accepted mid-history')

// --- persistence across reload ------------------------------------------
await page.locator('#action-last').click()
await page.waitForTimeout(200)
const beforeReload = await moveList(page)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.board-view .piece')
await page.waitForTimeout(900)
t.check('game survives a reload', (await moveList(page)) === beforeReload, `${beforeReload} -> ${await moveList(page)}`)

// --- threefold repetition ------------------------------------------------
await setLocal()
const shuffle = [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']]
let repetitionPlies = 0
outer: for (let round = 0; round < 3; round++) {
  for (const [from, to] of shuffle) {
    await board.move(from, to)
    repetitionPlies++
    // stop the moment the game ends, otherwise further clicks land on the
    // result modal's backdrop and dismiss it
    if (await page.locator('.result-card').isVisible().catch(() => false)) break outer
  }
}
await page.waitForTimeout(500)
const repTitle = await page.locator('.result-title').innerText().catch(() => '')
const repReason = await page.locator('.result-reason').innerText().catch(() => '')
t.check('threefold repetition ends the game as a draw', repTitle === 'Draw', `${repTitle} / ${repReason}`)
t.check('repetition fires on the third occurrence, not later', repetitionPlies === 8, `ended after ${repetitionPlies} plies`)
t.check('repetition is named as the reason', repReason.toLowerCase().includes('repetition'), repReason)
await page.locator('.result-dismiss').click().catch(() => {})

console.log(errors.length ? `\nconsole errors:\n${errors.slice(0, 8).join('\n')}` : '\nno console errors')
const failed = t.summary()
await browser.close()
process.exit(failed ? 1 : 0)
