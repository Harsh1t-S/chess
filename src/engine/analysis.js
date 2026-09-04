// Chooses the strongest analyser available and presents one interface to the
// rest of the app.
//
// Stockfish judges positions when it can reach the CDN; the local engine is the
// fallback so an offline install still gets an evaluation bar, hints and a game
// review, just a weaker-judged one.
import { getStockfish } from './stockfish.js'
import { STOCKFISH_URL } from '../config.js'
import { buildReview } from '../learn/review.js'
import { Board } from './board.js'
import { uciToMove } from './notation.js'

const REVIEW_DEPTH = 12
const EVAL_DEPTH = 13
const HINT_DEPTH = 14

export class Analyser {
  constructor ({ worker, useStockfish = true, base } = {}) {
    this.worker = worker
    this.useStockfish = useStockfish
    this.base = base || STOCKFISH_URL
    this.stockfish = useStockfish ? getStockfish(this.base) : null
    this.probed = null
  }

  get engineName () { return this.ready ? 'Stockfish 10' : 'ForgeChess engine' }

  // Resolves true once Stockfish has actually answered; a failure here is
  // normal (offline, blocked CDN) and simply means the local engine is used.
  async probe () {
    if (!this.stockfish) return false
    if (this.probed === null) {
      this.probed = this.stockfish.start().then(() => { this.ready = true; return true }).catch(() => { this.ready = false; return false })
    }
    return this.probed
  }

  setEnabled (value) {
    this.useStockfish = !!value
    if (!value) { this.ready = false; return }
    if (!this.stockfish) this.stockfish = getStockfish(this.base)
    this.probed = null
    this.probe()
  }

  // { score, best, pv, depth } with the score from the side to move's view.
  async evaluate ({ fen, moves = [], depth = EVAL_DEPTH, movetime = 0 }) {
    if (this.useStockfish && (await this.probe())) {
      try {
        return await this.stockfish.analyse({ fen, moves, depth, movetime })
      } catch { this.ready = false }
    }
    return null
  }

  async bestMove ({ fen, moves = [], depth = HINT_DEPTH }) {
    const result = await this.evaluate({ fen, moves, depth })
    return result ? result.best : null
  }

  // Walks the finished game once, scoring every position, and returns the same
  // shape the local worker's review produces.
  async reviewGame ({ fen, moves, depth = REVIEW_DEPTH, onProgress, shouldStop }) {
    if (!this.useStockfish || !(await this.probe())) return null
    const board = new Board(fen)
    const positions = []
    const keys = []
    try {
      for (let i = 0; i <= moves.length; i++) {
        if (shouldStop && shouldStop()) return null
        keys.push({ key: positionKey(board), turn: board.turn })
        const outcome = board.outcome()
        let white = 0
        let best = null
        if (outcome === 'checkmate') {
          white = board.turn === 0 ? -32000 : 32000
        } else if (!outcome) {
          const result = await this.stockfish.analyse({ fen, moves: moves.slice(0, i), depth })
          white = board.turn === 0 ? result.score : -result.score
          best = result.best
        }
        positions.push({ white, best })
        if (onProgress) onProgress(i + 1, moves.length + 1)
        if (i < moves.length) {
          const move = uciToMove(board, moves[i])
          if (!move) break
          board.makeMove(move)
        }
      }
    } catch {
      this.ready = false
      return null
    }
    return buildReview({ moves, positions, keys })
  }
}

function positionKey (board) {
  return ((board.keyHi >>> 0).toString(16).padStart(8, '0')) + ((board.keyLo >>> 0).toString(16).padStart(8, '0'))
}

export { REVIEW_DEPTH, EVAL_DEPTH, HINT_DEPTH }
