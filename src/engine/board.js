// 0x88 board representation with make/unmake, Zobrist hashing and full legal
// move generation. Written to replace chess.js inside the search hot loop, and
// to tolerate the non-standard start positions that Setup Chess produces.

export const WHITE = 0
export const BLACK = 1

export const EMPTY = 0
export const PAWN = 1
export const KNIGHT = 2
export const BISHOP = 3
export const ROOK = 4
export const QUEEN = 5
export const KING = 6

export const CASTLE_WK = 1
export const CASTLE_WQ = 2
export const CASTLE_BK = 4
export const CASTLE_BQ = 8

export const FLAG_CAPTURE = 1
export const FLAG_EP = 2
export const FLAG_DOUBLE = 4
export const FLAG_KCASTLE = 8
export const FLAG_QCASTLE = 16
export const FLAG_PROMO = 32

export const NO_SQUARE = -1

const MAX_HISTORY = 1024
const STACK_WIDTH = 10

const PIECE_CHARS = ['', 'p', 'n', 'b', 'r', 'q', 'k']
const CHAR_PIECES = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING }

const KNIGHT_OFFSETS = [-33, -31, -18, -14, 14, 18, 31, 33]
const BISHOP_OFFSETS = [-17, -15, 15, 17]
const ROOK_OFFSETS = [-16, -1, 1, 16]
const KING_OFFSETS = [-17, -16, -15, -1, 1, 15, 16, 17]

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export const encode = (type, color) => type | (color << 3)
export const pieceType = (p) => p & 7
export const pieceColor = (p) => p >> 3
export const onBoard = (sq) => (sq & 0x88) === 0
export const rankOf = (sq) => sq >> 4
export const fileOf = (sq) => sq & 7
export const squareName = (sq) => 'abcdefgh'[fileOf(sq)] + (rankOf(sq) + 1)
export const parseSquare = (name) => {
  const file = name.charCodeAt(0) - 97
  const rank = name.charCodeAt(1) - 49
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return NO_SQUARE
  return rank * 16 + file
}

// --- move packing -----------------------------------------------------------
// from(7) | to(7) | promotion(3) | flags(6)
export const makeMove = (from, to, promo, flags) => from | (to << 7) | (promo << 14) | (flags << 17)
export const moveFrom = (m) => m & 0x7f
export const moveTo = (m) => (m >> 7) & 0x7f
export const movePromo = (m) => (m >> 14) & 7
export const moveFlags = (m) => (m >> 17) & 0x3f

export function moveToUci (m) {
  const promo = movePromo(m)
  return squareName(moveFrom(m)) + squareName(moveTo(m)) + (promo ? PIECE_CHARS[promo] : '')
}

// --- Zobrist ----------------------------------------------------------------
// Two 32-bit halves so the whole 64-bit key survives JS bitwise ops.
function xorshift32 (seed) {
  let x = seed | 0
  return () => {
    x ^= x << 13; x |= 0
    x ^= x >>> 17
    x ^= x << 5; x |= 0
    return x | 0
  }
}

const rng = xorshift32(0x1a2b3c4d)
const PIECE_KEY_LO = new Int32Array(16 * 128)
const PIECE_KEY_HI = new Int32Array(16 * 128)
const CASTLE_KEY_LO = new Int32Array(16)
const CASTLE_KEY_HI = new Int32Array(16)
const EP_KEY_LO = new Int32Array(8)
const EP_KEY_HI = new Int32Array(8)
const TURN_KEY_LO = rng()
const TURN_KEY_HI = rng()

for (let i = 0; i < PIECE_KEY_LO.length; i++) { PIECE_KEY_LO[i] = rng(); PIECE_KEY_HI[i] = rng() }
for (let i = 0; i < 16; i++) { CASTLE_KEY_LO[i] = rng(); CASTLE_KEY_HI[i] = rng() }
for (let i = 0; i < 8; i++) { EP_KEY_LO[i] = rng(); EP_KEY_HI[i] = rng() }

// Castling rights that survive a move touching a given square.
const CASTLE_MASK = new Int32Array(128).fill(15)
CASTLE_MASK[parseSquare('a1')] &= ~CASTLE_WQ
CASTLE_MASK[parseSquare('h1')] &= ~CASTLE_WK
CASTLE_MASK[parseSquare('e1')] &= ~(CASTLE_WK | CASTLE_WQ)
CASTLE_MASK[parseSquare('a8')] &= ~CASTLE_BQ
CASTLE_MASK[parseSquare('h8')] &= ~CASTLE_BK
CASTLE_MASK[parseSquare('e8')] &= ~(CASTLE_BK | CASTLE_BQ)

export class Board {
  constructor (fen = START_FEN) {
    this.squares = new Int8Array(128)
    this.turn = WHITE
    this.castling = 0
    this.ep = NO_SQUARE
    this.halfMoves = 0
    this.moveNumber = 1
    this.keyLo = 0
    this.keyHi = 0
    this.kings = [NO_SQUARE, NO_SQUARE]
    this.stack = new Int32Array(MAX_HISTORY * STACK_WIDTH)
    this.ply = 0
    this.repetition = []
    this.setFen(fen)
  }

  clone () {
    const b = Object.create(Board.prototype)
    b.squares = this.squares.slice()
    b.turn = this.turn
    b.castling = this.castling
    b.ep = this.ep
    b.halfMoves = this.halfMoves
    b.moveNumber = this.moveNumber
    b.keyLo = this.keyLo
    b.keyHi = this.keyHi
    b.kings = this.kings.slice()
    b.stack = new Int32Array(MAX_HISTORY * STACK_WIDTH)
    b.ply = 0
    b.repetition = this.repetition.slice()
    return b
  }

  setFen (fen) {
    this.squares.fill(EMPTY)
    this.kings = [NO_SQUARE, NO_SQUARE]
    if (!this.stack) this.stack = new Int32Array(MAX_HISTORY * STACK_WIDTH)
    this.ply = 0
    this.repetition = []
    const parts = fen.trim().split(/\s+/)
    const rows = parts[0].split('/')
    for (let r = 0; r < 8; r++) {
      const row = rows[r] || '8'
      let file = 0
      for (const ch of row) {
        if (ch >= '1' && ch <= '9') { file += Number(ch); continue }
        const lower = ch.toLowerCase()
        const type = CHAR_PIECES[lower]
        if (!type || file > 7) continue
        const color = ch === lower ? BLACK : WHITE
        const sq = (7 - r) * 16 + file
        this.squares[sq] = encode(type, color)
        if (type === KING) this.kings[color] = sq
        file++
      }
    }
    this.turn = parts[1] === 'b' ? BLACK : WHITE
    this.castling = 0
    const rights = parts[2] || '-'
    if (rights.includes('K')) this.castling |= CASTLE_WK
    if (rights.includes('Q')) this.castling |= CASTLE_WQ
    if (rights.includes('k')) this.castling |= CASTLE_BK
    if (rights.includes('q')) this.castling |= CASTLE_BQ
    this.ep = parts[3] && parts[3] !== '-' ? parseSquare(parts[3]) : NO_SQUARE
    this.halfMoves = Number(parts[4] || 0) || 0
    this.moveNumber = Number(parts[5] || 1) || 1
    this.computeKey()
    this.repetition.push(this.keyLo ^ this.keyHi)
    return this
  }

  fen () {
    const rows = []
    for (let r = 7; r >= 0; r--) {
      let row = ''
      let empty = 0
      for (let f = 0; f < 8; f++) {
        const piece = this.squares[r * 16 + f]
        if (!piece) { empty++; continue }
        if (empty) { row += empty; empty = 0 }
        const ch = PIECE_CHARS[pieceType(piece)]
        row += pieceColor(piece) === WHITE ? ch.toUpperCase() : ch
      }
      if (empty) row += empty
      rows.push(row)
    }
    let rights = ''
    if (this.castling & CASTLE_WK) rights += 'K'
    if (this.castling & CASTLE_WQ) rights += 'Q'
    if (this.castling & CASTLE_BK) rights += 'k'
    if (this.castling & CASTLE_BQ) rights += 'q'
    return [
      rows.join('/'),
      this.turn === WHITE ? 'w' : 'b',
      rights || '-',
      this.ep === NO_SQUARE ? '-' : squareName(this.ep),
      this.halfMoves,
      this.moveNumber
    ].join(' ')
  }

  computeKey () {
    let lo = 0
    let hi = 0
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue }
      const piece = this.squares[sq]
      if (!piece) continue
      const idx = piece * 128 + sq
      lo ^= PIECE_KEY_LO[idx]
      hi ^= PIECE_KEY_HI[idx]
    }
    lo ^= CASTLE_KEY_LO[this.castling]
    hi ^= CASTLE_KEY_HI[this.castling]
    if (this.ep !== NO_SQUARE) { lo ^= EP_KEY_LO[fileOf(this.ep)]; hi ^= EP_KEY_HI[fileOf(this.ep)] }
    if (this.turn === BLACK) { lo ^= TURN_KEY_LO; hi ^= TURN_KEY_HI }
    this.keyLo = lo | 0
    this.keyHi = hi | 0
  }

  hashPiece (piece, sq) {
    const idx = piece * 128 + sq
    this.keyLo ^= PIECE_KEY_LO[idx]
    this.keyHi ^= PIECE_KEY_HI[idx]
  }

  // --- attacks --------------------------------------------------------------
  isAttacked (target, byColor) {
    const squares = this.squares
    // pawns
    const pawn = encode(PAWN, byColor)
    const dir = byColor === WHITE ? -16 : 16
    for (const df of [-1, 1]) {
      const from = target + dir + df
      if (onBoard(from) && squares[from] === pawn) return true
    }
    // knights
    const knight = encode(KNIGHT, byColor)
    for (let i = 0; i < 8; i++) {
      const from = target + KNIGHT_OFFSETS[i]
      if (onBoard(from) && squares[from] === knight) return true
    }
    // king
    const king = encode(KING, byColor)
    for (let i = 0; i < 8; i++) {
      const from = target + KING_OFFSETS[i]
      if (onBoard(from) && squares[from] === king) return true
    }
    // bishops / queens
    const bishop = encode(BISHOP, byColor)
    const queen = encode(QUEEN, byColor)
    for (let i = 0; i < 4; i++) {
      const step = BISHOP_OFFSETS[i]
      for (let sq = target + step; onBoard(sq); sq += step) {
        const piece = squares[sq]
        if (!piece) continue
        if (piece === bishop || piece === queen) return true
        break
      }
    }
    // rooks / queens
    const rook = encode(ROOK, byColor)
    for (let i = 0; i < 4; i++) {
      const step = ROOK_OFFSETS[i]
      for (let sq = target + step; onBoard(sq); sq += step) {
        const piece = squares[sq]
        if (!piece) continue
        if (piece === rook || piece === queen) return true
        break
      }
    }
    return false
  }

  inCheck (color = this.turn) {
    const king = this.kings[color]
    if (king === NO_SQUARE) return false
    return this.isAttacked(king, color ^ 1)
  }

  // True when the side that just moved left the enemy king capturable, which
  // Setup Chess positions can produce. Search treats it as an immediate win.
  opponentKingExposed () {
    const enemy = this.turn ^ 1
    const king = this.kings[enemy]
    if (king === NO_SQUARE) return true
    return this.isAttacked(king, this.turn)
  }

  // --- move generation ------------------------------------------------------
  generate (capturesOnly = false, out = null) {
    const moves = out || []
    moves.length = 0
    const squares = this.squares
    const us = this.turn
    const them = us ^ 1
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue }
      const piece = squares[sq]
      if (!piece || pieceColor(piece) !== us) continue
      const type = pieceType(piece)
      if (type === PAWN) { this.genPawn(sq, us, them, moves, capturesOnly); continue }
      if (type === KNIGHT) { this.genStep(sq, KNIGHT_OFFSETS, them, moves, capturesOnly); continue }
      if (type === KING) { this.genStep(sq, KING_OFFSETS, them, moves, capturesOnly); continue }
      if (type === BISHOP) { this.genSlide(sq, BISHOP_OFFSETS, them, moves, capturesOnly); continue }
      if (type === ROOK) { this.genSlide(sq, ROOK_OFFSETS, them, moves, capturesOnly); continue }
      if (type === QUEEN) { this.genSlide(sq, KING_OFFSETS, them, moves, capturesOnly) }
    }
    if (!capturesOnly) this.genCastles(us, moves)
    return moves
  }

  genStep (from, offsets, them, moves, capturesOnly) {
    const squares = this.squares
    for (let i = 0; i < offsets.length; i++) {
      const to = from + offsets[i]
      if (!onBoard(to)) continue
      const target = squares[to]
      if (!target) {
        if (!capturesOnly) moves.push(makeMove(from, to, 0, 0))
      } else if (pieceColor(target) === them) {
        moves.push(makeMove(from, to, 0, FLAG_CAPTURE))
      }
    }
  }

  genSlide (from, offsets, them, moves, capturesOnly) {
    const squares = this.squares
    for (let i = 0; i < offsets.length; i++) {
      const step = offsets[i]
      for (let to = from + step; onBoard(to); to += step) {
        const target = squares[to]
        if (!target) {
          if (!capturesOnly) moves.push(makeMove(from, to, 0, 0))
          continue
        }
        if (pieceColor(target) === them) moves.push(makeMove(from, to, 0, FLAG_CAPTURE))
        break
      }
    }
  }

  genPawn (from, us, them, moves, capturesOnly) {
    const squares = this.squares
    const dir = us === WHITE ? 16 : -16
    const startRank = us === WHITE ? 1 : 6
    const promoRank = us === WHITE ? 7 : 0
    const one = from + dir
    if (onBoard(one) && !squares[one]) {
      if (rankOf(one) === promoRank) {
        for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) moves.push(makeMove(from, one, promo, FLAG_PROMO))
      } else if (!capturesOnly) {
        moves.push(makeMove(from, one, 0, 0))
        const two = one + dir
        if (rankOf(from) === startRank && onBoard(two) && !squares[two]) moves.push(makeMove(from, two, 0, FLAG_DOUBLE))
      }
    }
    for (const df of [-1, 1]) {
      const to = from + dir + df
      if (!onBoard(to)) continue
      const target = squares[to]
      if (target && pieceColor(target) === them) {
        if (rankOf(to) === promoRank) {
          for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) moves.push(makeMove(from, to, promo, FLAG_PROMO | FLAG_CAPTURE))
        } else {
          moves.push(makeMove(from, to, 0, FLAG_CAPTURE))
        }
      } else if (!target && to === this.ep) {
        moves.push(makeMove(from, to, 0, FLAG_CAPTURE | FLAG_EP))
      }
    }
  }

  genCastles (us, moves) {
    const home = us === WHITE ? 0 : 112
    const king = this.kings[us]
    if (king !== home + 4) return
    const them = us ^ 1
    const kingRight = us === WHITE ? CASTLE_WK : CASTLE_BK
    const queenRight = us === WHITE ? CASTLE_WQ : CASTLE_BQ
    const rook = encode(ROOK, us)
    if ((this.castling & kingRight) && this.squares[home + 7] === rook &&
        !this.squares[home + 5] && !this.squares[home + 6] &&
        !this.isAttacked(home + 4, them) && !this.isAttacked(home + 5, them) && !this.isAttacked(home + 6, them)) {
      moves.push(makeMove(home + 4, home + 6, 0, FLAG_KCASTLE))
    }
    if ((this.castling & queenRight) && this.squares[home] === rook &&
        !this.squares[home + 1] && !this.squares[home + 2] && !this.squares[home + 3] &&
        !this.isAttacked(home + 4, them) && !this.isAttacked(home + 3, them) && !this.isAttacked(home + 2, them)) {
      moves.push(makeMove(home + 4, home + 2, 0, FLAG_QCASTLE))
    }
  }

  legalMoves () {
    const out = []
    for (const move of this.generate()) {
      if (this.makeMove(move)) { this.undoMove(); out.push(move) }
    }
    return out
  }

  // --- make / unmake --------------------------------------------------------
  // Returns false (and fully reverts) when the move leaves our own king in check.
  makeMove (move) {
    const from = moveFrom(move)
    const to = moveTo(move)
    const flags = moveFlags(move)
    const promo = movePromo(move)
    const squares = this.squares
    const piece = squares[from]
    const us = this.turn
    const them = us ^ 1

    let capturedSquare = to
    if (flags & FLAG_EP) capturedSquare = us === WHITE ? to - 16 : to + 16
    const captured = (flags & FLAG_CAPTURE) ? squares[capturedSquare] : EMPTY

    const base = this.ply * STACK_WIDTH
    const stack = this.stack
    stack[base] = move
    stack[base + 1] = captured
    stack[base + 2] = capturedSquare
    stack[base + 3] = this.castling
    stack[base + 4] = this.ep
    stack[base + 5] = this.halfMoves
    stack[base + 6] = this.keyLo
    stack[base + 7] = this.keyHi
    stack[base + 8] = this.kings[WHITE]
    stack[base + 9] = this.kings[BLACK]
    this.ply++

    // clear old ep / castling from the key before mutating them
    if (this.ep !== NO_SQUARE) { this.keyLo ^= EP_KEY_LO[fileOf(this.ep)]; this.keyHi ^= EP_KEY_HI[fileOf(this.ep)] }
    this.keyLo ^= CASTLE_KEY_LO[this.castling]
    this.keyHi ^= CASTLE_KEY_HI[this.castling]

    if (captured) {
      squares[capturedSquare] = EMPTY
      this.hashPiece(captured, capturedSquare)
      if (pieceType(captured) === KING) this.kings[them] = NO_SQUARE
    }

    squares[from] = EMPTY
    this.hashPiece(piece, from)
    const placed = (flags & FLAG_PROMO) ? encode(promo, us) : piece
    squares[to] = placed
    this.hashPiece(placed, to)

    if (pieceType(piece) === KING) this.kings[us] = to

    if (flags & FLAG_KCASTLE) {
      const home = us === WHITE ? 0 : 112
      const rook = squares[home + 7]
      squares[home + 7] = EMPTY
      squares[home + 5] = rook
      this.hashPiece(rook, home + 7)
      this.hashPiece(rook, home + 5)
    } else if (flags & FLAG_QCASTLE) {
      const home = us === WHITE ? 0 : 112
      const rook = squares[home]
      squares[home] = EMPTY
      squares[home + 3] = rook
      this.hashPiece(rook, home)
      this.hashPiece(rook, home + 3)
    }

    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to]
    this.keyLo ^= CASTLE_KEY_LO[this.castling]
    this.keyHi ^= CASTLE_KEY_HI[this.castling]

    this.ep = (flags & FLAG_DOUBLE) ? (us === WHITE ? from + 16 : from - 16) : NO_SQUARE
    if (this.ep !== NO_SQUARE) { this.keyLo ^= EP_KEY_LO[fileOf(this.ep)]; this.keyHi ^= EP_KEY_HI[fileOf(this.ep)] }

    this.halfMoves = (captured || pieceType(piece) === PAWN) ? 0 : this.halfMoves + 1
    if (us === BLACK) this.moveNumber++
    this.turn = them
    this.keyLo ^= TURN_KEY_LO
    this.keyHi ^= TURN_KEY_HI
    this.repetition.push(this.keyLo ^ this.keyHi)

    if (this.inCheck(us)) { this.undoMove(); return false }
    return true
  }

  undoMove () {
    if (this.ply === 0) return
    this.ply--
    this.repetition.pop()
    const base = this.ply * STACK_WIDTH
    const stack = this.stack
    const move = stack[base]
    const captured = stack[base + 1]
    const capturedSquare = stack[base + 2]
    const from = moveFrom(move)
    const to = moveTo(move)
    const flags = moveFlags(move)
    const squares = this.squares
    const us = this.turn ^ 1

    const placed = squares[to]
    squares[to] = EMPTY
    squares[from] = (flags & FLAG_PROMO) ? encode(PAWN, us) : placed
    if (captured) squares[capturedSquare] = captured

    if (flags & FLAG_KCASTLE) {
      const home = us === WHITE ? 0 : 112
      squares[home + 7] = squares[home + 5]
      squares[home + 5] = EMPTY
    } else if (flags & FLAG_QCASTLE) {
      const home = us === WHITE ? 0 : 112
      squares[home] = squares[home + 3]
      squares[home + 3] = EMPTY
    }

    this.castling = stack[base + 3]
    this.ep = stack[base + 4]
    this.halfMoves = stack[base + 5]
    this.keyLo = stack[base + 6]
    this.keyHi = stack[base + 7]
    this.kings[WHITE] = stack[base + 8]
    this.kings[BLACK] = stack[base + 9]
    if (this.turn === WHITE) this.moveNumber--
    this.turn = us
  }

  makeNullMove () {
    const base = this.ply * STACK_WIDTH
    const stack = this.stack
    stack[base] = 0
    stack[base + 1] = EMPTY
    stack[base + 2] = 0
    stack[base + 3] = this.castling
    stack[base + 4] = this.ep
    stack[base + 5] = this.halfMoves
    stack[base + 6] = this.keyLo
    stack[base + 7] = this.keyHi
    stack[base + 8] = this.kings[WHITE]
    stack[base + 9] = this.kings[BLACK]
    this.ply++
    if (this.ep !== NO_SQUARE) { this.keyLo ^= EP_KEY_LO[fileOf(this.ep)]; this.keyHi ^= EP_KEY_HI[fileOf(this.ep)] }
    this.ep = NO_SQUARE
    this.turn ^= 1
    this.keyLo ^= TURN_KEY_LO
    this.keyHi ^= TURN_KEY_HI
    this.halfMoves++
    this.repetition.push(this.keyLo ^ this.keyHi)
  }

  undoNullMove () {
    if (this.ply === 0) return
    this.ply--
    this.repetition.pop()
    const base = this.ply * STACK_WIDTH
    this.castling = this.stack[base + 3]
    this.ep = this.stack[base + 4]
    this.halfMoves = this.stack[base + 5]
    this.keyLo = this.stack[base + 6]
    this.keyHi = this.stack[base + 7]
    this.turn ^= 1
  }

  // --- draw detection -------------------------------------------------------
  isRepetition (needed = 2) {
    const key = this.repetition[this.repetition.length - 1]
    let count = 0
    const limit = Math.max(0, this.repetition.length - 1 - this.halfMoves)
    for (let i = this.repetition.length - 3; i >= limit; i -= 2) {
      if (this.repetition[i] === key && ++count >= needed - 1) return true
    }
    return false
  }

  insufficientMaterial () {
    let minors = 0
    const bishops = []
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue }
      const piece = this.squares[sq]
      if (!piece) continue
      const type = pieceType(piece)
      if (type === KING) continue
      if (type === PAWN || type === ROOK || type === QUEEN) return false
      minors++
      if (type === BISHOP) bishops.push((fileOf(sq) + rankOf(sq)) & 1)
    }
    if (minors <= 1) return true
    if (minors === bishops.length) return bishops.every((c) => c === bishops[0])
    return false
  }

  hasLegalMove () {
    for (const move of this.generate()) {
      if (this.makeMove(move)) { this.undoMove(); return true }
    }
    return false
  }

  // 'checkmate' | 'stalemate' | 'fifty' | 'repetition' | 'material' | 'king-captured' | null
  outcome () {
    if (this.kings[WHITE] === NO_SQUARE) return 'king-captured'
    if (this.kings[BLACK] === NO_SQUARE) return 'king-captured'
    if (!this.hasLegalMove()) return this.inCheck() ? 'checkmate' : 'stalemate'
    if (this.halfMoves >= 100) return 'fifty'
    if (this.isRepetition(3)) return 'repetition'
    if (this.insufficientMaterial()) return 'material'
    return null
  }
}
