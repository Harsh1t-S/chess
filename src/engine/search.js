// Iterative-deepening principal variation search with a transposition table,
// quiescence, null-move pruning, late move reductions, killers and history.
import {
  WHITE, PAWN, QUEEN, KING,
  FLAG_CAPTURE, FLAG_PROMO,
  moveFrom, moveTo, moveFlags, movePromo,
  pieceType, squareName, NO_SQUARE
} from './board.js'
import { evaluate, hasNonPawnMaterial, SEE_VALUE, MATE_SCORE, MATE_IN_MAX } from './eval.js'

const TT_BITS = 21
const TT_SIZE = 1 << TT_BITS
const TT_MASK = TT_SIZE - 1
const BOUND_EXACT = 1
const BOUND_LOWER = 2
const BOUND_UPPER = 3
const MAX_PLY = 96
const INFINITY = 50000

const ttKeys = new Int32Array(TT_SIZE)
const ttMoves = new Int32Array(TT_SIZE)
const ttScores = new Int32Array(TT_SIZE)
const ttMeta = new Int32Array(TT_SIZE)
let ttGeneration = 0

export function clearTable () {
  ttKeys.fill(0)
  ttMoves.fill(0)
  ttScores.fill(0)
  ttMeta.fill(0)
  ttGeneration = 0
}

const FUTILITY_MARGIN = [0, 120, 220, 330]
const LMR_TABLE = []
for (let depth = 0; depth < 64; depth++) {
  LMR_TABLE[depth] = []
  for (let count = 0; count < 64; count++) {
    LMR_TABLE[depth][count] = depth < 3 || count < 3 ? 0 : Math.floor(0.75 + Math.log(depth) * Math.log(count) / 2.25)
  }
}

// Fallback profile for callers that pass a bare `skill` instead of the explicit
// play profile levels.js supplies.
const SKILL_TEMPERATURE = [0, 9, 16, 24, 33, 44, 60, 74, 92, 120, 145, 170, 195, 215, 235, 250, 260, 300, 345, 385, 420]
const profileFromSkill = (skill) => {
  const weakness = Math.max(0, Math.min(20, 20 - skill))
  return {
    best: Math.max(0, 1 - weakness / 22),
    temperature: SKILL_TEMPERATURE[weakness],
    maxLoss: SKILL_TEMPERATURE[weakness] * 4
  }
}

const moveKey = (move) => {
  const promo = movePromo(move)
  return squareName(moveFrom(move)) + squareName(moveTo(move)) + (promo ? 'xxnbrq'[promo] : '')
}

export class Searcher {
  constructor () {
    this.killers = new Int32Array(MAX_PLY * 2)
    this.history = new Int32Array(2 * 128 * 128)
    this.counters = new Int32Array(16 * 128)
    this.nodes = 0
    this.deadline = Infinity
    this.stopped = false
    this.onProgress = null
    this.moveBuffers = []
    this.scoreBuffers = []
    this.quietBuffers = []
    for (let ply = 0; ply < MAX_PLY + 4; ply++) {
      this.moveBuffers.push([])
      this.scoreBuffers.push(new Int32Array(256))
      this.quietBuffers.push(new Int32Array(128))
    }
  }

  newGame () {
    clearTable()
    this.history.fill(0)
    this.counters.fill(0)
  }

  decayHistory () {
    for (let i = 0; i < this.history.length; i++) this.history[i] >>= 1
  }

  timeUp () {
    if (this.stopped) return true
    if ((this.nodes & 2047) === 0 && Date.now() >= this.deadline) this.stopped = true
    return this.stopped
  }

  // --- move ordering --------------------------------------------------------
  scoreMove (board, move, ply, ttMove, prevMove) {
    if (move === ttMove) return 1 << 28
    const flags = moveFlags(move)
    if (flags & FLAG_PROMO) {
      const promo = movePromo(move)
      return (1 << 26) + SEE_VALUE[promo] + ((flags & FLAG_CAPTURE) ? 400 : 0)
    }
    if (flags & FLAG_CAPTURE) {
      const victim = board.squares[moveTo(move)]
      const victimValue = victim ? SEE_VALUE[pieceType(victim)] : SEE_VALUE[PAWN]
      const attackerValue = SEE_VALUE[pieceType(board.squares[moveFrom(move)])]
      return (1 << 25) + victimValue * 16 - attackerValue
    }
    if (this.killers[ply * 2] === move) return (1 << 24) + 2
    if (this.killers[ply * 2 + 1] === move) return (1 << 24) + 1
    if (prevMove) {
      const piece = board.squares[moveFrom(prevMove)] || 0
      if (this.counters[piece * 128 + moveTo(prevMove)] === move) return (1 << 23)
    }
    return this.history[(board.turn * 128 * 128) + moveFrom(move) * 128 + moveTo(move)]
  }

  // Scores are written into a per-ply buffer; moves are then selected lazily so
  // a beta cutoff on the first move costs one pass instead of a full sort.
  scoreMoves (board, moves, ply, ttMove, prevMove) {
    const scores = this.scoreBuffers[ply]
    for (let i = 0; i < moves.length; i++) scores[i] = this.scoreMove(board, moves[i], ply, ttMove, prevMove)
    return scores
  }

  pickBest (moves, scores, start) {
    let best = start
    for (let i = start + 1; i < moves.length; i++) if (scores[i] > scores[best]) best = i
    if (best !== start) {
      const m = moves[start]; moves[start] = moves[best]; moves[best] = m
      const sc = scores[start]; scores[start] = scores[best]; scores[best] = sc
    }
    return moves[start]
  }

  storeKiller (move, ply) {
    const slot = ply * 2
    if (this.killers[slot] !== move) {
      this.killers[slot + 1] = this.killers[slot]
      this.killers[slot] = move
    }
  }

  // --- transposition table --------------------------------------------------
  probe (board, depth, alpha, beta, ply) {
    const index = (board.keyLo & TT_MASK) >>> 0
    if (ttKeys[index] !== board.keyHi || ttMeta[index] === 0) return null
    const meta = ttMeta[index]
    const entryDepth = meta >> 3
    const move = ttMoves[index]
    if (entryDepth < depth) return { move, score: null }
    let score = ttScores[index]
    if (score > MATE_IN_MAX) score -= ply
    else if (score < -MATE_IN_MAX) score += ply
    const bound = meta & 7
    if (bound === BOUND_EXACT) return { move, score }
    if (bound === BOUND_LOWER && score >= beta) return { move, score }
    if (bound === BOUND_UPPER && score <= alpha) return { move, score }
    return { move, score: null }
  }

  store (board, depth, score, bound, move, ply) {
    const index = (board.keyLo & TT_MASK) >>> 0
    const existing = ttMeta[index]
    const existingDepth = existing >> 3
    if (existing !== 0 && ttKeys[index] === board.keyHi && existingDepth > depth + 2) return
    let stored = score
    if (stored > MATE_IN_MAX) stored += ply
    else if (stored < -MATE_IN_MAX) stored -= ply
    ttKeys[index] = board.keyHi
    ttMoves[index] = move
    ttScores[index] = stored
    ttMeta[index] = (depth << 3) | bound
  }

  // --- quiescence -----------------------------------------------------------
  quiesce (board, alpha, beta, ply) {
    this.nodes++
    if (this.timeUp()) return 0
    if (ply >= MAX_PLY - 1) return evaluate(board)
    if (board.opponentKingExposed()) return MATE_SCORE - ply

    const inCheck = board.inCheck()
    let best = -INFINITY
    if (!inCheck) {
      best = evaluate(board)
      if (best >= beta) return best
      if (best > alpha) alpha = best
    }

    const moves = board.generate(!inCheck, this.moveBuffers[ply])
    const scores = this.scoreMoves(board, moves, ply, 0, 0)
    let legal = 0
    for (let i = 0; i < moves.length; i++) {
      const move = this.pickBest(moves, scores, i)
      const flags = moveFlags(move)
      if (!inCheck && !(flags & FLAG_PROMO)) {
        // delta pruning: skip captures that cannot rescue the position
        const victim = board.squares[moveTo(move)]
        const gain = victim ? SEE_VALUE[pieceType(victim)] : SEE_VALUE[PAWN]
        if (best + gain + 200 < alpha) continue
      }
      if (!board.makeMove(move)) continue
      legal++
      const score = -this.quiesce(board, -beta, -alpha, ply + 1)
      board.undoMove()
      if (this.stopped) return 0
      if (score > best) best = score
      if (score > alpha) alpha = score
      if (alpha >= beta) break
    }
    if (inCheck && legal === 0) return -MATE_SCORE + ply
    return best
  }

  // --- main search ----------------------------------------------------------
  negamax (board, depth, alpha, beta, ply, canNull, prevMove) {
    if (this.timeUp()) return 0
    const isRoot = ply === 0
    const pvNode = beta - alpha > 1

    if (!isRoot) {
      if (board.opponentKingExposed()) return MATE_SCORE - ply
      if (board.halfMoves >= 100 || board.isRepetition(2) || board.insufficientMaterial()) return 0
      // mate distance pruning
      const mateAlpha = Math.max(alpha, -MATE_SCORE + ply)
      const mateBeta = Math.min(beta, MATE_SCORE - ply - 1)
      if (mateAlpha >= mateBeta) return mateAlpha
      alpha = mateAlpha
      beta = mateBeta
    }

    const inCheck = board.inCheck()
    if (inCheck) depth++
    if (depth <= 0) return this.quiesce(board, alpha, beta, ply)

    this.nodes++
    if (ply >= MAX_PLY - 1) return evaluate(board)

    let ttMove = 0
    if (!isRoot) {
      const hit = this.probe(board, depth, alpha, beta, ply)
      if (hit) {
        ttMove = hit.move
        if (hit.score !== null && !pvNode) return hit.score
      }
    } else {
      const hit = this.probe(board, 0, alpha, beta, ply)
      if (hit) ttMove = hit.move
    }

    const staticEval = inCheck ? -INFINITY : evaluate(board)

    if (!pvNode && !inCheck && depth <= 3 && staticEval - FUTILITY_MARGIN[depth] >= beta && Math.abs(beta) < MATE_IN_MAX) {
      return staticEval
    }

    if (canNull && !pvNode && !inCheck && depth >= 3 && staticEval >= beta &&
        hasNonPawnMaterial(board, board.turn) && Math.abs(beta) < MATE_IN_MAX) {
      const reduction = 3 + (depth >> 2)
      board.makeNullMove()
      const score = -this.negamax(board, depth - reduction, -beta, -beta + 1, ply + 1, false, 0)
      board.undoNullMove()
      if (this.stopped) return 0
      if (score >= beta) return Math.abs(score) >= MATE_IN_MAX ? beta : score
    }

    const moves = board.generate(false, this.moveBuffers[ply])
    const scores = this.scoreMoves(board, moves, ply, ttMove, prevMove)

    let best = -INFINITY
    let bestMove = 0
    let legal = 0
    let bound = BOUND_UPPER
    const quiets = this.quietBuffers[ply]
    let quietCount = 0

    for (let i = 0; i < moves.length; i++) {
      const move = this.pickBest(moves, scores, i)
      const flags = moveFlags(move)
      const tactical = (flags & (FLAG_CAPTURE | FLAG_PROMO)) !== 0

      if (!pvNode && !inCheck && !tactical && legal > 0 && depth <= 3 &&
          staticEval + FUTILITY_MARGIN[depth] <= alpha && Math.abs(alpha) < MATE_IN_MAX) {
        continue
      }

      if (!board.makeMove(move)) continue
      legal++
      if (!tactical && quietCount < 128) quiets[quietCount++] = move

      let score
      const reduction = tactical || inCheck ? 0 : (LMR_TABLE[Math.min(depth, 63)][Math.min(legal, 63)] || 0)
      if (legal === 1) {
        score = -this.negamax(board, depth - 1, -beta, -alpha, ply + 1, true, move)
      } else {
        const reduced = Math.max(0, depth - 1 - reduction)
        score = -this.negamax(board, reduced, -alpha - 1, -alpha, ply + 1, true, move)
        if (score > alpha && reduced < depth - 1) {
          score = -this.negamax(board, depth - 1, -alpha - 1, -alpha, ply + 1, true, move)
        }
        if (score > alpha && score < beta) {
          score = -this.negamax(board, depth - 1, -beta, -alpha, ply + 1, true, move)
        }
      }
      board.undoMove()
      if (this.stopped) return 0

      if (score > best) {
        best = score
        bestMove = move
        if (score > alpha) {
          alpha = score
          bound = BOUND_EXACT
          if (alpha >= beta) {
            bound = BOUND_LOWER
            if (!tactical) {
              this.storeKiller(move, ply)
              const historyIndex = (board.turn * 128 * 128) + moveFrom(move) * 128 + moveTo(move)
              this.history[historyIndex] = Math.min(this.history[historyIndex] + depth * depth, 1 << 22)
              for (let q = 0; q < quietCount; q++) {
                const quiet = quiets[q]
                if (quiet === move) continue
                const idx = (board.turn * 128 * 128) + moveFrom(quiet) * 128 + moveTo(quiet)
                this.history[idx] = Math.max(this.history[idx] - depth * depth, -(1 << 22))
              }
              if (prevMove) {
                const piece = board.squares[moveFrom(prevMove)] || 0
                this.counters[piece * 128 + moveTo(prevMove)] = move
              }
            }
            break
          }
        }
      }
    }

    if (legal === 0) return inCheck ? -MATE_SCORE + ply : 0
    this.store(board, depth, best, bound, bestMove, ply)
    return best
  }

  // Scores every root move so weaker levels can pick a human-looking mistake.
  searchRoot (board, depth, alpha, beta, rootMoves, rootBias) {
    let best = -INFINITY
    let bestMove = 0
    let index = 0
    for (const entry of rootMoves) {
      if (!board.makeMove(entry.move)) continue
      index++
      let score
      if (index === 1) {
        score = -this.negamax(board, depth - 1, -beta, -alpha, 1, true, entry.move)
      } else {
        score = -this.negamax(board, depth - 1, -alpha - 1, -alpha, 1, true, entry.move)
        if (score > alpha && score < beta) {
          score = -this.negamax(board, depth - 1, -beta, -alpha, 1, true, entry.move)
        }
      }
      board.undoMove()
      if (this.stopped) break
      entry.score = score + (rootBias ? (rootBias[moveKey(entry.move)] || 0) : 0)
      entry.searched = true
      if (entry.score > best) {
        best = entry.score
        bestMove = entry.move
        if (entry.score > alpha) alpha = entry.score
      }
    }
    return { best, bestMove }
  }

  // Root scores from the main search are null-window bounds, and an aborted
  // iteration leaves a mix of depths behind. Skill-limited play needs real
  // numbers to decide how much worse a move actually is, so the top candidates
  // are re-searched with a full window before the pick.
  refineRoot (board, entries, depth, rootBias, budgetMs) {
    this.stopped = false
    this.deadline = Date.now() + Math.max(60, budgetMs)
    const refined = []
    for (const entry of entries) {
      if (!board.makeMove(entry.move)) continue
      const score = -this.negamax(board, depth - 1, -INFINITY, INFINITY, 1, true, entry.move)
      board.undoMove()
      if (this.stopped) break
      refined.push({ move: entry.move, score: score + (rootBias ? (rootBias[moveKey(entry.move)] || 0) : 0) })
    }
    return refined.length >= 2 ? refined : null
  }

  extractPv (board, move, limit = 12) {
    const pv = []
    let pushed = 0
    let current = move
    while (current && pushed < limit) {
      if (!board.makeMove(current)) break
      pv.push(current)
      pushed++
      const index = (board.keyLo & TT_MASK) >>> 0
      current = ttKeys[index] === board.keyHi && ttMeta[index] !== 0 ? ttMoves[index] : 0
    }
    for (let i = 0; i < pushed; i++) board.undoMove()
    return pv
  }

  search (board, options = {}) {
    const maxDepth = Math.min(options.depth || 64, 63)
    const movetime = options.movetime || 1500
    const skill = options.skill === undefined ? 20 : options.skill
    const profile = options.play || profileFromSkill(skill)
    const weakened = profile.best < 1 && profile.temperature > 0
    const rootBias = options.rootBias || null

    this.nodes = 0
    this.stopped = false
    this.deadline = Date.now() + movetime
    this.killers.fill(0)
    this.decayHistory()
    ttGeneration++

    const legal = board.legalMoves()
    if (!legal.length) return { move: 0, score: 0, depth: 0, nodes: 0, pv: [], moves: [] }

    const rootMoves = legal.map((move) => ({ move, score: -INFINITY, searched: false }))
    let bestMove = rootMoves[0].move
    let bestScore = 0
    let completed = 0
    let alpha = -INFINITY
    let beta = INFINITY
    let iterationStart = Date.now()

    for (let depth = 1; depth <= maxDepth; depth++) {
      if (depth >= 5) {
        alpha = bestScore - 40
        beta = bestScore + 40
      }
      let result
      for (;;) {
        for (const entry of rootMoves) { entry.searched = false }
        result = this.searchRoot(board, depth, alpha, beta, rootMoves, rootBias)
        if (this.stopped) break
        if (result.best <= alpha) { alpha = Math.max(-INFINITY, alpha - 220); continue }
        if (result.best >= beta) { beta = Math.min(INFINITY, beta + 220); continue }
        break
      }
      if (this.stopped && completed > 0) break
      if (result.bestMove) {
        bestMove = result.bestMove
        bestScore = result.best
        completed = depth
        // freeze the scores this iteration produced so a later aborted
        // iteration cannot leave a mixture of depths behind
        for (const entry of rootMoves) if (entry.searched) entry.finalScore = entry.score
        rootMoves.sort((a, b) => (b.finalScore ?? -INFINITY) - (a.finalScore ?? -INFINITY))
        if (this.onProgress) {
          this.onProgress({
            depth,
            score: bestScore,
            nodes: this.nodes,
            pv: this.extractPv(board, bestMove).map(moveKey)
          })
        }
      }
      if (Math.abs(bestScore) > MATE_IN_MAX) break
      const now = Date.now()
      if (now >= this.deadline) break
      // skip an iteration we almost certainly cannot finish in the time left
      const spent = now - iterationStart
      if (depth >= 4 && now + spent * 2.1 > this.deadline) break
      iterationStart = now
    }

    let candidates = rootMoves
      .filter((entry) => entry.finalScore !== undefined)
      .map((entry) => ({ move: entry.move, score: entry.finalScore }))
    if (weakened && completed > 0 && candidates.length > 1) {
      // Strong levels only need accurate numbers near the top of the list.
      // Weak levels need the whole move list scored — otherwise the pool never
      // contains a move bad enough for them to plausibly play — so they trade
      // depth for breadth.
      // A level can only play a move that is in the pool, so the weaker ones
      // need the whole list scored: with only the top few refined, even a
      // deliberately careless bot never finds anything bad enough to play.
      const wide = profile.maxLoss >= 400
      const pool = wide ? candidates : candidates.slice(0, profile.maxLoss <= 150 ? 8 : 16)
      const depth = wide ? Math.min(completed - 1, 3) : completed - 1
      const exact = this.refineRoot(board, pool, Math.max(1, depth), rootBias, movetime * 0.6)
      if (exact) candidates = exact
    }

    const chosen = pickWithSkill(candidates, bestMove, bestScore, profile)
    return {
      move: chosen.move,
      score: chosen.score,
      bestMove,
      bestScore,
      depth: completed,
      nodes: this.nodes,
      pv: this.extractPv(board, chosen.move).map(moveKey),
      moves: candidates.map((m) => ({ uci: moveKey(m.move), move: m.move, score: m.score }))
    }
  }
}

// Skill 20 always plays the best move. Lower skill widens an acceptance window
// and picks randomly inside it, which produces human-shaped inaccuracies rather
// than uniformly random garbage.
// Two stages, because that is the shape of human error: most of the time the
// player finds the move, and when they do not the mistake is usually small.
// Sampling from every move on every turn produces an opponent that feels
// random rather than weak, which is what makes a rated bot read as trash.
function pickWithSkill (candidates, bestMove, bestScore, profile) {
  if (!profile || !candidates || candidates.length < 2) return { move: bestMove, score: bestScore }
  const { best = 1, temperature = 0, maxLoss = 0 } = profile
  if (best >= 1 || temperature <= 0) return { move: bestMove, score: bestScore }
  const top = candidates.reduce((highest, entry) => (entry.score > highest ? entry.score : highest), -INFINITY)
  if (top === -INFINITY) return { move: bestMove, score: bestScore }

  // Never hand back a forced win, and never fumble the defence of a forced loss.
  if (Math.abs(top) > MATE_IN_MAX) return { move: bestMove, score: bestScore }

  // Stage one: simply play the best move.
  if (Math.random() < best) return { move: bestMove, score: bestScore }

  // Stage two: settle for something worse, but never worse than the ceiling.
  const ceiling = maxLoss > 0 ? maxLoss : temperature * 4
  const weights = []
  let total = 0
  for (const entry of candidates) {
    const loss = top - entry.score
    const weight = loss > ceiling ? 0 : Math.exp(-loss / temperature)
    weights.push(weight)
    total += weight
  }
  if (total <= 0) return { move: bestMove, score: bestScore }

  let target = Math.random() * total
  for (let i = 0; i < candidates.length; i++) {
    target -= weights[i]
    if (target <= 0) return { move: candidates[i].move, score: candidates[i].score }
  }
  return { move: bestMove, score: bestScore }
}

export { moveKey }
