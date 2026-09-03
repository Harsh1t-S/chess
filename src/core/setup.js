// Setup Chess: both sides spend 39 material points building an army before the
// game starts. Pieces go on the first three ranks, pawns on ranks two and
// three, and the king is free but mandatory.
export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
export const COST = { q: 9, r: 5, b: 3, n: 3, p: 1, k: 0 }
export const PIECE_NAMES = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight', p: 'Pawn', k: 'King' }
export const BUDGET = 39

const mirror = (square) => `${square[0]}${9 - Number(square[1])}`

// Each template spends exactly 39 points. Order matters: the engine places from
// the top of the list down, so the important pieces land first.
export const ARMY_TEMPLATES = [
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'The standard army. Balanced and familiar.',
    pieces: [
      ['k', 'e1'], ['q', 'd1'], ['r', 'a1'], ['r', 'h1'], ['b', 'c1'], ['b', 'f1'], ['n', 'b1'], ['n', 'g1'],
      ['p', 'a2'], ['p', 'b2'], ['p', 'c2'], ['p', 'd2'], ['p', 'e2'], ['p', 'f2'], ['p', 'g2'], ['p', 'h2']
    ]
  },
  {
    id: 'twin-queens',
    name: 'Twin Queens',
    blurb: 'Two queens, fewer minor pieces. Brutal in the open.',
    pieces: [
      ['k', 'c1'], ['q', 'd1'], ['q', 'e1'], ['r', 'a1'], ['r', 'h1'], ['n', 'b1'],
      ['p', 'a2'], ['p', 'b2'], ['p', 'c2'], ['p', 'd2'], ['p', 'e2'], ['p', 'f2'], ['p', 'g2'], ['p', 'h2']
    ]
  },
  {
    id: 'cavalry',
    name: 'Cavalry',
    blurb: 'Four knights. Forks everywhere in closed positions.',
    pieces: [
      ['k', 'e1'], ['q', 'd1'], ['r', 'a1'], ['r', 'h1'], ['n', 'b1'], ['n', 'g1'], ['n', 'c1'], ['n', 'f1'],
      ['p', 'a2'], ['p', 'b2'], ['p', 'c2'], ['p', 'd2'], ['p', 'e2'], ['p', 'f2'], ['p', 'g2'], ['p', 'h2']
    ]
  },
  {
    id: 'battery',
    name: 'Bishop Battery',
    blurb: 'Four bishops covering every diagonal.',
    pieces: [
      ['k', 'e1'], ['q', 'd1'], ['r', 'a1'], ['r', 'h1'], ['b', 'b1'], ['b', 'c1'], ['b', 'f1'], ['b', 'g1'],
      ['p', 'a2'], ['p', 'b2'], ['p', 'c2'], ['p', 'd2'], ['p', 'e2'], ['p', 'f2'], ['p', 'g2'], ['p', 'h2']
    ]
  },
  {
    id: 'phalanx',
    name: 'Phalanx',
    blurb: 'Fourteen pawns rolling forward in two waves.',
    pieces: [
      ['k', 'e1'], ['q', 'd1'], ['r', 'a1'], ['r', 'h1'], ['n', 'b1'], ['n', 'g1'],
      ['p', 'a2'], ['p', 'b2'], ['p', 'c2'], ['p', 'd2'], ['p', 'e2'], ['p', 'f2'], ['p', 'g2'], ['p', 'h2'],
      ['p', 'c3'], ['p', 'd3'], ['p', 'e3'], ['p', 'f3'], ['p', 'b3'], ['p', 'g3']
    ]
  },
  {
    id: 'rook-wall',
    name: 'Rook Wall',
    blurb: 'Four rooks. Trade into an endgame and steamroll.',
    pieces: [
      ['k', 'e1'], ['q', 'd1'], ['r', 'a1'], ['r', 'b1'], ['r', 'g1'], ['r', 'h1'], ['b', 'f1'], ['n', 'c1'],
      ['p', 'c2'], ['p', 'd2'], ['p', 'e2'], ['p', 'f2']
    ]
  },
  {
    id: 'triple-queen',
    name: 'Triple Queen',
    blurb: 'Three queens and almost no cover. All or nothing.',
    pieces: [
      ['k', 'e1'], ['q', 'c1'], ['q', 'd1'], ['q', 'f1'], ['r', 'a1'], ['r', 'h1'],
      ['p', 'd2'], ['p', 'e2']
    ]
  },
  {
    id: 'hedgehog',
    name: 'Hedgehog',
    blurb: 'Pawns pushed to the third rank for extra space.',
    pieces: [
      ['k', 'e1'], ['q', 'd1'], ['r', 'a1'], ['r', 'h1'], ['b', 'c1'], ['b', 'f1'], ['n', 'b1'], ['n', 'g1'],
      ['p', 'a3'], ['p', 'b3'], ['p', 'c3'], ['p', 'd3'], ['p', 'e3'], ['p', 'f3'], ['p', 'g3'], ['p', 'h3']
    ]
  },
  {
    id: 'outpost',
    name: 'Outpost',
    blurb: 'Knights already on the third rank, ready to jump.',
    pieces: [
      ['k', 'e1'], ['q', 'd1'], ['r', 'a1'], ['r', 'h1'], ['n', 'c3'], ['n', 'f3'], ['n', 'b1'], ['n', 'g1'],
      ['p', 'a2'], ['p', 'b2'], ['p', 'c2'], ['p', 'd2'], ['p', 'e2'], ['p', 'f2'], ['p', 'g2'], ['p', 'h2']
    ]
  },
  {
    id: 'heavy-metal',
    name: 'Heavy Metal',
    blurb: 'Queen plus four rooks. Files belong to you.',
    pieces: [
      ['k', 'e1'], ['q', 'd1'], ['r', 'a1'], ['r', 'b1'], ['r', 'g1'], ['r', 'h1'],
      ['p', 'a2'], ['p', 'b2'], ['p', 'c2'], ['p', 'd2'], ['p', 'e2'], ['p', 'f2'], ['p', 'g2'], ['p', 'h2'],
      ['p', 'd3'], ['p', 'e3']
    ]
  }
]

export function templateCost (template) {
  return template.pieces.reduce((total, [type]) => total + COST[type], 0)
}

export function templateFor (template, color) {
  return template.pieces.map(([type, square]) => ({ type, square: color === 'w' ? square : mirror(square) }))
}

export class SetupGame {
  constructor () {
    this.board = new Map()
    this.remaining = { w: BUDGET, b: BUDGET }
    this.king = { w: false, b: false }
    this.turn = 'w'
    this.firstMover = null
    this.history = []
  }

  finished (color) { return this.remaining[color] === 0 && this.king[color] }
  complete () { return this.finished('w') && this.finished('b') }

  canPlace (color, type, square) {
    if (this.complete() || color !== this.turn) return false
    if (this.board.has(square) || !(type in COST) || COST[type] > this.remaining[color]) return false
    if (type === 'k' && this.king[color]) return false
    const rank = Number(square[1])
    if (Number.isNaN(rank)) return false
    if (color === 'w') return type === 'p' ? rank === 2 || rank === 3 : rank >= 1 && rank <= 3
    return type === 'p' ? rank === 6 || rank === 7 : rank >= 6 && rank <= 8
  }

  legalSquares (color, type) {
    const out = []
    for (const file of FILES) {
      for (let rank = 1; rank <= 8; rank++) {
        const square = `${file}${rank}`
        if (this.canPlace(color, type, square)) out.push(square)
      }
    }
    return out
  }

  place (color, type, square) {
    if (!this.canPlace(color, type, square)) throw new Error('That placement is not allowed.')
    this.board.set(square, color + type)
    this.remaining[color] -= COST[type]
    if (type === 'k') this.king[color] = true
    this.history.push({ color, piece: type, square })
    if (this.finished(color) && !this.firstMover) this.firstMover = color
    if (!this.complete()) {
      const other = color === 'w' ? 'b' : 'w'
      this.turn = this.finished(other) ? color : other
    }
    return this.history[this.history.length - 1]
  }

  undo () {
    const last = this.history.pop()
    if (!last) return null
    this.board.delete(last.square)
    this.remaining[last.color] += COST[last.piece]
    if (last.piece === 'k') this.king[last.color] = false
    this.turn = last.color
    this.firstMover = null
    for (const color of ['w', 'b']) if (this.finished(color)) { this.firstMover = color; break }
    return last
  }

  // Fill one side straight from a template, skipping anything already placed.
  applyTemplate (color, template) {
    const placed = []
    for (const { type, square } of templateFor(template, color)) {
      if (this.turn !== color) break
      if (!this.canPlace(color, type, square)) continue
      placed.push(this.place(color, type, square))
    }
    return placed
  }

  // The single next placement the engine wants to make, template-driven so its
  // armies look deliberate instead of randomly scattered.
  nextEngineMove (color, template) {
    if (this.turn !== color || this.finished(color)) return null
    const plan = templateFor(template, color)
    for (const { type, square } of plan) {
      if (this.canPlace(color, type, square)) return { type, square }
    }
    // Template exhausted or blocked: fall back to the most valuable legal piece.
    const order = this.remaining[color] === 0 && !this.king[color]
      ? ['k']
      : ['q', 'r', 'b', 'n', 'p', 'k']
    for (const type of order) {
      if (COST[type] > this.remaining[color]) continue
      const squares = this.legalSquares(color, type)
      if (!squares.length) continue
      const home = color === 'w' ? 1 : 8
      squares.sort((a, b) => Math.abs(Number(a[1]) - home) - Math.abs(Number(b[1]) - home))
      return { type, square: squares[Math.floor(Math.random() * Math.min(squares.length, 3))] }
    }
    return null
  }

  serialize () { return this.history.map((entry) => ({ ...entry })) }

  fen () {
    if (!this.complete()) throw new Error('Finish both armies first.')
    const rows = []
    for (let rank = 8; rank >= 1; rank--) {
      let row = ''
      let empty = 0
      for (const file of FILES) {
        const piece = this.board.get(`${file}${rank}`)
        if (!piece) { empty++; continue }
        if (empty) { row += empty; empty = 0 }
        row += piece[0] === 'w' ? piece[1].toUpperCase() : piece[1]
      }
      if (empty) row += empty
      rows.push(row)
    }
    return `${rows.join('/')} ${this.firstMover || 'w'} - - 0 1`
  }

  armyText (color) {
    return [...this.board.entries()]
      .filter(([, piece]) => piece[0] === color)
      .map(([square, piece]) => `${piece[1].toUpperCase()}${square}`)
      .join(', ')
  }

  static fromHistory (items = []) {
    const game = new SetupGame()
    for (const entry of items) {
      try { game.place(entry.color, entry.piece, entry.square) } catch { break }
    }
    return game
  }
}

export const randomTemplate = () => ARMY_TEMPLATES[Math.floor(Math.random() * ARMY_TEMPLATES.length)]
