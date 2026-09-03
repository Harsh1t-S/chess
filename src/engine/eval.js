// Tapered evaluation: PeSTO piece-square tables plus pawn structure, mobility,
// rook placement, bishop pair and king shelter terms.
import {
  WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
  pieceType, pieceColor, fileOf, rankOf, onBoard, encode, NO_SQUARE
} from './board.js'

export const MATE_SCORE = 32000
export const MATE_IN_MAX = MATE_SCORE - 1000

const MG_VALUE = [0, 82, 337, 365, 477, 1025, 0]
const EG_VALUE = [0, 94, 281, 297, 512, 936, 0]
export const SEE_VALUE = [0, 100, 320, 330, 500, 900, 20000]

const PHASE_WEIGHT = [0, 0, 1, 1, 2, 4, 0]
const TOTAL_PHASE = 24

// Tables are written from a8 down to h1, so index = (7 - rank) * 8 + file.
const MG_PAWN = [
  0, 0, 0, 0, 0, 0, 0, 0,
  98, 134, 61, 95, 68, 126, 34, -11,
  -6, 7, 26, 31, 65, 56, 25, -20,
  -14, 13, 6, 21, 23, 12, 17, -23,
  -27, -2, -5, 12, 17, 6, 10, -25,
  -26, -4, -4, -10, 3, 3, 33, -12,
  -35, -1, -20, -23, -15, 24, 38, -22,
  0, 0, 0, 0, 0, 0, 0, 0
]
const EG_PAWN = [
  0, 0, 0, 0, 0, 0, 0, 0,
  178, 173, 158, 134, 147, 132, 165, 187,
  94, 100, 85, 67, 56, 53, 82, 84,
  32, 24, 13, 5, -2, 4, 17, 17,
  13, 9, -3, -7, -7, -8, 3, -1,
  4, 7, -6, 1, 0, -5, -1, -8,
  13, 8, 8, 10, 13, 0, 2, -7,
  0, 0, 0, 0, 0, 0, 0, 0
]
const MG_KNIGHT = [
  -167, -89, -34, -49, 61, -97, -15, -107,
  -73, -41, 72, 36, 23, 62, 7, -17,
  -47, 60, 37, 65, 84, 129, 73, 44,
  -9, 17, 19, 53, 37, 69, 18, 22,
  -13, 4, 16, 13, 28, 19, 21, -8,
  -23, -9, 12, 10, 19, 17, 25, -16,
  -29, -53, -12, -3, -1, 18, -14, -19,
  -105, -21, -58, -33, -17, -28, -19, -23
]
const EG_KNIGHT = [
  -58, -38, -13, -28, -31, -27, -63, -99,
  -25, -8, -25, -2, -9, -25, -24, -52,
  -24, -20, 10, 9, -1, -9, -19, -41,
  -17, 3, 22, 22, 22, 11, 8, -18,
  -18, -6, 16, 25, 16, 17, 4, -18,
  -23, -3, -1, 15, 10, -3, -20, -22,
  -42, -20, -10, -5, -2, -20, -23, -44,
  -29, -51, -23, -15, -22, -18, -50, -64
]
const MG_BISHOP = [
  -29, 4, -82, -37, -25, -42, 7, -8,
  -26, 16, -18, -13, 30, 59, 18, -47,
  -16, 37, 43, 40, 35, 50, 37, -2,
  -4, 5, 19, 50, 37, 37, 7, -2,
  -6, 13, 13, 26, 34, 12, 10, 4,
  0, 15, 15, 15, 14, 27, 18, 10,
  4, 15, 16, 0, 7, 21, 33, 1,
  -33, -3, -14, -21, -13, -12, -39, -21
]
const EG_BISHOP = [
  -14, -21, -11, -8, -7, -9, -17, -24,
  -8, -4, 7, -12, -3, -13, -4, -14,
  2, -8, 0, -1, -2, 6, 0, 4,
  -3, 9, 12, 9, 14, 10, 3, 2,
  -6, 3, 13, 19, 7, 10, -3, -9,
  -12, -3, 8, 10, 13, 3, -7, -15,
  -14, -18, -7, -1, 4, -9, -15, -27,
  -23, -9, -23, -5, -9, -16, -5, -17
]
const MG_ROOK = [
  32, 42, 32, 51, 63, 9, 31, 43,
  27, 32, 58, 62, 80, 67, 26, 44,
  -5, 19, 26, 36, 17, 45, 61, 16,
  -24, -11, 7, 26, 24, 35, -8, -20,
  -36, -26, -12, -1, 9, -7, 6, -23,
  -45, -25, -16, -17, 3, 0, -5, -33,
  -44, -16, -20, -9, -1, 11, -6, -71,
  -19, -13, 1, 17, 16, 7, -37, -26
]
const EG_ROOK = [
  13, 10, 18, 15, 12, 12, 8, 5,
  11, 13, 13, 11, -3, 3, 8, 3,
  7, 7, 7, 5, 4, -3, -5, -3,
  4, 3, 13, 1, 2, 1, -1, 2,
  3, 5, 8, 4, -5, -6, -8, -11,
  -4, 0, -5, -1, -7, -12, -8, -16,
  -6, -6, 0, 2, -9, -9, -11, -3,
  -9, 2, 3, -1, -5, -13, 4, -20
]
const MG_QUEEN = [
  -28, 0, 29, 12, 59, 44, 43, 45,
  -24, -39, -5, 1, -16, 57, 28, 54,
  -13, -17, 7, 8, 29, 56, 47, 57,
  -27, -27, -16, -16, -1, 17, -2, 1,
  -9, -26, -9, -10, -2, -4, 3, -3,
  -14, 2, -11, -2, -5, 2, 14, 5,
  -35, -8, 11, 2, 8, 15, -3, 1,
  -1, -18, -9, 10, -15, -25, -31, -50
]
const EG_QUEEN = [
  -9, 22, 22, 27, 27, 19, 10, 20,
  -17, 20, 32, 41, 58, 25, 30, 0,
  -20, 6, 9, 49, 47, 35, 19, 9,
  3, 22, 24, 45, 57, 40, 57, 36,
  -18, 28, 19, 47, 31, 34, 39, 23,
  -16, -27, 15, 6, 9, 17, 10, 5,
  -22, -23, -30, -16, -16, -23, -36, -32,
  -33, -28, -22, -43, -5, -32, -20, -41
]
const MG_KING = [
  -65, 23, 16, -15, -56, -34, 2, 13,
  29, -1, -20, -7, -8, -4, -38, -29,
  -9, 24, 2, -16, -20, 6, 22, -22,
  -17, -20, -12, -27, -30, -25, -14, -36,
  -49, -1, -27, -39, -46, -44, -33, -51,
  -14, -14, -22, -46, -44, -30, -15, -27,
  1, 7, -8, -64, -43, -16, 9, 8,
  -15, 36, 12, -54, 8, -28, 24, 14
]
const EG_KING = [
  -74, -35, -18, -18, -11, 15, 4, -17,
  -12, 17, 14, 17, 17, 38, 23, 11,
  10, 17, 23, 15, 20, 45, 44, 13,
  -8, 22, 24, 27, 26, 33, 26, 3,
  -18, -4, 21, 24, 27, 23, 9, -11,
  -19, -3, 11, 21, 23, 16, 7, -9,
  -27, -11, 4, 13, 14, 4, -5, -17,
  -53, -34, -21, -11, -28, -14, -24, -43
]

const MG_TABLES = [null, MG_PAWN, MG_KNIGHT, MG_BISHOP, MG_ROOK, MG_QUEEN, MG_KING]
const EG_TABLES = [null, EG_PAWN, EG_KNIGHT, EG_BISHOP, EG_ROOK, EG_QUEEN, EG_KING]

// Flatten to [pieceCode][0x88 square] so the eval loop is a pair of lookups.
const MG_PST = new Int32Array(16 * 128)
const EG_PST = new Int32Array(16 * 128)
for (let type = PAWN; type <= KING; type++) {
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue
    const file = fileOf(sq)
    const rank = rankOf(sq)
    const whiteIndex = (7 - rank) * 8 + file
    const blackIndex = rank * 8 + file
    MG_PST[encode(type, WHITE) * 128 + sq] = MG_VALUE[type] + MG_TABLES[type][whiteIndex]
    EG_PST[encode(type, WHITE) * 128 + sq] = EG_VALUE[type] + EG_TABLES[type][whiteIndex]
    MG_PST[encode(type, BLACK) * 128 + sq] = MG_VALUE[type] + MG_TABLES[type][blackIndex]
    EG_PST[encode(type, BLACK) * 128 + sq] = EG_VALUE[type] + EG_TABLES[type][blackIndex]
  }
}

const KNIGHT_OFFSETS = [-33, -31, -18, -14, 14, 18, 31, 33]
const BISHOP_OFFSETS = [-17, -15, 15, 17]
const ROOK_OFFSETS = [-16, -1, 1, 16]
const KING_OFFSETS = [-17, -16, -15, -1, 1, 15, 16, 17]

const PASSED_BONUS = [0, 8, 16, 32, 62, 105, 168, 260]
const DOUBLED_PENALTY = 14
const ISOLATED_PENALTY = 16
const BISHOP_PAIR = 32
const ROOK_OPEN_FILE = 26
const ROOK_SEMI_OPEN = 12
const SHIELD_BONUS = 11
const TEMPO = 12
const MOBILITY = [0, 0, 4, 4, 3, 2, 0]

// Scratch buffers reused across calls: evaluate() runs at every leaf, so it
// must not allocate.
const pawnFileCount = [new Int8Array(8), new Int8Array(8)]
const pawnMaxRank = [new Int8Array(8), new Int8Array(8)]
const pawnMinRank = [new Int8Array(8), new Int8Array(8)]
const pawnList = [new Int32Array(32), new Int32Array(32)]
const pawnTotal = new Int32Array(2)
const bishopCount = new Int32Array(2)

// Score from the side-to-move's point of view, in centipawns.
export function evaluate (board) {
  const squares = board.squares
  let mg = 0
  let eg = 0
  let phase = 0

  pawnFileCount[WHITE].fill(0); pawnFileCount[BLACK].fill(0)
  pawnMaxRank[WHITE].fill(-1); pawnMaxRank[BLACK].fill(-1)
  pawnMinRank[WHITE].fill(8); pawnMinRank[BLACK].fill(8)
  pawnTotal[WHITE] = 0; pawnTotal[BLACK] = 0
  bishopCount[WHITE] = 0; bishopCount[BLACK] = 0

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue }
    const piece = squares[sq]
    if (!piece) continue
    const color = piece >> 3
    const type = piece & 7
    const idx = piece * 128 + sq
    if (color === WHITE) { mg += MG_PST[idx]; eg += EG_PST[idx] } else { mg -= MG_PST[idx]; eg -= EG_PST[idx] }
    phase += PHASE_WEIGHT[type]
    if (type === BISHOP) bishopCount[color]++
    else if (type === PAWN) {
      const file = sq & 7
      const rank = sq >> 4
      pawnFileCount[color][file]++
      if (rank > pawnMaxRank[color][file]) pawnMaxRank[color][file] = rank
      if (rank < pawnMinRank[color][file]) pawnMinRank[color][file] = rank
      if (pawnTotal[color] < 32) pawnList[color][pawnTotal[color]++] = sq
    }
  }

  for (let color = 0; color <= 1; color++) {
    const sign = color === WHITE ? 1 : -1
    const enemy = color ^ 1
    let structure = 0

    if (bishopCount[color] >= 2) structure += BISHOP_PAIR

    for (let file = 0; file < 8; file++) {
      const own = pawnFileCount[color][file]
      if (!own) continue
      if (own > 1) structure -= DOUBLED_PENALTY * (own - 1)
      const left = file > 0 ? pawnFileCount[color][file - 1] : 0
      const right = file < 7 ? pawnFileCount[color][file + 1] : 0
      if (!left && !right) structure -= ISOLATED_PENALTY * own
    }

    const count = pawnTotal[color]
    for (let i = 0; i < count; i++) {
      const sq = pawnList[color][i]
      const file = sq & 7
      const rank = sq >> 4
      const from = file > 0 ? file - 1 : 0
      const to = file < 7 ? file + 1 : 7
      let passed = true
      for (let f = from; f <= to; f++) {
        if (color === WHITE ? pawnMaxRank[enemy][f] > rank : pawnMinRank[enemy][f] < rank) { passed = false; break }
      }
      if (passed) structure += PASSED_BONUS[color === WHITE ? rank : 7 - rank]
    }

    const king = board.kings[color]
    if (king !== NO_SQUARE) {
      const forward = color === WHITE ? 16 : -16
      const shieldPawn = encode(PAWN, color)
      for (let df = -1; df <= 1; df++) {
        const shield = king + forward + df
        if (onBoard(shield) && squares[shield] === shieldPawn) structure += SHIELD_BONUS
      }
    }

    mg += sign * structure
    eg += sign * structure
  }

  // Mobility and rook files.
  let mobilityMg = 0
  let mobilityEg = 0
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue }
    const piece = squares[sq]
    if (!piece) continue
    const type = piece & 7
    if (type === PAWN || type === KING) continue
    const color = piece >> 3
    const sign = color === WHITE ? 1 : -1
    let moves = 0
    if (type === KNIGHT) {
      for (let i = 0; i < 8; i++) {
        const to = sq + KNIGHT_OFFSETS[i]
        if (!(to & 0x88) && (!squares[to] || (squares[to] >> 3) !== color)) moves++
      }
    } else {
      const offsets = type === BISHOP ? BISHOP_OFFSETS : type === ROOK ? ROOK_OFFSETS : KING_OFFSETS
      for (let i = 0; i < offsets.length; i++) {
        const step = offsets[i]
        for (let to = sq + step; !(to & 0x88); to += step) {
          const target = squares[to]
          if (!target) { moves++; continue }
          if ((target >> 3) !== color) moves++
          break
        }
      }
    }
    const bonus = sign * (moves - 4) * MOBILITY[type]
    mobilityMg += bonus
    mobilityEg += (bonus * 3) >> 2
    if (type === ROOK) {
      const file = sq & 7
      const own = pawnFileCount[color][file]
      const theirs = pawnFileCount[color ^ 1][file]
      if (!own && !theirs) { mobilityMg += sign * ROOK_OPEN_FILE; mobilityEg += sign * ROOK_OPEN_FILE }
      else if (!own) { mobilityMg += sign * ROOK_SEMI_OPEN; mobilityEg += sign * ROOK_SEMI_OPEN }
    }
  }
  mg += mobilityMg
  eg += mobilityEg

  const clamped = phase > TOTAL_PHASE ? TOTAL_PHASE : phase
  const score = ((mg * clamped) + (eg * (TOTAL_PHASE - clamped))) / TOTAL_PHASE
  const white = Math.round(score)
  return (board.turn === WHITE ? white : -white) + TEMPO
}

// Static exchange evaluation: is capturing on `to` worth at least `threshold`?
export function see (board, from, to, threshold = 0) {
  const squares = board.squares
  const target = squares[to]
  let gain = target ? SEE_VALUE[pieceType(target)] : 0
  if (gain < threshold) return false
  let attacker = squares[from]
  gain -= SEE_VALUE[pieceType(attacker)]
  if (gain >= threshold) return true

  // Full swap-off simulation using make/unmake would be costly here; a single
  // recapture probe catches the common hanging-piece cases cheaply.
  const defender = board.turn ^ 1
  if (!attackersOf(board, to, defender)) return true
  return gain >= threshold
}

function attackersOf (board, target, byColor) {
  const squares = board.squares
  const pawn = encode(PAWN, byColor)
  const dir = byColor === WHITE ? -16 : 16
  for (const df of [-1, 1]) {
    const from = target + dir + df
    if (onBoard(from) && squares[from] === pawn) return true
  }
  const knight = encode(KNIGHT, byColor)
  for (let i = 0; i < 8; i++) {
    const from = target + KNIGHT_OFFSETS[i]
    if (onBoard(from) && squares[from] === knight) return true
  }
  const king = encode(KING, byColor)
  for (let i = 0; i < 8; i++) {
    const from = target + KING_OFFSETS[i]
    if (onBoard(from) && squares[from] === king) return true
  }
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

export function hasNonPawnMaterial (board, color) {
  const squares = board.squares
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue }
    const piece = squares[sq]
    if (!piece || pieceColor(piece) !== color) continue
    const type = pieceType(piece)
    if (type !== PAWN && type !== KING) return true
  }
  return false
}

export function materialCount (board) {
  const totals = { w: 0, b: 0 }
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue }
    const piece = board.squares[sq]
    if (!piece) continue
    const type = pieceType(piece)
    if (type === KING) continue
    totals[pieceColor(piece) === WHITE ? 'w' : 'b'] += SEE_VALUE[type]
  }
  return totals
}
