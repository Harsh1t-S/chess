// The arithmetic behind game review: centipawn loss, move classification and
// accuracy. Kept separate from any particular engine so the same numbers come
// out whether the positions were judged by Stockfish or by the local engine.
import { MATE_IN_MAX, materialCount } from '../engine/eval.js'
import { Board, moveToUci, START_FEN } from '../engine/board.js'

// Lichess's conversion from an evaluation to an expected score, and from a drop
// in that expectation to an accuracy percentage.
export const winPercent = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
export const accuracyFor = (before, after) => {
  const drop = Math.max(0, before - after)
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669))
}

export function classify (loss) {
  if (loss >= 300) return 'blunder'
  if (loss >= 150) return 'mistake'
  if (loss >= 60) return 'inaccuracy'
  if (loss >= 20) return 'good'
  return 'best'
}

// A sacrifice worth the name: the move the engine liked best, which hands over
// real material once the opponent takes with their own best reply, and still
// leaves the player standing. Anything else that happens to be the best move is
// simply the best move — calling a routine recapture brilliant is what makes a
// review feel like flattery.
const SACRIFICE = 200

function sacrifices (board, move, reply) {
  const mover = board.turn
  const before = materialCount(board)
  const played = board.legalMoves().find((candidate) => moveToUci(candidate) === move)
  if (played === undefined || !board.makeMove(played)) return false
  let taken = null
  if (reply) {
    taken = board.legalMoves().find((candidate) => moveToUci(candidate) === reply)
    if (taken !== undefined && !board.makeMove(taken)) taken = undefined
  }
  const after = materialCount(board)
  if (taken !== undefined && taken !== null) board.undoMove()
  board.undoMove()
  const ours = mover === 0 ? 'w' : 'b'
  const theirs = mover === 0 ? 'b' : 'w'
  const swing = (after[ours] - after[theirs]) - (before[ours] - before[theirs])
  return swing <= -SACRIFICE
}

// `positions` holds one entry per position in the game, each with the
// evaluation from White's point of view and the engine's preferred move.
// `keys` holds the position hash the move was played from. `fen` is the
// position the game started from, needed only to replay it for sacrifices.
export function buildReview ({ moves, positions, keys, fen = START_FEN }) {
  const review = []
  const accuracies = [[], []]
  let board = null
  try { board = new Board(fen) } catch { board = null }
  for (let i = 0; i < moves.length && i + 1 < positions.length; i++) {
    const mover = i % 2 === 0 ? 0 : 1
    const before = positions[i].white
    const after = positions[i + 1].white
    const signedBefore = mover === 0 ? before : -before
    const signedAfter = mover === 0 ? after : -after
    const loss = Math.max(0, Math.round(signedBefore - signedAfter))
    const nearMate = Math.abs(signedBefore) > MATE_IN_MAX || Math.abs(signedAfter) > MATE_IN_MAX
    const capped = nearMate ? Math.min(loss, 900) : loss
    accuracies[mover].push(accuracyFor(winPercent(signedBefore), winPercent(signedAfter)))
    const best = positions[i].best
    const wasBest = best === moves[i]
    let quality = wasBest ? 'best' : classify(capped)
    if (board && wasBest && signedBefore <= 600 && signedAfter >= 0 && !nearMate) {
      if (sacrifices(board, moves[i], positions[i + 1].best)) quality = 'brilliant'
    }
    if (board) {
      const played = board.legalMoves().find((candidate) => moveToUci(candidate) === moves[i])
      if (played === undefined || !board.makeMove(played)) board = null
    }
    review.push({
      ply: i,
      uci: moves[i],
      mover: mover === 0 ? 'w' : 'b',
      evalBefore: before,
      evalAfter: after,
      loss: capped,
      best,
      wasBest,
      quality,
      position: keys[i] ? keys[i].key : null
    })
  }
  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 100)
  return {
    review,
    evals: positions.map((entry) => entry.white),
    accuracy: {
      w: Math.round(mean(accuracies[0]) * 10) / 10,
      b: Math.round(mean(accuracies[1]) * 10) / 10
    }
  }
}
