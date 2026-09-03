import './styles/index.css'
import { Game } from './core/game.js'
import { SetupGame, ARMY_TEMPLATES, COST, PIECE_NAMES, BUDGET, randomTemplate } from './core/setup.js'
import { FogGame, chooseFogMove } from './core/fog.js'
import { START_FEN, squareName } from './engine/board.js'
import { LEVELS, LEVEL_ORDER, DEFAULT_LEVEL, getLevel, TIME_CONTROLS, TIME_CONTROL_ORDER, getTimeControl } from './engine/levels.js'
import { BoardView } from './ui/board.js'
import { BOARD_THEMES, PIECE_THEMES, DEFAULT_BOARD_THEME, DEFAULT_PIECE_THEME, applyBoardTheme, preloadPieces, pieceUrl, PIECE_GLYPHS } from './ui/themes.js'
import { sounds, playForMove, setSoundEnabled, setVolume, unlockAudio } from './ui/sounds.js'
import { openModal, promptPromotion, showResult, toast } from './ui/modals.js'
import { renderReview } from './ui/review.js'
import { getBias, recordGame, stats as learningStats, resetLearning, listGames } from './learn/store.js'
import { pullBook, flush, globalStats, isOnline } from './learn/sync.js'
import { APP_VERSION } from './config.js'

const SETTINGS_KEY = 'forgechess:settings:v2'
const GAME_KEY = 'forgechess:game:v2'
const VARIANTS = {
  classic: { id: 'classic', name: 'Classic', blurb: 'Standard chess against a learning engine.' },
  setup: { id: 'setup', name: 'Setup Chess', blurb: 'Spend 39 points building your own army.' },
  fog: { id: 'fog', name: 'Fog of War', blurb: 'You only see what your pieces can reach.' }
}
const colorName = (color) => (color === 'w' ? 'White' : 'Black')
const other = (color) => (color === 'w' ? 'b' : 'w')

// --- persisted settings ------------------------------------------------------
const defaults = {
  variant: 'classic',
  mode: 'ai',
  level: DEFAULT_LEVEL,
  side: 'w',
  timeControl: 'unlimited',
  boardTheme: DEFAULT_BOARD_THEME,
  pieceTheme: DEFAULT_PIECE_THEME,
  sound: true,
  volume: 0.5,
  showEval: true,
  showHints: true,
  learning: true,
  cloudSync: true
}
const settings = { ...defaults, ...readJson(SETTINGS_KEY, {}) }

function readJson (key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback } catch { return fallback }
}
function writeJson (key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode */ }
}
const saveSettings = () => writeJson(SETTINGS_KEY, settings)

// --- app state ---------------------------------------------------------------
const state = {
  phase: 'idle',            // 'setup' | 'play' | 'over'
  humanSide: 'w',
  flipped: false,
  panel: 'play',
  selected: null,
  selectedBankPiece: null,
  viewPly: null,
  thinking: false,
  engineInfo: { depth: 0, score: 0, nodes: 0, pv: [] },
  evalScore: 0,
  clocks: { w: 0, b: 0 },
  clockRunning: false,
  lastTick: 0,
  result: null,
  review: null,
  fogHandoff: false,
  engineTemplate: randomTemplate(),
  humanTemplate: null,
  reviewContext: null,
  pendingBias: null
}

let game = null
let setup = new SetupGame()
let fog = new FogGame()
let board = null
let worker = null
let job = 0
let engineTimer = null
let clockTimer = null

// --- shell -------------------------------------------------------------------
document.querySelector('#app').innerHTML = `
<div class="app">
  <aside class="rail">
    <button class="rail-logo" data-nav="play"><span class="rail-mark">♞</span><span class="rail-word">ForgeChess</span></button>
    <nav class="rail-nav">
      <button class="rail-item active" data-nav="play"><span>♟</span><small>Play</small></button>
      <button class="rail-item" data-nav="moves"><span>≡</span><small>Moves</small></button>
      <button class="rail-item" data-nav="review"><span>◔</span><small>Review</small></button>
      <button class="rail-item" data-nav="learning"><span>◈</span><small>Learning</small></button>
    </nav>
    <div class="rail-foot">
      <button class="rail-item" id="open-settings"><span>⚙</span><small>Settings</small></button>
      <span class="rail-version">v${APP_VERSION}</span>
    </div>
  </aside>

  <header class="topbar">
    <button class="topbar-brand" data-nav="play"><span>♞</span><strong>ForgeChess</strong></button>
    <div class="topbar-actions">
      <button id="topbar-settings" aria-label="Settings">⚙</button>
    </div>
  </header>

  <main class="stage">
    <section class="board-column">
      <div class="player-bar" id="player-top"></div>
      <div class="board-frame">
        <div class="eval-bar" id="eval-bar"><div class="eval-fill" id="eval-fill"></div><span class="eval-text" id="eval-text">0.0</span></div>
        <div class="board-holder">
          <div id="board"></div>
          <button class="board-veil" id="fog-handoff" hidden>
            <span class="veil-kicker">Fog of War</span>
            <strong id="veil-title">Pass the device</strong>
            <small>Tap when you are ready to see your view</small>
          </button>
        </div>
      </div>
      <div class="player-bar" id="player-bottom"></div>
      <div class="board-actions">
        <button id="action-first" title="First move">⏮</button>
        <button id="action-prev" title="Previous move">◀</button>
        <button id="action-next" title="Next move">▶</button>
        <button id="action-last" title="Latest move">⏭</button>
        <span class="board-actions-gap"></span>
        <button id="action-undo" title="Take back">↶</button>
        <button id="action-flip" title="Flip board">⇅</button>
        <button id="action-draw" title="Offer a draw">½</button>
        <button id="action-resign" title="Resign">⚑</button>
        <button id="action-new" class="accent" title="New game">New</button>
      </div>
    </section>

    <aside class="side-panel">
      <div class="panel-tabs">
        <button class="active" data-nav="play">Play</button>
        <button data-nav="moves">Moves</button>
        <button data-nav="review">Review</button>
        <button data-nav="learning">Learning</button>
      </div>
      <div class="panel-body" id="panel-body"></div>
    </aside>
  </main>
</div>`

const $ = (selector) => document.querySelector(selector)
const panelBody = $('#panel-body')

// --- engine worker -----------------------------------------------------------
function startWorker () {
  worker = new Worker(new URL('./engine/engine.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = (event) => handleWorkerMessage(event.data || {})
  worker.onerror = () => { state.thinking = false; render() }
}

function handleWorkerMessage (message) {
  if (message.job && message.job !== job && message.type !== 'review' && message.type !== 'review-progress') return
  if (message.type === 'progress') {
    state.engineInfo = { depth: message.depth, score: message.score, nodes: message.nodes, pv: message.pv || [] }
    if (settings.showEval) setEvalFromEngine(message.score)
    renderStatusOnly()
    return
  }
  if (message.type === 'move') {
    state.thinking = false
    state.engineInfo = { depth: message.depth, score: message.score, nodes: message.nodes, pv: message.pv || [] }
    if (settings.showEval) setEvalFromEngine(message.score)
    applyEngineMove(message.move)
    return
  }
  if (message.type === 'analysis') {
    if (settings.showEval) setEvalFromEngine(message.score)
    renderStatusOnly()
    return
  }
  if (message.type === 'review') { finishReview(message); return }
  if (message.type === 'error') { state.thinking = false; toast('Engine hiccup — try again', 'warn'); render() }
}

function setEvalFromEngine (score) {
  const turn = game ? game.turn : 'w'
  state.evalScore = turn === 'w' ? score : -score
}

// --- lifecycle ---------------------------------------------------------------
function newGame (options = {}) {
  clearTimeout(engineTimer)
  job++
  worker.postMessage({ type: 'reset' })
  Object.assign(settings, options)
  saveSettings()

  state.humanSide = settings.side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : settings.side
  state.flipped = settings.mode === 'ai' ? state.humanSide === 'b' : false
  state.selected = null
  state.selectedBankPiece = null
  state.viewPly = null
  state.thinking = false
  state.engineInfo = { depth: 0, score: 0, nodes: 0, pv: [] }
  state.evalScore = 0
  state.result = null
  state.review = null
  state.engineTemplate = randomTemplate()
  state.humanTemplate = null
  state.reviewContext = null
  state.pendingBias = null

  const control = getTimeControl(settings.timeControl)
  state.clocks = { w: control.initial * 1000, b: control.initial * 1000 }
  state.clockRunning = false

  if (settings.variant === 'fog') {
    fog = new FogGame()
    game = null
    setup = new SetupGame()
    state.phase = 'play'
    state.fogHandoff = settings.mode === 'local'
  } else if (settings.variant === 'setup') {
    setup = new SetupGame()
    game = null
    state.phase = 'setup'
    state.fogHandoff = false
  } else {
    game = new Game(START_FEN, 'classic')
    setup = new SetupGame()
    state.phase = 'play'
    state.fogHandoff = false
  }

  state.panel = 'play'
  primeBook()
  render()
  persistGame()
  if (settings.variant !== 'setup') startClocks()
  scheduleEngine()
}

function primeBook () {
  if (!settings.cloudSync) return
  pullBook(settings.variant).then((merged) => {
    if (merged > 0) renderPanel()
  }).catch(() => {})
}

function startPlayPhase () {
  game = new Game(setup.fen(), 'setup')
  state.phase = 'play'
  state.selectedBankPiece = null
  state.selected = null
  sounds.select()
  toast(`${colorName(setup.firstMover)} moves first`)
  render()
  persistGame()
  startClocks()
  scheduleEngine()
}

function scheduleEngine () {
  clearTimeout(engineTimer)
  if (state.result) return
  if (settings.mode !== 'ai') { maybeAnalyse(); return }

  if (settings.variant === 'setup' && state.phase === 'setup') {
    if (setup.complete() || setup.turn === state.humanSide) return
    state.thinking = true
    renderStatusOnly()
    engineTimer = setTimeout(() => {
      const move = setup.nextEngineMove(setup.turn, state.engineTemplate)
      state.thinking = false
      if (move) {
        setup.place(setup.turn, move.type, move.square)
        sounds.select()
      }
      if (setup.complete()) startPlayPhase()
      else { autoPlaceFromTemplate(); if (!setup.complete()) { render(); scheduleEngine() } }
    }, 260)
    return
  }

  if (settings.variant === 'fog') {
    if (fog.winner || fog.turn === state.humanSide) return
    state.thinking = true
    renderStatusOnly()
    const level = getLevel(settings.level)
    engineTimer = setTimeout(() => {
      const move = chooseFogMove(fog, fog.turn, level.fog)
      state.thinking = false
      if (move) {
        fog.move(move.from, move.to, move.promotion || 'q')
        playForMove({ captured: move.captured, castle: move.special && move.special.startsWith('castle') ? 'k' : null })
      }
      checkFogEnd()
      render()
      persistGame()
    }, Math.max(220, 800 - level.fog * 110))
    return
  }

  if (state.phase !== 'play' || !game || game.turn === state.humanSide) { maybeAnalyse(); return }
  requestEngineMove()
}

async function requestEngineMove () {
  if (!game || state.result) return
  const level = getLevel(settings.level)
  state.thinking = true
  state.viewPly = null
  renderStatusOnly()
  job++
  const currentJob = job
  let bias = null
  if (settings.learning) {
    try { bias = await getBias(settings.variant, game.positionKey()) } catch { bias = null }
  }
  if (currentJob !== job || !game) return
  state.pendingBias = bias && Object.keys(bias).length ? bias : null
  worker.postMessage({
    type: 'search',
    job: currentJob,
    fen: game.startFen,
    history: game.uciHistory(),
    depth: level.depth,
    movetime: adjustedMovetime(level),
    skill: level.skill,
    rootBias: bias
  })
}

// Blitz games must not have the engine burning ten seconds a move.
function adjustedMovetime (level) {
  const control = getTimeControl(settings.timeControl)
  if (!control.initial) return level.movetime
  const engineColor = other(state.humanSide)
  const remaining = state.clocks[engineColor]
  const budget = Math.max(120, Math.min(level.movetime, remaining / 26 + control.increment * 700))
  return Math.round(budget)
}

function maybeAnalyse () {
  if (!settings.showEval || !game || state.result || state.phase !== 'play') return
  job++
  worker.postMessage({
    type: 'analysis',
    job,
    fen: game.startFen,
    history: game.uciHistory(),
    depth: 10,
    movetime: 420
  })
}

function applyEngineMove (uci) {
  if (!uci || !game) { render(); return }
  const move = game.play(uci)
  if (!move) { render(); return }
  afterMove(move)
}

// --- moves -------------------------------------------------------------------
async function attemptMove (from, to) {
  if (!game || state.result || state.viewPly !== null) return false
  if (settings.mode === 'ai' && game.turn !== state.humanSide) return false
  const targets = game.legalTargets(from)
  const target = targets.find((entry) => entry.to === to)
  if (!target) return false
  let promotion = 'q'
  if (game.needsPromotion(from, to)) {
    const choice = await promptPromotion(game.turn, to, $('#board'), settings.pieceTheme, state.flipped)
    if (!choice) { state.selected = null; render(); return false }
    promotion = choice
  }
  const move = game.play(from, to, promotion)
  if (!move) return false
  state.selected = null
  afterMove(move)
  return true
}

function afterMove (move) {
  applyIncrement(move.color)
  state.viewPly = null
  const outcome = game.outcome()
  if (outcome.over) {
    finishGame(outcome)
    playForMove(move, { over: resultTone(outcome.result) })
  } else {
    playForMove(move)
    startClocks()
  }
  render()
  persistGame()
  if (!outcome.over) scheduleEngine()
}

function resultTone (result) {
  if (result === 'draw') return 'draw'
  if (settings.mode !== 'ai') return null
  return result === state.humanSide ? 'win' : 'lose'
}

function onSquare (square) {
  unlockAudio()
  if (state.fogHandoff) return
  if (settings.variant === 'fog') { onFogSquare(square); return }
  if (state.phase === 'setup') { onSetupSquare(square); return }
  if (!game || state.result) return
  if (state.viewPly !== null && state.viewPly !== game.ply) { toast('Jump to the latest move to play'); return }

  const piece = game.pieceAt(square)
  if (state.selected && state.selected !== square) {
    const targets = game.legalTargets(state.selected)
    if (targets.some((target) => target.to === square)) { attemptMove(state.selected, square); return }
  }
  if (piece && piece[0] === game.turn && (settings.mode === 'local' || game.turn === state.humanSide)) {
    state.selected = state.selected === square ? null : square
    if (state.selected) sounds.select()
  } else {
    state.selected = null
  }
  render()
}

function onDrop (from, to) {
  if (settings.variant === 'fog') {
    const move = fog.movesFrom(from).find((entry) => entry.to === to)
    if (move) { playFogMove(move) } else { sounds.illegal() }
    state.selected = null
    render()
    return
  }
  if (state.phase === 'setup') return
  attemptMove(from, to).then((ok) => { if (!ok) { sounds.illegal(); state.selected = null; render() } })
}

function canGrab (square) {
  if (state.fogHandoff || state.result) return false
  if (settings.variant === 'fog') {
    const piece = fog.get(square)
    if (!piece || piece[0] !== fog.turn) return false
    return settings.mode === 'local' || fog.turn === state.humanSide
  }
  if (state.phase !== 'play' || !game) return false
  if (state.viewPly !== null && state.viewPly !== game.ply) return false
  const piece = game.pieceAt(square)
  if (!piece || piece[0] !== game.turn) return false
  return settings.mode === 'local' || game.turn === state.humanSide
}

// --- setup phase -------------------------------------------------------------
function onSetupSquare (square) {
  if (setup.complete()) return
  if (settings.mode === 'ai' && setup.turn !== state.humanSide) return
  if (!state.selectedBankPiece) { toast('Pick a piece from your army first'); return }
  state.humanTemplate = null
  try {
    setup.place(setup.turn, state.selectedBankPiece, square)
    sounds.move()
    if (COST[state.selectedBankPiece] > setup.remaining[setup.turn]) state.selectedBankPiece = null
    if (state.selectedBankPiece === 'k') state.selectedBankPiece = null
  } catch (error) {
    sounds.illegal()
    toast(error.message, 'warn')
    return
  }
  if (setup.complete()) { startPlayPhase(); return }
  render()
  persistGame()
  scheduleEngine()
}

// Placement alternates between the two sides, so a prebuilt army becomes a plan
// that keeps filling in whenever it is your turn again.
function applyArmyTemplate (templateId) {
  const template = ARMY_TEMPLATES.find((entry) => entry.id === templateId)
  if (!template || setup.complete()) return
  state.humanTemplate = template
  state.selectedBankPiece = null
  const placed = autoPlaceFromTemplate()
  if (!placed) { toast('Those squares are already taken', 'warn'); return }
  sounds.castle()
  if (setup.complete()) { startPlayPhase(); return }
  render()
  persistGame()
  scheduleEngine()
}

// Place as much of the chosen army as the current turn allows.
function autoPlaceFromTemplate () {
  if (!state.humanTemplate || setup.complete()) return 0
  const color = settings.mode === 'ai' ? state.humanSide : null
  if (!color) return 0
  let placed = 0
  while (setup.turn === color && !setup.complete()) {
    const next = setup.nextEngineMove(color, state.humanTemplate)
    if (!next) break
    setup.place(color, next.type, next.square)
    placed++
  }
  if (setup.complete()) { startPlayPhase(); return placed }
  return placed
}

// --- fog ---------------------------------------------------------------------
const fogViewer = () => (settings.mode === 'ai' ? state.humanSide : fog.turn)

function onFogSquare (square) {
  if (fog.winner) return
  if (settings.mode === 'ai' && fog.turn !== state.humanSide) return
  const visible = fog.visibility(fogViewer())
  if (state.selected) {
    const move = fog.movesFrom(state.selected).find((entry) => entry.to === square)
    if (move) { playFogMove(move); return }
  }
  const piece = visible.has(square) ? fog.get(square) : null
  state.selected = piece && piece[0] === fog.turn ? square : null
  if (state.selected) sounds.select()
  render()
}

function playFogMove (move) {
  fog.move(move.from, move.to, move.promotion || 'q')
  state.selected = null
  applyIncrement(move.color)
  playForMove({ captured: move.captured, castle: move.special && move.special.startsWith('castle') ? 'k' : null })
  if (checkFogEnd()) { render(); persistGame(); return }
  if (settings.mode === 'local') state.fogHandoff = true
  startClocks()
  render()
  persistGame()
  scheduleEngine()
}

function checkFogEnd () {
  if (!fog.winner) return false
  const result = fog.winner === 'draw' ? 'draw' : fog.winner
  finishGame({ over: true, result, reason: fog.winReason || 'king captured' })
  playForMove({ captured: 'k' }, { over: resultTone(result) })
  return true
}

// --- clocks ------------------------------------------------------------------
function activeColor () {
  if (settings.variant === 'fog') return fog.turn
  if (state.phase === 'setup') return null
  return game ? game.turn : null
}

function startClocks () {
  const control = getTimeControl(settings.timeControl)
  if (!control.initial || state.result) return
  state.clockRunning = true
  state.lastTick = Date.now()
  if (clockTimer) return
  clockTimer = setInterval(tickClock, 100)
}

function stopClocks () {
  state.clockRunning = false
  clearInterval(clockTimer)
  clockTimer = null
}

function applyIncrement (color) {
  const control = getTimeControl(settings.timeControl)
  if (!control.initial || !color) return
  state.clocks[color] += control.increment * 1000
}

function tickClock () {
  if (!state.clockRunning || state.result) return
  const color = activeColor()
  if (!color) return
  const now = Date.now()
  const elapsed = now - state.lastTick
  state.lastTick = now
  const before = state.clocks[color]
  state.clocks[color] = Math.max(0, before - elapsed)
  if (before > 10000 && state.clocks[color] <= 10000) sounds.lowTime()
  if (state.clocks[color] <= 0) {
    stopClocks()
    finishGame({ over: true, result: other(color), reason: 'timeout' })
    playForMove({}, { over: resultTone(other(color)) })
    render()
    return
  }
  renderClocksOnly()
}

// --- end of game -------------------------------------------------------------
function finishGame (outcome) {
  if (state.result) return
  stopClocks()
  clearTimeout(engineTimer)
  state.thinking = false
  state.result = outcome
  state.phase = 'over'
  persistGame()

  const kind = outcome.result === 'draw'
    ? 'draw'
    : settings.mode === 'ai'
      ? (outcome.result === state.humanSide ? 'win' : 'loss')
      : 'win'
  const title = outcome.result === 'draw'
    ? 'Draw'
    : settings.mode === 'ai'
      ? (outcome.result === state.humanSide ? 'You won' : 'You lost')
      : `${colorName(outcome.result)} wins`

  showResult({
    kind,
    title,
    kicker: settings.variant === 'fog' ? 'Fog of War' : VARIANTS[settings.variant].name,
    reason: outcome.result === 'draw' ? `Drawn by ${outcome.reason}` : `by ${outcome.reason}`
  }).then((action) => {
    if (action === 'rematch') newGame()
    else if (action === 'review') { state.panel = 'review'; render() }
  })

  requestReview(outcome)
}

function requestReview (outcome) {
  if (settings.variant === 'fog' || !game || !game.moves.length) return
  job++
  // Snapshot everything the review needs: the player may start a new game
  // before the worker finishes analysing this one.
  state.reviewContext = {
    variant: settings.variant,
    level: settings.level,
    mode: settings.mode,
    humanSide: state.humanSide,
    outcome,
    uci: game.uciHistory(),
    sans: game.moves.map((move) => move.san)
  }
  worker.postMessage({
    type: 'review',
    job,
    fen: game.startFen,
    moves: state.reviewContext.uci,
    depth: 11,
    movetime: 240
  })
}

async function finishReview (message) {
  const context = state.reviewContext
  if (!context) return
  const review = message.review.map((item, index) => ({ ...item, san: context.sans[index] || item.uci }))
  state.review = { review, evals: message.evals, accuracy: message.accuracy }
  const analysing = document.querySelector('.result-analysing')
  if (analysing) {
    analysing.outerHTML = `
      <div class="result-accuracy">
        <div><small>White</small><strong>${message.accuracy.w}%</strong></div>
        <span>Accuracy</span>
        <div><small>Black</small><strong>${message.accuracy.b}%</strong></div>
      </div>`
  }
  if (state.panel === 'review') renderPanel()

  if (!settings.learning) return
  const outcome = context.outcome
  const learned = await recordGame({
    variant: context.variant,
    result: outcome ? outcome.result : 'draw',
    reason: outcome ? outcome.reason : null,
    level: context.level,
    humanSide: context.humanSide,
    mode: context.mode,
    moves: context.uci,
    review,
    accuracy: message.accuracy,
    evals: message.evals
  })
  if (learned && settings.cloudSync) flush().catch(() => {})
  if (learned) toast(`Engine learned from ${learned} positions`, 'good')
  if (state.panel === 'learning') renderPanel(true)
}

// --- rendering ---------------------------------------------------------------
function pieceMap () {
  const map = new Map()
  if (settings.variant === 'fog') {
    const visible = fog.visibility(fogViewer())
    for (const [square, code] of fog.board) if (visible.has(square)) map.set(square, code)
    return map
  }
  if (state.phase === 'setup') {
    for (const [square, code] of setup.board) map.set(square, code)
    return map
  }
  if (!game) return map
  const source = state.viewPly === null ? game.board : game.boardAt(state.viewPly)
  for (let square = 0; square < 128; square++) {
    if (square & 0x88) { square += 7; continue }
    const piece = source.squares[square]
    if (!piece) continue
    map.set(squareName(square), (piece >> 3) === 0 ? 'w' + 'xpnbrqk'[piece & 7] : 'b' + 'xpnbrqk'[piece & 7])
  }
  return map
}

function boardHighlights () {
  const highlights = { selected: state.selected, targets: [], lastMove: null, check: null, fog: null, zone: null }
  if (settings.variant === 'fog') {
    highlights.fog = fog.visibility(fogViewer())
    if (state.selected && settings.showHints) {
      highlights.targets = fog.movesFrom(state.selected).map((move) => ({ to: move.to, capture: !!move.captured }))
    }
    const last = fog.history.length ? fog.history[fog.history.length - 1].move : null
    if (last && highlights.fog.has(last.to)) highlights.lastMove = { from: last.from, to: last.to }
    return highlights
  }
  if (state.phase === 'setup') {
    const color = settings.mode === 'ai' ? state.humanSide : setup.turn
    const zone = new Set()
    for (let rank = 1; rank <= 8; rank++) {
      for (const file of 'abcdefgh') {
        const inZone = color === 'w' ? rank <= 3 : rank >= 6
        if (inZone) zone.add(`${file}${rank}`)
      }
    }
    highlights.zone = zone
    if (state.selectedBankPiece && setup.turn === color) {
      highlights.targets = setup.legalSquares(color, state.selectedBankPiece).map((square) => ({ to: square, capture: false }))
    }
    return highlights
  }
  if (!game) return highlights
  const ply = state.viewPly === null ? game.ply : state.viewPly
  const shown = ply > 0 ? game.moves[ply - 1] : null
  if (shown) highlights.lastMove = { from: shown.from, to: shown.to }
  if (state.viewPly === null) {
    if (state.selected && settings.showHints) highlights.targets = game.legalTargets(state.selected)
    if (game.inCheck()) highlights.check = game.kingSquare(game.turn)
  }
  return highlights
}

let lastRenderedPly = -1
function render () {
  board.setFlipped(state.flipped)
  board.setPieceTheme(settings.pieceTheme)
  board.setInteractive(!state.fogHandoff && !state.result)

  const map = pieceMap()
  let animate = null
  if (settings.variant !== 'fog' && game && state.viewPly === null && game.ply === lastRenderedPly + 1) {
    const move = game.lastMove()
    if (move) {
      animate = { from: move.from, to: move.to }
      if (move.enPassant) animate.epSquare = `${move.to[0]}${move.color === 'w' ? Number(move.to[1]) - 1 : Number(move.to[1]) + 1}`
      if (move.castle === 'k') { animate.rookFrom = `h${move.to[1]}`; animate.rookTo = `f${move.to[1]}` }
      if (move.castle === 'q') { animate.rookFrom = `a${move.to[1]}`; animate.rookTo = `d${move.to[1]}` }
    }
  }
  lastRenderedPly = settings.variant !== 'fog' && game ? (state.viewPly === null ? game.ply : -1) : -1

  board.setPosition(map, animate)
  board.setHighlights(boardHighlights())

  renderPlayers()
  renderEval()
  renderVeil()
  renderPanel()
  document.querySelectorAll('[data-nav]').forEach((button) => {
    if (!button.dataset.nav) return
    button.classList.toggle('active', button.dataset.nav === state.panel)
  })
}

// Engine progress arrives several times a second, so patch the status card in
// place rather than rebuilding (and re-wiring) the entire panel.
function renderStatusOnly () {
  renderPlayers()
  renderEval()
  if (state.panel !== 'play') return
  const card = panelBody.querySelector('.status-card')
  if (!card) { renderPanel(); return }
  const status = statusLine()
  card.classList.toggle('thinking', state.thinking)
  card.querySelector('.status-kicker').textContent = status.kicker
  card.querySelector('h2').textContent = status.title
  card.querySelector('p').textContent = status.detail
  card.querySelector('.turn-dot').className = `turn-dot ${activeColor() === 'w' ? 'white' : 'black'}`
  const readout = panelBody.querySelector('.engine-readout')
  if (readout) {
    readout.classList.toggle('idle', !state.thinking)
    const values = readout.querySelectorAll('b')
    values[0].textContent = state.engineInfo.depth || '—'
    values[1].textContent = formatNodes(state.engineInfo.nodes)
    values[2].textContent = (state.engineInfo.pv || []).slice(0, 3).join(' ') || '—'
  }
}

function renderClocksOnly () {
  const control = getTimeControl(settings.timeControl)
  if (!control.initial) return
  for (const [id, color] of [['#player-top', state.flipped ? 'w' : 'b'], ['#player-bottom', state.flipped ? 'b' : 'w']]) {
    const node = document.querySelector(`${id} .clock`)
    if (!node) continue
    node.textContent = formatClock(state.clocks[color])
    node.classList.toggle('low', state.clocks[color] < 20000)
    node.classList.toggle('running', state.clockRunning && activeColor() === color && !state.result)
  }
}

function formatClock (ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (ms < 20000) return `${minutes}:${String(seconds).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function playerFor (color) {
  const level = getLevel(settings.level)
  const isEngine = settings.mode === 'ai' && color !== state.humanSide
  const name = settings.mode === 'local' ? colorName(color) : isEngine ? level.name : 'You'
  const rating = isEngine ? level.rating : null
  const active = activeColor() === color && !state.result
  const control = getTimeControl(settings.timeControl)

  let subtitle
  if (state.result) {
    subtitle = state.result.result === 'draw'
      ? `Draw by ${state.result.reason}`
      : state.result.result === color ? `Won by ${state.result.reason}` : `Lost by ${state.result.reason}`
  } else if (settings.variant === 'fog') {
    subtitle = isEngine ? `Blind search · ≈${level.rating}` : 'Hidden information'
  } else if (state.phase === 'setup') {
    subtitle = `${setup.remaining[color]} pts left${setup.king[color] ? '' : ' · king needed'}`
  } else if (isEngine && state.thinking) {
    subtitle = `Thinking… depth ${state.engineInfo.depth || 1}`
  } else {
    subtitle = isEngine ? level.label : active ? 'Your move' : 'Waiting'
  }

  const captured = game && state.phase !== 'setup' ? game.captured() : null
  const lost = captured ? captured.lost[other(color)] : []
  const advantage = captured ? (color === 'w' ? captured.advantage : -captured.advantage) : 0

  return `
    <div class="player-identity">
      <span class="player-avatar ${color}">${isEngine ? '🤖' : PIECE_GLYPHS[color + 'p']}</span>
      <div class="player-meta">
        <div class="player-name"><strong>${name}</strong>${rating ? `<span class="rating">${rating}</span>` : ''}</div>
        <div class="player-sub">
          <span>${subtitle}</span>
          ${lost.length ? `<span class="captured-tray">${lost.map((type) => `<i class="captured" style="background-image:url('${pieceUrl(other(color) + type, settings.pieceTheme)}')"></i>`).join('')}${advantage > 0 ? `<b>+${advantage}</b>` : ''}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="player-right">
      ${active ? '<span class="turn-pill">To move</span>' : ''}
      ${control.initial ? `<span class="clock ${state.clocks[color] < 20000 ? 'low' : ''} ${active && state.clockRunning ? 'running' : ''}">${formatClock(state.clocks[color])}</span>` : ''}
    </div>`
}

function renderPlayers () {
  const top = state.flipped ? 'w' : 'b'
  const bottom = state.flipped ? 'b' : 'w'
  $('#player-top').innerHTML = playerFor(top)
  $('#player-bottom').innerHTML = playerFor(bottom)
  $('#player-top').classList.toggle('active', activeColor() === top && !state.result)
  $('#player-bottom').classList.toggle('active', activeColor() === bottom && !state.result)
  const playable = !state.result && state.phase === 'play'
  $('#action-resign').disabled = !playable
  $('#action-draw').disabled = !playable || settings.variant === 'fog'
}

function renderEval () {
  const bar = $('#eval-bar')
  const fill = $('#eval-fill')
  const text = $('#eval-text')
  const show = settings.showEval && settings.variant !== 'fog' && state.phase !== 'setup'
  bar.classList.toggle('hidden', !show)
  if (!show) return
  const score = state.evalScore
  const clamped = Math.max(-900, Math.min(900, score))
  const percent = 50 + (clamped / 900) * 46
  fill.style.height = `${state.flipped ? 100 - percent : percent}%`
  bar.classList.toggle('flipped', state.flipped)
  bar.classList.toggle('black-ahead', score < 0)
  // The number is unsigned: which end of the bar it sits on already says who
  // is ahead, and a sign does not fit in an 18px column.
  text.textContent = Math.abs(score) > 30000
    ? `M${Math.ceil((32000 - Math.abs(score)) / 2)}`
    : (Math.abs(score) / 100).toFixed(Math.abs(score) >= 1000 ? 0 : 1)
}

function renderVeil () {
  const veil = $('#fog-handoff')
  const show = settings.variant === 'fog' && settings.mode === 'local' && state.fogHandoff && !fog.winner
  veil.hidden = !show
  if (show) $('#veil-title').textContent = `${colorName(fog.turn)} to move`
}

// --- panels ------------------------------------------------------------------
function renderPanel (force = false) {
  document.querySelectorAll('.panel-tabs button').forEach((button) => {
    button.classList.toggle('active', button.dataset.nav === state.panel)
  })
  // The learning tab reads IndexedDB and the network, so it only rebuilds when
  // it is actually opened or something it shows has changed.
  if (state.panel === 'learning' && !force && panelBody.dataset.panel === 'learning') return
  panelBody.dataset.panel = state.panel
  if (state.panel === 'moves') return renderMovesPanel()
  if (state.panel === 'review') return renderReviewPanel()
  if (state.panel === 'learning') return renderLearningPanel()
  return renderPlayPanel()
}

function renderPlayPanel () {
  const level = getLevel(settings.level)
  const inGame = state.phase !== 'idle' && !state.result

  const variantTabs = `
    <div class="segment variant-segment">
      ${Object.values(VARIANTS).map((variant) => `
        <button data-variant="${variant.id}" class="${settings.variant === variant.id ? 'active' : ''}">${variant.name}</button>`).join('')}
    </div>`

  const modeTabs = `
    <div class="segment">
      <button data-mode="ai" class="${settings.mode === 'ai' ? 'active' : ''}">Play the engine</button>
      <button data-mode="local" class="${settings.mode === 'local' ? 'active' : ''}">Two players</button>
    </div>`

  const status = statusLine()

  const engineSection = settings.mode === 'ai' ? `
    <section class="panel-section">
      <h3>Opponent</h3>
      <div class="bot-grid">
        ${LEVEL_ORDER.map((id) => {
          const bot = LEVELS[id]
          return `<button class="bot-card ${settings.level === id ? 'active' : ''}" data-level="${id}">
            <span class="bot-face tier-${LEVEL_ORDER.indexOf(id)}">${['♙', '♘', '♗', '♖', '♕', '♔'][LEVEL_ORDER.indexOf(id)]}</span>
            <span class="bot-copy"><b>${bot.name}</b><small>${bot.blurb}</small></span>
            <span class="bot-rating">${bot.rating}</span>
          </button>`
        }).join('')}
      </div>
      <div class="field-row">
        <label>Play as</label>
        <div class="segment small">
          ${[['w', 'White'], ['b', 'Black'], ['random', 'Random']].map(([value, label]) => `
            <button data-side="${value}" class="${settings.side === value ? 'active' : ''}">${label}</button>`).join('')}
        </div>
      </div>
    </section>` : ''

  const timeSection = `
    <section class="panel-section">
      <h3>Time control</h3>
      <div class="chip-row">
        ${TIME_CONTROL_ORDER.map((id) => `
          <button class="chip ${settings.timeControl === id ? 'active' : ''}" data-time="${id}">${TIME_CONTROLS[id].name}</button>`).join('')}
      </div>
    </section>`

  const setupSection = (settings.variant === 'setup' && state.phase === 'setup') ? renderSetupSection() : ''

  panelBody.innerHTML = `
    <div class="panel-scroll">
      <section class="status-card ${state.thinking ? 'thinking' : ''}">
        <div>
          <span class="status-kicker">${status.kicker}</span>
          <h2>${status.title}</h2>
          <p>${status.detail}</p>
        </div>
        <span class="turn-dot ${activeColor() === 'w' ? 'white' : 'black'}"></span>
      </section>
      ${settings.variant !== 'fog' ? `
        <div class="engine-readout ${state.thinking ? '' : 'idle'}">
          <span><small>Depth</small><b>${state.engineInfo.depth || '—'}</b></span>
          <span><small>Nodes</small><b>${formatNodes(state.engineInfo.nodes)}</b></span>
          <span><small>Line</small><b>${(state.engineInfo.pv || []).slice(0, 3).join(' ') || '—'}</b></span>
        </div>` : ''}
      ${variantTabs}
      <p class="variant-blurb">${VARIANTS[settings.variant].blurb}</p>
      ${modeTabs}
      ${setupSection}
      ${engineSection}
      ${timeSection}
      <div class="panel-cta">
        <button class="primary block" id="panel-new">${inGame ? 'Restart game' : 'Start game'}</button>
        <button class="ghost block" id="panel-rules">How the variants work</button>
      </div>
    </div>`

  wirePlayPanel()
  void level
}


function renderSetupSection () {
  const color = settings.mode === 'ai' ? state.humanSide : setup.turn
  const yourTurn = setup.turn === color
  const bank = ['q', 'r', 'b', 'n', 'p', 'k'].map((type) => {
    const available = yourTurn && setup.legalSquares(color, type).length > 0
    return `<button class="bank-piece ${state.selectedBankPiece === type ? 'active' : ''}" data-bank="${type}" ${available ? '' : 'disabled'}>
      <img src="${pieceUrl(color + type, settings.pieceTheme)}" alt="" onerror="this.replaceWith(document.createTextNode('${PIECE_GLYPHS[color + type]}'))">
      <small>${PIECE_NAMES[type]}</small>
      <b>${type === 'k' ? 'FREE' : COST[type]}</b>
    </button>`
  }).join('')

  return `
    <section class="panel-section setup-section">
      <div class="budget-line">
        <span><i class="dot ${setup.turn === 'w' ? 'white' : 'black'}"></i>${colorName(setup.turn)} placing</span>
        <strong>${setup.remaining[color]}<small> / ${BUDGET} pts</small></strong>
      </div>
      <div class="budget-track"><span style="width:${100 - (setup.remaining[color] / BUDGET) * 100}%"></span></div>
      <div class="bank">${bank}</div>
      <p class="hint">Pieces go on your first three ranks, pawns on ranks ${color === 'w' ? '2–3' : '6–7'}. The king is free but required.</p>
      <h4>Prebuilt armies</h4>
      <div class="template-grid">
        ${ARMY_TEMPLATES.map((template) => `
          <button class="template-card" data-template="${template.id}"><b>${template.name}</b><small>${template.blurb}</small></button>`).join('')}
      </div>
    </section>`
}

function statusLine () {
  if (state.result) {
    const title = state.result.result === 'draw' ? 'Draw' : `${colorName(state.result.result)} wins`
    return { kicker: 'Game over', title, detail: `by ${state.result.reason}` }
  }
  if (settings.variant === 'fog') {
    const visible = fog.visibility(fogViewer()).size
    return {
      kicker: 'Fog of War',
      title: state.thinking ? `${getLevel(settings.level).name} is groping through the fog…` : `${colorName(fog.turn)} to move`,
      detail: `${visible} of 64 squares visible · capture the king to win`
    }
  }
  if (state.phase === 'setup') {
    return {
      kicker: 'Setup phase',
      title: state.thinking ? `${getLevel(settings.level).name} is building` : `${colorName(setup.turn)} to place`,
      detail: setup.remaining[setup.turn] === 0 && !setup.king[setup.turn] ? 'Only the king is left to place' : `First army to finish moves first`
    }
  }
  if (!game) return { kicker: 'ForgeChess', title: 'Ready to play', detail: 'Pick a variant and start' }
  const check = game.inCheck() ? ' · check' : ''
  return {
    kicker: VARIANTS[settings.variant].name,
    title: state.thinking ? `${getLevel(settings.level).name} is thinking…` : `${colorName(game.turn)} to move${check}`,
    detail: state.pendingBias
      ? `Using ${Object.keys(state.pendingBias).length} learned adjustments in this position`
      : `Move ${Math.floor(game.ply / 2) + 1}`
  }
}

const formatNodes = (nodes) => (!nodes ? '—' : nodes > 999999 ? `${(nodes / 1e6).toFixed(1)}M` : nodes > 999 ? `${(nodes / 1000).toFixed(1)}k` : String(nodes))

function renderMovesPanel () {
  if (settings.variant === 'fog') {
    const viewer = fogViewer()
    const moves = fog.history.map((entry) => entry.move)
    const rows = []
    for (let i = 0; i < moves.length; i += 2) {
      const white = moves[i]
      const black = moves[i + 1]
      rows.push(`<div class="move-row"><span>${i / 2 + 1}.</span>
        <b>${white ? (viewer === 'w' ? `${white.from}${white.to}` : '···') : ''}</b>
        <b>${black ? (viewer === 'b' ? `${black.from}${black.to}` : '···') : ''}</b></div>`)
    }
    panelBody.innerHTML = `<div class="panel-scroll">
      <h3 class="panel-heading">Moves <small>${moves.length}</small></h3>
      <div class="move-list">${rows.join('') || '<p class="empty">No moves yet.</p>'}</div>
      <p class="hint">Your opponent's moves stay hidden in Fog of War.</p>
    </div>`
    return
  }
  if (!game || !game.moves.length) {
    panelBody.innerHTML = '<div class="panel-scroll"><h3 class="panel-heading">Moves</h3><p class="empty">The game starts here.</p></div>'
    return
  }
  const currentPly = state.viewPly === null ? game.ply : state.viewPly
  const rows = []
  for (let i = 0; i < game.moves.length; i += 2) {
    const white = game.moves[i]
    const black = game.moves[i + 1]
    rows.push(`<div class="move-row">
      <span>${i / 2 + 1}.</span>
      <button class="move ${currentPly === i + 1 ? 'current' : ''}" data-ply="${i + 1}">${white.san}</button>
      ${black ? `<button class="move ${currentPly === i + 2 ? 'current' : ''}" data-ply="${i + 2}">${black.san}</button>` : '<span class="move empty"></span>'}
    </div>`)
  }
  panelBody.innerHTML = `<div class="panel-scroll">
    <h3 class="panel-heading">Moves <small>${game.moves.length}</small></h3>
    <div class="move-list">${rows.join('')}</div>
    <div class="export-row">
      <button class="ghost" data-copy="fen">Copy FEN</button>
      <button class="ghost" data-copy="pgn">Copy PGN</button>
    </div>
    <code class="fen-box">${game.fen()}</code>
  </div>`
  panelBody.querySelectorAll('[data-ply]').forEach((button) => {
    button.addEventListener('click', () => gotoPly(Number(button.dataset.ply)))
  })
  panelBody.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', () => copyText(button.dataset.copy))
  })
  const current = panelBody.querySelector('.move.current')
  if (current) current.scrollIntoView({ block: 'nearest' })
}

function renderReviewPanel () {
  const container = document.createElement('div')
  container.className = 'panel-scroll review-panel'
  panelBody.innerHTML = ''
  panelBody.append(container)
  if (!state.review && state.result) {
    container.innerHTML = '<div class="review-empty"><h3>Analysing…</h3><p>The engine is checking every move for blunders. This also teaches it what to avoid next time.</p></div>'
    return
  }
  renderReview(container, state.review, { onSelectPly: gotoPly })
}

async function renderLearningPanel () {
  panelBody.innerHTML = '<div class="panel-scroll"><h3 class="panel-heading">Learning</h3><p class="empty">Loading…</p></div>'
  const [local, games] = await Promise.all([learningStats(), listGames(8)])
  if (state.panel !== 'learning') return
  const remote = null

  panelBody.innerHTML = `<div class="panel-scroll">
    <h3 class="panel-heading">Learning</h3>
    <p class="hint">After every game the engine replays its own moves at higher depth, marks the ones that lost evaluation, and biases its search away from them next time.</p>
    <div class="stat-grid">
      <div><small>Games learned from</small><strong>${local.games}</strong></div>
      <div><small>Positions in book</small><strong>${local.positions}</strong></div>
      <div><small>Moves scored</small><strong>${local.learnedMoves}</strong></div>
      <div><small>Mistakes recorded</small><strong>${local.mistakes}</strong></div>
    </div>
    <h4>Shared book</h4>
    <div class="cloud-status ${isOnline() ? 'online' : 'offline'}">
      <span class="dot"></span>
      <span class="cloud-text">${settings.cloudSync ? 'Checking the shared book…' : 'Cloud sync is off'}</span>
    </div>
    <h4>Recent games</h4>
    <div class="game-log">
      ${games.length
        ? games.map((entry) => `<div class="game-row">
            <span class="game-result ${entry.result === 'draw' ? 'draw' : entry.result === entry.humanSide ? 'win' : 'loss'}">${entry.result === 'draw' ? '½' : entry.result === entry.humanSide ? 'W' : 'L'}</span>
            <span class="game-meta"><b>${VARIANTS[entry.variant] ? VARIANTS[entry.variant].name : entry.variant}</b><small>${getLevel(entry.level).name} · ${entry.moves ? entry.moves.length : 0} plies</small></span>
            <span class="game-acc">${entry.accuracy ? `${entry.accuracy.w}% / ${entry.accuracy.b}%` : '—'}</span>
          </div>`).join('')
        : '<p class="empty">No games recorded yet.</p>'}
    </div>
    <div class="panel-cta">
      <button class="ghost block" id="sync-now">${settings.cloudSync ? 'Sync now' : 'Cloud sync disabled'}</button>
      <button class="danger block" id="reset-learning">Reset what the engine learned</button>
    </div>
  </div>`

  if (settings.cloudSync) {
    globalStats().then((stats) => {
      const node = panelBody.querySelector('.cloud-text')
      if (!node || state.panel !== 'learning') return
      node.parentElement.classList.toggle('online', !!stats)
      node.parentElement.classList.toggle('offline', !stats)
      node.textContent = stats
        ? `${stats.positions.toLocaleString()} positions · ${stats.games.toLocaleString()} games · ${stats.mistakes.toLocaleString()} mistakes shared by everyone`
        : 'Offline — learning is still saved on this device'
    }).catch(() => {})
  }
  void remote

  $('#sync-now')?.addEventListener('click', async () => {
    if (!settings.cloudSync) { toast('Turn on cloud sync in settings first', 'warn'); return }
    const pushed = await flush()
    await pullBook(settings.variant, { force: true })
    toast(pushed ? `Synced ${pushed} updates` : 'Everything already in sync', 'good')
    renderPanel(true)
  })
  $('#reset-learning')?.addEventListener('click', async () => {
    const { close } = openModal(`
      <div class="confirm-card">
        <h3>Reset learning?</h3>
        <p>This clears the local opening book, the recorded mistakes and the game archive on this device. The shared book is not affected.</p>
        <div class="confirm-actions"><button class="ghost" data-close="no">Cancel</button><button class="danger" data-close="yes">Reset</button></div>
      </div>`, { className: 'confirm-modal', onClose: async (value) => {
        if (value !== 'yes') return
        await resetLearning()
        toast('Learning reset')
        renderPanel(true)
      } })
    void close
  })
}

// --- history navigation ------------------------------------------------------
function gotoPly (ply) {
  if (!game) return
  const clamped = Math.max(0, Math.min(ply, game.ply))
  state.viewPly = clamped === game.ply ? null : clamped
  state.selected = null
  lastRenderedPly = -1
  render()
}

function stepPly (delta) {
  if (!game) return
  const current = state.viewPly === null ? game.ply : state.viewPly
  gotoPly(current + delta)
}

function undoMove () {
  if (settings.variant === 'fog') {
    if (!fog.history.length) return
    fog.undo()
    if (settings.mode === 'ai' && fog.history.length && fog.turn !== state.humanSide) fog.undo()
    state.result = null
    state.selected = null
    state.fogHandoff = settings.mode === 'local'
    render()
    persistGame()
    return
  }
  if (state.phase === 'setup') {
    setup.undo()
    if (settings.mode === 'ai' && setup.history.length && setup.turn !== state.humanSide) setup.undo()
    state.selectedBankPiece = null
    render()
    persistGame()
    return
  }
  if (!game || !game.moves.length) return
  clearTimeout(engineTimer)
  job++
  game.undo()
  if (settings.mode === 'ai' && game.moves.length && game.turn !== state.humanSide) game.undo()
  state.result = null
  state.phase = 'play'
  state.thinking = false
  state.viewPly = null
  state.selected = null
  lastRenderedPly = -1
  startClocks()
  render()
  persistGame()
  maybeAnalyse()
}

function resignGame () {
  if (state.result || state.phase === 'setup') return
  const loser = settings.mode === 'ai' ? state.humanSide : activeColor()
  if (!loser) return
  openModal(`
    <div class="confirm-card">
      <h3>Resign this game?</h3>
      <p>${settings.mode === 'ai' ? `${getLevel(settings.level).name} takes the point.` : `${colorName(other(loser))} takes the point.`}</p>
      <div class="confirm-actions"><button class="ghost" data-close="no">Keep playing</button><button class="danger" data-close="yes">Resign</button></div>
    </div>`, {
    className: 'confirm-modal',
    onClose: (value) => {
      if (value !== 'yes') return
      finishGame({ over: true, result: other(loser), reason: 'resignation' })
      playForMove({}, { over: resultTone(other(loser)) })
      render()
    }
  })
}

// The engine accepts a draw when the position really is level, and says so
// (with its evaluation) when it is not.
function offerDraw () {
  if (state.result || state.phase === 'setup') return
  if (settings.mode === 'local') {
    openModal(`
      <div class="confirm-card">
        <h3>Agree to a draw?</h3>
        <p>Both players need to agree.</p>
        <div class="confirm-actions"><button class="ghost" data-close="no">Play on</button><button class="primary" data-close="yes">Agree</button></div>
      </div>`, {
      className: 'confirm-modal',
      onClose: (value) => {
        if (value !== 'yes') return
        finishGame({ over: true, result: 'draw', reason: 'agreement' })
        playForMove({}, { over: 'draw' })
        render()
      }
    })
    return
  }
  if (settings.variant === 'fog') { toast('No draw offers in Fog of War', 'warn'); return }
  const engineView = state.humanSide === 'w' ? -state.evalScore : state.evalScore
  if (engineView <= 35) {
    toast(`${getLevel(settings.level).name} accepts the draw`, 'good')
    finishGame({ over: true, result: 'draw', reason: 'agreement' })
    playForMove({}, { over: 'draw' })
    render()
  } else {
    toast(`${getLevel(settings.level).name} declines — it is ${(engineView / 100).toFixed(1)} up`, 'warn')
  }
}

async function copyText (kind) {
  if (!game) return
  const text = kind === 'pgn'
    ? game.pgn({
        white: settings.mode === 'ai' && state.humanSide === 'w' ? 'You' : getLevel(settings.level).name,
        black: settings.mode === 'ai' && state.humanSide === 'b' ? 'You' : getLevel(settings.level).name,
        result: state.result ? (state.result.result === 'draw' ? '1/2-1/2' : state.result.result === 'w' ? '1-0' : '0-1') : '*'
      })
    : game.fen()
  try {
    await navigator.clipboard.writeText(text)
    toast(`${kind.toUpperCase()} copied`, 'good')
  } catch { toast('Copy failed', 'warn') }
}

// --- settings + rules dialogs -----------------------------------------------
function openSettings () {
  const { dialog } = openModal(`
    <div class="settings-card">
      <header><h3>Settings</h3><button data-close="x" aria-label="Close">✕</button></header>
      <section>
        <h4>Board</h4>
        <div class="theme-grid" id="board-themes">
          ${BOARD_THEMES.map((theme) => `
            <button class="theme-swatch ${settings.boardTheme === theme.id ? 'active' : ''}" data-board-theme="${theme.id}" title="${theme.name}">
              <span style="background:${theme.light}"></span><span style="background:${theme.dark}"></span>
              <small>${theme.name}</small>
            </button>`).join('')}
        </div>
      </section>
      <section>
        <h4>Pieces</h4>
        <div class="theme-grid pieces" id="piece-themes">
          ${PIECE_THEMES.map((theme) => `
            <button class="theme-piece ${settings.pieceTheme === theme.id ? 'active' : ''}" data-piece-theme="${theme.id}" title="${theme.name}">
              <img src="${pieceUrl('wn', theme.id)}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('♘'))">
              <small>${theme.name}</small>
            </button>`).join('')}
        </div>
      </section>
      <section class="toggle-list">
        <label><span>Sound effects</span><input type="checkbox" id="set-sound" ${settings.sound ? 'checked' : ''}></label>
        <label><span>Volume</span><input type="range" id="set-volume" min="0" max="100" value="${Math.round(settings.volume * 100)}"></label>
        <label><span>Evaluation bar</span><input type="checkbox" id="set-eval" ${settings.showEval ? 'checked' : ''}></label>
        <label><span>Legal move hints</span><input type="checkbox" id="set-hints" ${settings.showHints ? 'checked' : ''}></label>
        <label><span>Learn from finished games</span><input type="checkbox" id="set-learning" ${settings.learning ? 'checked' : ''}></label>
        <label><span>Share learning with the cloud book</span><input type="checkbox" id="set-sync" ${settings.cloudSync ? 'checked' : ''}></label>
      </section>
      <footer><button class="primary" data-close="done">Done</button></footer>
    </div>`, { className: 'settings-modal' })

  dialog.querySelectorAll('[data-board-theme]').forEach((button) => {
    button.addEventListener('click', () => {
      settings.boardTheme = button.dataset.boardTheme
      saveSettings()
      applyBoardTheme(document.documentElement, settings.boardTheme)
      dialog.querySelectorAll('[data-board-theme]').forEach((other2) => other2.classList.toggle('active', other2 === button))
    })
  })
  dialog.querySelectorAll('[data-piece-theme]').forEach((button) => {
    button.addEventListener('click', () => {
      settings.pieceTheme = button.dataset.pieceTheme
      saveSettings()
      preloadPieces(settings.pieceTheme)
      board.setPieceTheme(settings.pieceTheme)
      render()
      dialog.querySelectorAll('[data-piece-theme]').forEach((other2) => other2.classList.toggle('active', other2 === button))
    })
  })
  const bind = (id, key, transform = (value) => value) => {
    const input = dialog.querySelector(id)
    input?.addEventListener('change', () => {
      settings[key] = transform(input.type === 'checkbox' ? input.checked : input.value)
      saveSettings()
      setSoundEnabled(settings.sound)
      setVolume(settings.volume)
      render()
    })
  }
  bind('#set-sound', 'sound')
  bind('#set-volume', 'volume', (value) => Number(value) / 100)
  bind('#set-eval', 'showEval')
  bind('#set-hints', 'showHints')
  bind('#set-learning', 'learning')
  bind('#set-sync', 'cloudSync')
}

function openRules () {
  openModal(`
    <div class="rules-card">
      <header><h3>Variants</h3><button data-close="x" aria-label="Close">✕</button></header>
      <h4>Classic</h4>
      <p>Standard chess with full rules — castling, en passant, promotion, the fifty-move rule and threefold repetition.</p>
      <h4>Setup Chess</h4>
      <p>Before play, each side spends ${BUDGET} material points placing its own army. Queens cost 9, rooks 5, bishops and knights 3, pawns 1, and the king is free but mandatory. Pieces go on your first three ranks and pawns on ranks two and three. The first army to finish placing moves first.</p>
      <h4>Fog of War</h4>
      <p>You see your own pieces and every square they can legally move to. Everything else is dark. There is no check or checkmate — capture the enemy king to win, and the king may walk through attacked squares.</p>
      <footer><button class="primary" data-close="done">Got it</button></footer>
    </div>`, { className: 'rules-modal' })
}

// --- wiring ------------------------------------------------------------------
function wirePlayPanel () {
  panelBody.querySelectorAll('[data-variant]').forEach((button) => {
    button.addEventListener('click', () => newGame({ variant: button.dataset.variant }))
  })
  panelBody.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => newGame({ mode: button.dataset.mode }))
  })
  panelBody.querySelectorAll('[data-level]').forEach((button) => {
    button.addEventListener('click', () => {
      settings.level = button.dataset.level
      saveSettings()
      toast(`${getLevel(settings.level).name} selected · ≈${getLevel(settings.level).rating}`)
      renderPanel()
      renderPlayers()
    })
  })
  panelBody.querySelectorAll('[data-side]').forEach((button) => {
    button.addEventListener('click', () => newGame({ side: button.dataset.side }))
  })
  panelBody.querySelectorAll('[data-time]').forEach((button) => {
    button.addEventListener('click', () => newGame({ timeControl: button.dataset.time }))
  })
  panelBody.querySelectorAll('[data-bank]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedBankPiece = state.selectedBankPiece === button.dataset.bank ? null : button.dataset.bank
      render()
    })
  })
  panelBody.querySelectorAll('[data-template]').forEach((button) => {
    button.addEventListener('click', () => applyArmyTemplate(button.dataset.template))
  })
  $('#panel-new')?.addEventListener('click', () => newGame())
  $('#panel-rules')?.addEventListener('click', openRules)
}

document.querySelectorAll('[data-nav]').forEach((button) => {
  button.addEventListener('click', () => {
    state.panel = button.dataset.nav
    document.querySelectorAll('[data-nav]').forEach((node) => node.classList.toggle('active', node.dataset.nav === state.panel))
    renderPanel(true)
    // Only the rail and top bar jump to the panel; the in-panel tabs are
    // already on screen, so scrolling there would just shove the board away.
    if (!button.closest('.panel-tabs') && window.matchMedia('(max-width: 900px)').matches) {
      document.querySelector('.side-panel').scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  })
})

$('#action-first').addEventListener('click', () => gotoPly(0))
$('#action-prev').addEventListener('click', () => stepPly(-1))
$('#action-next').addEventListener('click', () => stepPly(1))
$('#action-last').addEventListener('click', () => gotoPly(game ? game.ply : 0))
$('#action-undo').addEventListener('click', undoMove)
$('#action-resign').addEventListener('click', resignGame)
$('#action-draw').addEventListener('click', offerDraw)
$('#action-flip').addEventListener('click', () => { state.flipped = !state.flipped; lastRenderedPly = -1; render() })
$('#action-new').addEventListener('click', () => newGame())
$('#open-settings').addEventListener('click', openSettings)
$('#topbar-settings').addEventListener('click', openSettings)
$('#fog-handoff').addEventListener('click', () => {
  state.fogHandoff = false
  state.selected = null
  state.flipped = fog.turn === 'b'
  render()
})

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return
  if (event.key === 'ArrowLeft') { stepPly(-1); event.preventDefault() }
  else if (event.key === 'ArrowRight') { stepPly(1); event.preventDefault() }
  else if (event.key === 'f') { state.flipped = !state.flipped; lastRenderedPly = -1; render() }
  else if (event.key === 'n') newGame()
})

// --- persistence -------------------------------------------------------------
function persistGame () {
  writeJson(GAME_KEY, {
    variant: settings.variant,
    mode: settings.mode,
    humanSide: state.humanSide,
    phase: state.phase,
    flipped: state.flipped,
    clocks: state.clocks,
    timeControl: settings.timeControl,
    placements: setup.serialize(),
    moves: game ? game.uciHistory() : [],
    startFen: game ? game.startFen : null,
    fogMoves: settings.variant === 'fog' ? fog.serialize() : [],
    result: state.result
  })
}

function restoreGame () {
  const saved = readJson(GAME_KEY, null)
  if (!saved || saved.variant !== settings.variant) return false
  state.humanSide = saved.humanSide === 'b' ? 'b' : 'w'
  state.flipped = !!saved.flipped
  if (saved.clocks) state.clocks = saved.clocks
  if (settings.variant === 'fog') {
    fog = new FogGame()
    fog.loadMoves(saved.fogMoves || [])
    state.phase = 'play'
    state.fogHandoff = settings.mode === 'local' && !fog.winner
    if (fog.winner) state.result = { over: true, result: fog.winner === 'draw' ? 'draw' : fog.winner, reason: fog.winReason }
    return true
  }
  setup = SetupGame.fromHistory(saved.placements || [])
  if (settings.variant === 'setup' && !setup.complete()) {
    state.phase = 'setup'
    return true
  }
  const startFen = saved.startFen || (settings.variant === 'setup' ? (setup.complete() ? setup.fen() : START_FEN) : START_FEN)
  game = new Game(startFen, settings.variant)
  for (const uci of saved.moves || []) if (!game.play(uci)) break
  state.phase = 'play'
  const outcome = game.outcome()
  if (outcome.over) { state.result = outcome; state.phase = 'over' }
  return true
}

// --- boot --------------------------------------------------------------------
function boot () {
  applyBoardTheme(document.documentElement, settings.boardTheme)
  preloadPieces(settings.pieceTheme)
  setSoundEnabled(settings.sound)
  setVolume(settings.volume)
  startWorker()

  board = new BoardView($('#board'), {
    onSelect: onSquare,
    onDrop,
    canGrab
  })
  board.setPieceTheme(settings.pieceTheme)

  const restored = restoreGame()
  if (!restored) {
    if (settings.variant === 'setup') { state.phase = 'setup' } else if (settings.variant === 'fog') {
      state.phase = 'play'
      state.fogHandoff = settings.mode === 'local'
    } else {
      game = new Game(START_FEN, 'classic')
      state.phase = 'play'
    }
    state.humanSide = settings.side === 'random' ? 'w' : settings.side
    state.flipped = settings.mode === 'ai' && state.humanSide === 'b'
  }

  render()
  primeBook()
  if (!state.result) {
    const control = getTimeControl(settings.timeControl)
    if (control.initial && game && game.ply > 0) startClocks()
    scheduleEngine()
  }
  window.addEventListener('online', () => { if (settings.cloudSync) flush().catch(() => {}) })
  if (settings.cloudSync) flush().catch(() => {})
}

boot()
export { state, settings }
