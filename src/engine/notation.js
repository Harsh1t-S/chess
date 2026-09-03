// SAN / UCI conversion on top of the 0x88 board.
import {
  Board, PAWN, KING, KNIGHT, BISHOP, ROOK, QUEEN,
  FLAG_CAPTURE, FLAG_EP, FLAG_KCASTLE, FLAG_QCASTLE, FLAG_PROMO,
  moveFrom, moveTo, moveFlags, movePromo, makeMove,
  pieceType, pieceColor, squareName, parseSquare, fileOf, rankOf
} from './board.js'

const LETTERS = ['', '', 'N', 'B', 'R', 'Q', 'K']
const FROM_LETTER = { N: KNIGHT, B: BISHOP, R: ROOK, Q: QUEEN, K: KING }

export function moveToSan (board, move) {
  const flags = moveFlags(move)
  if (flags & FLAG_KCASTLE) return 'O-O' + suffix(board, move)
  if (flags & FLAG_QCASTLE) return 'O-O-O' + suffix(board, move)

  const from = moveFrom(move)
  const to = moveTo(move)
  const piece = board.squares[from]
  const type = pieceType(piece)
  const capture = (flags & FLAG_CAPTURE) !== 0
  let san = ''

  if (type === PAWN) {
    if (capture) san += 'abcdefgh'[fileOf(from)] + 'x'
    san += squareName(to)
  } else {
    san += LETTERS[type]
    // disambiguate against other same-type pieces that can also reach `to`
    const rivals = []
    for (const other of board.generate()) {
      if (other === move) continue
      if (moveTo(other) !== to) continue
      const otherPiece = board.squares[moveFrom(other)]
      if (pieceType(otherPiece) !== type || pieceColor(otherPiece) !== pieceColor(piece)) continue
      if (!board.makeMove(other)) continue
      board.undoMove()
      rivals.push(moveFrom(other))
    }
    if (rivals.length) {
      const sameFile = rivals.some((sq) => fileOf(sq) === fileOf(from))
      const sameRank = rivals.some((sq) => rankOf(sq) === rankOf(from))
      if (!sameFile) san += 'abcdefgh'[fileOf(from)]
      else if (!sameRank) san += String(rankOf(from) + 1)
      else san += squareName(from)
    }
    if (capture) san += 'x'
    san += squareName(to)
  }

  if (flags & FLAG_PROMO) san += '=' + LETTERS[movePromo(move)]
  return san + suffix(board, move)
}

function suffix (board, move) {
  if (!board.makeMove(move)) return ''
  const check = board.inCheck()
  const mated = check && !board.hasLegalMove()
  board.undoMove()
  return mated ? '#' : check ? '+' : ''
}

export function moveToUci (move) {
  const promo = movePromo(move)
  return squareName(moveFrom(move)) + squareName(moveTo(move)) + (promo ? 'xxnbrq'[promo] : '')
}

export function findMove (board, from, to, promotion = QUEEN) {
  const fromSq = typeof from === 'string' ? parseSquare(from) : from
  const toSq = typeof to === 'string' ? parseSquare(to) : to
  const promo = typeof promotion === 'string' ? (FROM_LETTER[promotion.toUpperCase()] || QUEEN) : promotion
  for (const move of board.legalMoves()) {
    if (moveFrom(move) !== fromSq || moveTo(move) !== toSq) continue
    if ((moveFlags(move) & FLAG_PROMO) && movePromo(move) !== promo) continue
    return move
  }
  return 0
}

export function uciToMove (board, uci) {
  if (!uci || uci.length < 4) return 0
  return findMove(board, uci.slice(0, 2), uci.slice(2, 4), uci[4] || 'q')
}

export function sanToMove (board, san) {
  const clean = san.replace(/[+#!?]/g, '')
  for (const move of board.legalMoves()) {
    if (moveToSan(board, move).replace(/[+#!?]/g, '') === clean) return move
  }
  return 0
}

export { Board, makeMove, FLAG_CAPTURE, FLAG_EP, FLAG_PROMO }
