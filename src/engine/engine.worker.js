// Search worker. Handles three jobs: pick a move, analyse a position for the
// eval bar, and review a finished game so the learning store can be updated.
import { Board } from './board.js'
import { Searcher, moveKey } from './search.js'
import { uciToMove } from './notation.js'
import { MATE_SCORE, MATE_IN_MAX } from './eval.js'

const searcher = new Searcher()
let currentJob = 0

// Lichess-style conversion from centipawns to an expected score, used for the
// accuracy percentages shown in game review.
const winPercent = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
const accuracyFor = (before, after) => {
  const drop = Math.max(0, before - after)
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669))
}

function classify (loss) {
  if (loss >= 300) return 'blunder'
  if (loss >= 150) return 'mistake'
  if (loss >= 60) return 'inaccuracy'
  if (loss >= 20) return 'good'
  return 'best'
}

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

  const review = []
  const accuracies = [[], []]
  for (let i = 0; i < moves.length && i + 1 < positions.length; i++) {
    const mover = i % 2 === 0 ? 0 : 1
    const before = positions[i].white
    const after = positions[i + 1].white
    const signedBefore = mover === 0 ? before : -before
    const signedAfter = mover === 0 ? after : -after
    const loss = Math.max(0, Math.round(signedBefore - signedAfter))
    const capped = Math.abs(signedBefore) > MATE_IN_MAX || Math.abs(signedAfter) > MATE_IN_MAX
      ? Math.min(loss, 900)
      : loss
    const accuracy = accuracyFor(winPercent(signedBefore), winPercent(signedAfter))
    accuracies[mover].push(accuracy)
    const best = positions[i].best
    review.push({
      ply: i,
      uci: moves[i],
      mover: mover === 0 ? 'w' : 'b',
      evalBefore: before,
      evalAfter: after,
      loss: capped,
      best,
      wasBest: best === moves[i],
      quality: best === moves[i] ? 'best' : classify(capped),
      position: keys[i].key
    })
  }

  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 100)
  return {
    type: 'review',
    job,
    review,
    evals: positions.map((p) => p.white),
    accuracy: { w: Math.round(mean(accuracies[0]) * 10) / 10, b: Math.round(mean(accuracies[1]) * 10) / 10 }
  }
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
