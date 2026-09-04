// The arithmetic behind game review: centipawn loss, move classification and
// accuracy. Kept separate from any particular engine so the same numbers come
// out whether the positions were judged by Stockfish or by the local engine.
import { MATE_IN_MAX } from '../engine/eval.js'

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

// `positions` holds one entry per position in the game, each with the
// evaluation from White's point of view and the engine's preferred move.
// `keys` holds the position hash the move was played from.
export function buildReview ({ moves, positions, keys }) {
  const review = []
  const accuracies = [[], []]
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
