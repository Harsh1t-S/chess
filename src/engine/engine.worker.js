// Search worker. Handles three jobs: pick a move, analyse a position for the
// eval bar, and review a finished game so the learning store can be updated.
import { Board } from './board.js'
import { Searcher, moveKey } from './search.js'
import { uciToMove } from './notation.js'
import { MATE_SCORE } from './eval.js'
import { buildReview } from '../learn/review.js'

const searcher = new Searcher()
let currentJob = 0

function positionKey (board) {
  return ((board.keyHi >>> 0).toString(16).padStart(8, '0')) + ((board.keyLo >>> 0).toString(16).padStart(8, '0'))
}

function runSearch (payload) {
  const board = new Board(payload.fen)
  for (const uci of payload.history || []) {
    const move = uciToMove(board, uci)
    if (move) board.makeMove(move)
  }
  const job = payload.job
  searcher.onProgress = (info) => {
    if (job !== currentJob) return
    self.postMessage({ type: 'progress', job, depth: info.depth, score: info.score, nodes: info.nodes, pv: info.pv })
  }
  const started = Date.now()
  const result = searcher.search(board, {
    depth: payload.depth,
    movetime: payload.movetime,
    skill: payload.skill,
    play: payload.play,
    rootBias: payload.rootBias
  })
  searcher.onProgress = null
  return {
    type: 'move',
    job,
    move: result.move ? moveKey(result.move) : null,
    best: result.bestMove ? moveKey(result.bestMove) : null,
    score: result.score,
    bestScore: result.bestScore,
    depth: result.depth,
    nodes: result.nodes,
    elapsed: Date.now() - started,
    pv: result.pv,
    position: positionKey(board)
  }
}

function runAnalysis (payload) {
  const board = new Board(payload.fen)
  for (const uci of payload.history || []) {
    const move = uciToMove(board, uci)
    if (move) board.makeMove(move)
  }
  const result = searcher.search(board, { depth: payload.depth || 10, movetime: payload.movetime || 500, skill: 20 })
  return {
    type: 'analysis',
    job: payload.job,
    purpose: payload.purpose || 'eval',
    score: result.score,
    depth: result.depth,
    nodes: result.nodes,
    best: result.move ? moveKey(result.move) : null,
    pv: result.pv,
    position: positionKey(board)
  }
}

// Walk the finished game once, scoring every position, then derive per-move
// centipawn loss, classifications, accuracy and the learning records.
function runReview (payload) {
  const { fen, moves, job } = payload
  const depth = payload.depth || 10
  const movetime = payload.movetime || 260
  const board = new Board(fen)
  const positions = []
  const keys = []

  searcher.newGame()
  for (let i = 0; i <= moves.length; i++) {
    const turn = board.turn
    keys.push({ key: positionKey(board), turn })
    const outcome = board.outcome()
    let score
    let best = null
    if (outcome === 'checkmate') {
      score = -MATE_SCORE
    } else if (outcome) {
      score = 0
    } else {
      const result = searcher.search(board, { depth, movetime, skill: 20 })
      score = result.score
      best = result.move ? moveKey(result.move) : null
    }
    // store from white's point of view
    positions.push({ white: turn === 0 ? score : -score, best })
    if (i < moves.length) {
      const move = uciToMove(board, moves[i])
      if (!move) break
      board.makeMove(move)
    }
    if (job !== currentJob) return null
    self.postMessage({ type: 'review-progress', job, done: i + 1, total: moves.length + 1 })
  }

  return { type: 'review', job, ...buildReview({ moves, positions, keys }) }
}

self.onmessage = (event) => {
  const payload = event.data || {}
  if (payload.type === 'stop') { searcher.stopped = true; return }
  if (payload.type === 'reset') { searcher.newGame(); return }
  currentJob = payload.job || 0
  try {
    let result = null
    if (payload.type === 'search') result = runSearch(payload)
    else if (payload.type === 'analysis') result = runAnalysis(payload)
    else if (payload.type === 'review') result = runReview(payload)
    if (result) self.postMessage(result)
  } catch (error) {
    self.postMessage({ type: 'error', job: payload.job, message: error instanceof Error ? error.message : String(error) })
  }
}
