// Game model shared by the Classic and Setup Chess variants: a Board plus the
// SAN move list, navigation snapshots, result detection and PGN export.
import {
  Board, WHITE, BLACK, PAWN, KING, QUEEN,
  FLAG_CAPTURE, FLAG_EP, FLAG_PROMO, FLAG_KCASTLE, FLAG_QCASTLE,
  moveFrom, moveTo, moveFlags, movePromo,
  pieceType, pieceColor, squareName, parseSquare, START_FEN
} from '../engine/board.js'
import { moveToSan, findMove, uciToMove } from '../engine/notation.js'
import { SEE_VALUE } from '../engine/eval.js'

const TYPE_CHARS = ['', 'p', 'n', 'b', 'r', 'q', 'k']
export const colorLetter = (color) => (color === WHITE ? 'w' : 'b')

export function positionKeyOf (board) {
  return ((board.keyHi >>> 0).toString(16).padStart(8, '0')) + ((board.keyLo >>> 0).toString(16).padStart(8, '0'))
}

export class Game {
  constructor (startFen = START_FEN, variant = 'classic') {
    this.variant = variant
    this.startFen = startFen
    this.board = new Board(startFen)
    this.moves = []
  }

  get turn () { return colorLetter(this.board.turn) }
  get ply () { return this.moves.length }
  fen () { return this.board.fen() }
  positionKey () { return positionKeyOf(this.board) }
  uciHistory () { return this.moves.map((m) => m.uci) }

  pieceAt (square) {
    const sq = typeof square === 'string' ? parseSquare(square) : square
    const piece = this.board.squares[sq]
    if (!piece) return null
    return colorLetter(pieceColor(piece)) + TYPE_CHARS[pieceType(piece)]
  }

  // [{ to, capture, promotion, castle }]
  legalTargets (square) {
    const from = typeof square === 'string' ? parseSquare(square) : square
    const seen = new Map()
    for (const move of this.board.legalMoves()) {
      if (moveFrom(move) !== from) continue
      const to = squareName(moveTo(move))
      const flags = moveFlags(move)
      const existing = seen.get(to) || { to, capture: false, promotion: false, castle: false }
      if (flags & FLAG_CAPTURE) existing.capture = true
      if (flags & FLAG_PROMO) existing.promotion = true
      if (flags & (FLAG_KCASTLE | FLAG_QCASTLE)) existing.castle = true
      seen.set(to, existing)
    }
    return [...seen.values()]
  }

  needsPromotion (from, to) {
    const fromSq = typeof from === 'string' ? parseSquare(from) : from
    const toSq = typeof to === 'string' ? parseSquare(to) : to
    for (const move of this.board.legalMoves()) {
      if (moveFrom(move) === fromSq && moveTo(move) === toSq && (moveFlags(move) & FLAG_PROMO)) return true
    }
    return false
  }

  play (from, to, promotion = QUEEN) {
    const move = typeof from === 'string' && to === undefined
      ? uciToMove(this.board, from)
      : findMove(this.board, from, to, promotion)
    if (!move) return null
    return this.applyMove(move)
  }

  applyMove (move) {
    const flags = moveFlags(move)
    const fromSq = moveFrom(move)
    const toSq = moveTo(move)
    const piece = this.board.squares[fromSq]
    const capturedSquare = (flags & FLAG_EP)
      ? (pieceColor(piece) === WHITE ? toSq - 16 : toSq + 16)
      : toSq
    const capturedPiece = (flags & FLAG_CAPTURE) ? this.board.squares[capturedSquare] : 0
    const positionBefore = this.positionKey()
    const san = moveToSan(this.board, move)
    if (!this.board.makeMove(move)) return null
    const record = {
      uci: squareName(fromSq) + squareName(toSq) + (movePromo(move) ? TYPE_CHARS[movePromo(move)] : ''),
      san,
      from: squareName(fromSq),
      to: squareName(toSq),
      color: colorLetter(pieceColor(piece)),
      piece: TYPE_CHARS[pieceType(piece)],
      captured: capturedPiece ? TYPE_CHARS[pieceType(capturedPiece)] : null,
      capturedColor: capturedPiece ? colorLetter(pieceColor(capturedPiece)) : null,
      promotion: movePromo(move) ? TYPE_CHARS[movePromo(move)] : null,
      castle: (flags & FLAG_KCASTLE) ? 'k' : (flags & FLAG_QCASTLE) ? 'q' : null,
      enPassant: (flags & FLAG_EP) !== 0,
      check: this.board.inCheck(),
      positionBefore,
      fenAfter: this.board.fen()
    }
    record.mate = record.check && !this.board.hasLegalMove()
    this.moves.push(record)
    return record
  }

  undo () {
    if (!this.moves.length) return null
    this.board.undoMove()
    return this.moves.pop()
  }

  lastMove () { return this.moves.length ? this.moves[this.moves.length - 1] : null }

  boardAt (ply) {
    const board = new Board(this.startFen)
    const limit = Math.max(0, Math.min(ply, this.moves.length))
    for (let i = 0; i < limit; i++) {
      const move = uciToMove(board, this.moves[i].uci)
      if (!move) break
      board.makeMove(move)
    }
    return board
  }

  // { over, result: 'w' | 'b' | 'draw' | null, reason }
  outcome () {
    const state = this.board.outcome()
    if (!state) return { over: false, result: null, reason: null }
    if (state === 'checkmate') {
      return { over: true, result: this.board.turn === WHITE ? 'b' : 'w', reason: 'checkmate' }
    }
    if (state === 'king-captured') {
      const missing = this.board.kings[WHITE] === -1 ? 'b' : 'w'
      return { over: true, result: missing, reason: 'king captured' }
    }
    const reasons = { stalemate: 'stalemate', fifty: 'the fifty-move rule', repetition: 'repetition', material: 'insufficient material' }
    return { over: true, result: 'draw', reason: reasons[state] || 'a draw' }
  }

  inCheck () { return this.board.inCheck() }

  kingSquare (color) {
    const sq = this.board.kings[color === 'w' ? WHITE : BLACK]
    return sq === -1 ? null : squareName(sq)
  }

  // Material still missing from each side, plus the point advantage.
  captured () {
    const start = new Board(this.startFen)
    const startCount = countPieces(start)
    const nowCount = countPieces(this.board)
    const lost = { w: [], b: [] }
    let advantage = 0
    for (const color of ['w', 'b']) {
      for (const type of ['q', 'r', 'b', 'n', 'p']) {
        const missing = (startCount[color][type] || 0) - (nowCount[color][type] || 0)
        for (let i = 0; i < missing; i++) lost[color].push(type)
      }
    }
    for (const type of lost.b) advantage += SEE_VALUE[TYPE_CHARS.indexOf(type)] / 100
    for (const type of lost.w) advantage -= SEE_VALUE[TYPE_CHARS.indexOf(type)] / 100
    return { lost, advantage: Math.round(advantage) }
  }

  pgn (headers = {}) {
    const tags = {
      Event: headers.event || 'ForgeChess',
      Site: headers.site || 'forgechess.vercel.app',
      Date: headers.date || new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      White: headers.white || 'White',
      Black: headers.black || 'Black',
      Variant: this.variant === 'setup' ? 'Setup Chess' : 'Standard',
      Result: headers.result || '*'
    }
    if (this.startFen !== START_FEN) { tags.SetUp = '1'; tags.FEN = this.startFen }
    const lines = Object.entries(tags).map(([key, value]) => `[${key} "${value}"]`)
    let body = ''
    for (let i = 0; i < this.moves.length; i++) {
      if (i % 2 === 0) body += `${i / 2 + 1}. `
      body += `${this.moves[i].san} `
    }
    return `${lines.join('\n')}\n\n${body.trim()} ${tags.Result}`.trim()
  }
}

function countPieces (board) {
  const counts = { w: {}, b: {} }
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue }
    const piece = board.squares[sq]
    if (!piece) continue
    const type = pieceType(piece)
    if (type === KING) continue
    const color = colorLetter(pieceColor(piece))
    const char = TYPE_CHARS[type]
    counts[color][char] = (counts[color][char] || 0) + 1
  }
  return counts
}

export { PAWN, QUEEN, START_FEN }
