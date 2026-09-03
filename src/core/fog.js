// Fog of War chess. You only see your own pieces and the squares they can move
// to. There is no check or checkmate: capture the enemy king to win.
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const inside = (file, rank) => file >= 0 && file < 8 && rank >= 1 && rank <= 8
const sq = (file, rank) => `${FILES[file]}${rank}`
const pos = (square) => [FILES.indexOf(square[0]), Number(square[1])]
const other = (color) => (color === 'w' ? 'b' : 'w')

export class FogGame {
  constructor () { this.reset() }

  reset () {
    this.board = new Map()
    this.turn = 'w'
    this.winner = null
    this.winReason = null
    this.enPassant = null
    this.castle = { w: { k: true, q: true }, b: { k: true, q: true } }
    this.history = []
    // What each side has actually seen, so the engine can play blind too.
    this.knowledge = { w: new Map(), b: new Map() }
    const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r']
    for (let i = 0; i < 8; i++) {
      this.board.set(sq(i, 1), 'w' + back[i])
      this.board.set(sq(i, 2), 'wp')
      this.board.set(sq(i, 7), 'bp')
      this.board.set(sq(i, 8), 'b' + back[i])
    }
    this.observe('w')
    this.observe('b')
  }

  cloneState () {
    return {
      board: [...this.board.entries()],
      turn: this.turn,
      winner: this.winner,
      winReason: this.winReason,
      enPassant: this.enPassant,
      castle: { w: { ...this.castle.w }, b: { ...this.castle.b } },
      knowledge: { w: [...this.knowledge.w.entries()], b: [...this.knowledge.b.entries()] }
    }
  }

  restore (state) {
    this.board = new Map(state.board)
    this.turn = state.turn
    this.winner = state.winner
    this.winReason = state.winReason
    this.enPassant = state.enPassant
    this.castle = { w: { ...state.castle.w }, b: { ...state.castle.b } }
    this.knowledge = { w: new Map(state.knowledge.w), b: new Map(state.knowledge.b) }
  }

  get (square) { return this.board.get(square) || null }

  allMoves (color = this.turn) {
    const out = []
    for (const [square, piece] of this.board) {
      if (piece[0] === color) out.push(...this.movesFrom(square))
    }
    return out
  }

  movesFrom (from) {
    const code = this.get(from)
    if (!code || this.winner) return []
    const color = code[0]
    const type = code[1]
    const [file, rank] = pos(from)
    const enemy = other(color)
    const out = []
    const add = (tf, tr, special = null) => {
      if (!inside(tf, tr)) return false
      const to = sq(tf, tr)
      const target = this.get(to)
      if (target && target[0] === color) return false
      out.push({ from, to, piece: type, color, captured: target || null, special })
      return !target
    }

    if (type === 'p') {
      const dir = color === 'w' ? 1 : -1
      const start = color === 'w' ? 2 : 7
      const promo = color === 'w' ? 8 : 1
      const one = sq(file, rank + dir)
      if (inside(file, rank + dir) && !this.get(one)) {
        out.push({ from, to: one, piece: type, color, captured: null, promotion: rank + dir === promo ? 'q' : null })
        const two = sq(file, rank + 2 * dir)
        if (rank === start && !this.get(two)) out.push({ from, to: two, piece: type, color, captured: null, special: 'double' })
      }
      for (const df of [-1, 1]) {
        if (!inside(file + df, rank + dir)) continue
        const to = sq(file + df, rank + dir)
        const target = this.get(to)
        if (target && target[0] === enemy) {
          out.push({ from, to, piece: type, color, captured: target, promotion: rank + dir === promo ? 'q' : null })
        } else if (!target && this.enPassant === to) {
          out.push({ from, to, piece: type, color, captured: enemy + 'p', special: 'ep' })
        }
      }
      return out
    }

    if (type === 'n') {
      for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) add(file + df, rank + dr)
      return out
    }

    if (type === 'b' || type === 'r' || type === 'q') {
      const dirs = type === 'b'
        ? [[1, 1], [1, -1], [-1, 1], [-1, -1]]
        : type === 'r'
          ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
          : [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]
      for (const [df, dr] of dirs) {
        let tf = file + df
        let tr = rank + dr
        while (inside(tf, tr)) {
          if (!add(tf, tr)) break
          tf += df
          tr += dr
        }
      }
      return out
    }

    if (type === 'k') {
      for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) if (df || dr) add(file + df, rank + dr)
      const home = color === 'w' ? 1 : 8
      if (from === `e${home}`) {
        if (this.castle[color].k && this.get(`h${home}`) === color + 'r' && !this.get(`f${home}`) && !this.get(`g${home}`)) {
          out.push({ from, to: `g${home}`, piece: 'k', color, captured: null, special: 'castle-k' })
        }
        if (this.castle[color].q && this.get(`a${home}`) === color + 'r' && !this.get(`b${home}`) && !this.get(`c${home}`) && !this.get(`d${home}`)) {
          out.push({ from, to: `c${home}`, piece: 'k', color, captured: null, special: 'castle-q' })
        }
      }
    }
    return out
  }

  move (from, to, promotion = 'q') {
    if (this.winner) return null
    const move = this.movesFrom(from).find((m) => m.to === to)
    if (!move || move.color !== this.turn) return null
    this.history.push({ state: this.cloneState(), move: { ...move } })

    const code = this.get(from)
    this.board.delete(from)
    if (move.special === 'ep') {
      const [file, rank] = pos(to)
      this.board.delete(sq(file, rank + (move.color === 'w' ? -1 : 1)))
    }
    if (move.special === 'castle-k') {
      const home = move.color === 'w' ? 1 : 8
      this.board.delete(`h${home}`)
      this.board.set(`f${home}`, move.color + 'r')
    }
    if (move.special === 'castle-q') {
      const home = move.color === 'w' ? 1 : 8
      this.board.delete(`a${home}`)
      this.board.set(`d${home}`, move.color + 'r')
    }
    this.board.set(to, move.promotion ? move.color + (promotion || 'q') : code)

    if (move.captured && move.captured[1] === 'k') { this.winner = move.color; this.winReason = 'king captured' }
    if (code[1] === 'k') { this.castle[move.color].k = false; this.castle[move.color].q = false }
    if (code[1] === 'r') {
      if (from === (move.color === 'w' ? 'a1' : 'a8')) this.castle[move.color].q = false
      if (from === (move.color === 'w' ? 'h1' : 'h8')) this.castle[move.color].k = false
    }
    const victim = other(move.color)
    if (to === (victim === 'w' ? 'a1' : 'a8')) this.castle[victim].q = false
    if (to === (victim === 'w' ? 'h1' : 'h8')) this.castle[victim].k = false

    this.enPassant = null
    if (code[1] === 'p' && move.special === 'double') {
      const [file, rank] = pos(from)
      this.enPassant = sq(file, rank + (move.color === 'w' ? 1 : -1))
    }
    if (!this.winner) this.turn = other(this.turn)

    // The mover always learns where the piece it captured stood, and the
    // defender learns where the attack came from.
    this.observe(move.color)
    if (move.captured) this.knowledge[victim].set(to, this.get(to))
    this.observe(victim === this.turn ? victim : victim)
    if (!this.winner && !this.allMoves(this.turn).length) { this.winner = 'draw'; this.winReason = 'no legal moves' }
    return move
  }

  undo () {
    const entry = this.history.pop()
    if (!entry) return null
    this.restore(entry.state)
    return entry.move
  }

  visibility (color) {
    const visible = new Set()
    for (const [square, piece] of this.board) if (piece[0] === color) visible.add(square)
    for (const square of [...visible]) for (const move of this.movesFrom(square)) visible.add(move.to)
    if (this.enPassant && this.turn === color) visible.add(this.enPassant)
    return visible
  }

  // Refresh what `color` remembers about the enemy from its current vision.
  observe (color) {
    const visible = this.visibility(color)
    const memory = this.knowledge[color]
    for (const square of visible) {
      const piece = this.get(square)
      if (piece && piece[0] !== color) memory.set(square, piece)
      else memory.delete(square)
    }
    // Forget remembered pieces that are provably gone.
    for (const [square, piece] of [...memory]) {
      if (visible.has(square) && this.get(square) !== piece) memory.delete(square)
    }
  }

  // A board containing our real pieces plus only the enemy pieces we have seen.
  // The engine searches this instead of the true position, so it plays blind.
  determinize (color) {
    const believed = new FogGame()
    believed.board = new Map()
    believed.turn = this.turn
    believed.winner = null
    believed.winReason = null
    believed.enPassant = this.enPassant
    believed.castle = { w: { ...this.castle.w }, b: { ...this.castle.b } }
    believed.history = []
    believed.knowledge = { w: new Map(), b: new Map() }
    for (const [square, piece] of this.board) if (piece[0] === color) believed.board.set(square, piece)
    for (const [square, piece] of this.knowledge[color]) {
      if (!believed.board.has(square)) believed.board.set(square, piece)
    }
    // Without a remembered king the engine would think it had already won.
    const enemy = other(color)
    if (![...believed.board.values()].includes(enemy + 'k')) {
      const home = enemy === 'w' ? 1 : 8
      for (const file of ['e', 'g', 'c', 'd', 'f', 'b', 'h', 'a']) {
        const square = `${file}${home}`
        if (!believed.board.has(square)) { believed.board.set(square, enemy + 'k'); break }
      }
    }
    return believed
  }

  serialize () {
    return this.history.map((entry) => ({ from: entry.move.from, to: entry.move.to, promotion: entry.move.promotion || null }))
  }

  loadMoves (moves = []) {
    for (const move of moves) if (!this.move(move.from, move.to, move.promotion || 'q')) break
  }

  materialFor (color) {
    const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
    let total = 0
    for (const piece of this.board.values()) if (piece[0] === color) total += values[piece[1]] || 0
    return total
  }
}

// --- fog engine -------------------------------------------------------------

const VALUE = { p: 100, n: 320, b: 335, r: 510, q: 930, k: 0 }
const MATE = 10000000

const kingSquare = (game, color) => {
  for (const [square, piece] of game.board) if (piece === color + 'k') return square
  return null
}
const distance = (a, b) => {
  if (!a || !b) return 8
  const [af, ar] = pos(a)
  const [bf, br] = pos(b)
  return Math.abs(af - bf) + Math.abs(ar - br)
}
const canTakeKing = (game, color) => game.allMoves(color).some((m) => m.captured === other(color) + 'k')

function evaluate (game, root) {
  if (game.winner === root) return MATE
  if (game.winner && game.winner !== 'draw') return -MATE
  const enemy = other(root)
  let score = 0
  for (const [square, piece] of game.board) {
    const sign = piece[0] === root ? 1 : -1
    const type = piece[1]
    const [file, rank] = pos(square)
    score += sign * (VALUE[type] || 0)
    const center = 7 - (Math.abs(3.5 - file) + Math.abs(4.5 - rank))
    if (type === 'n' || type === 'b') score += sign * center * 3
    if (type === 'q' || type === 'r') score += sign * center
    if (type === 'p') score += sign * ((piece[0] === 'w' ? rank : 9 - rank) - 2) * 7
  }
  const rootMoves = game.allMoves(root)
  const enemyMoves = game.allMoves(enemy)
  score += (rootMoves.length - enemyMoves.length) * 3
  score += (game.visibility(root).size - game.visibility(enemy).size) * 2
  const rootKing = kingSquare(game, root)
  const enemyKing = kingSquare(game, enemy)
  if (!rootKing) return -MATE
  if (!enemyKing) return MATE
  if (canTakeKing(game, root)) score += 180000
  if (canTakeKing(game, enemy)) score -= 240000
  for (const move of rootMoves) {
    if (move.captured) score += (VALUE[move.captured[1]] || 0) * 0.08
    if (move.piece === 'q' || move.piece === 'r') score += (14 - distance(move.to, enemyKing)) * 1.8
  }
  for (const move of enemyMoves) {
    if (move.captured) score -= (VALUE[move.captured[1]] || 0) * 0.09
    if (move.piece === 'q' || move.piece === 'r') score -= (14 - distance(move.to, rootKing)) * 2.1
  }
  const [rf, rr] = pos(rootKing)
  const [ef, er] = pos(enemyKing)
  score += (Math.min(rf, 7 - rf, rr - 1, 8 - rr) - Math.min(ef, 7 - ef, er - 1, 8 - er)) * 4
  return score
}

function orderScore (game, move) {
  if (move.captured && move.captured[1] === 'k') return 1000000
  let score = 0
  if (move.captured) score += (VALUE[move.captured[1]] || 0) * 12 - (VALUE[move.piece] || 0)
  if (move.promotion) score += 7000
  if (move.special && move.special.startsWith('castle')) score += 180
  score += (16 - distance(move.to, kingSquare(game, other(move.color)))) * 8
  return score
}

function ordered (game, limit) {
  const moves = game.allMoves(game.turn)
  moves.sort((a, b) => orderScore(game, b) - orderScore(game, a))
  return limit && moves.length > limit ? moves.slice(0, limit) : moves
}

function search (game, depth, alpha, beta, root, deadline, limit, ply = 0) {
  if (Date.now() >= deadline) throw new Error('timeout')
  if (game.winner) return game.winner === root ? MATE - ply : game.winner === 'draw' ? 0 : -MATE + ply
  if (depth === 0) return evaluate(game, root)
  const moves = ordered(game, limit)
  if (!moves.length) return evaluate(game, root)
  const maximizing = game.turn === root
  let best = maximizing ? -Infinity : Infinity
  for (const move of moves) {
    game.move(move.from, move.to, move.promotion || 'q')
    let value
    try { value = search(game, depth - 1, alpha, beta, root, deadline, limit, ply + 1) } finally { game.undo() }
    if (maximizing) {
      if (value > best) best = value
      if (best > alpha) alpha = best
    } else {
      if (value < best) best = value
      if (best < beta) beta = best
    }
    if (beta <= alpha) break
  }
  return best
}

const LEVELS = {
  1: { depth: 1, time: 60, limit: 18, noise: 200, pool: 5 },
  2: { depth: 2, time: 160, limit: 16, noise: 70, pool: 3 },
  3: { depth: 3, time: 420, limit: 14, noise: 22, pool: 2 },
  4: { depth: 4, time: 900, limit: 13, noise: 6, pool: 1 },
  5: { depth: 6, time: 1600, limit: 12, noise: 0, pool: 1 }
}

// The engine reasons over its own belief board, so it never sees through fog.
export function chooseFogMove (game, color, strength = 2) {
  const legal = game.allMoves(color)
  if (!legal.length) return null
  const winning = legal.find((m) => m.captured && m.captured[1] === 'k')
  if (winning) return winning

  const config = LEVELS[strength] || LEVELS[2]
  const believed = game.determinize(color)
  const deadline = Date.now() + config.time
  const believedMoves = believed.allMoves(color)
  const known = new Map(believedMoves.map((m) => [`${m.from}${m.to}`, m]))

  let ranked = believedMoves.map((move) => ({ move, score: orderScore(believed, move) })).sort((a, b) => b.score - a.score)
  let completed = ranked
  for (let depth = 1; depth <= config.depth; depth++) {
    const current = []
    try {
      for (const item of ranked) {
        if (Date.now() >= deadline) throw new Error('timeout')
        believed.move(item.move.from, item.move.to, item.move.promotion || 'q')
        let score
        try {
          score = believed.winner === color ? MATE : search(believed, depth - 1, -Infinity, Infinity, color, deadline, config.limit, 1)
        } finally { believed.undo() }
        current.push({ move: item.move, score })
      }
      current.sort((a, b) => b.score - a.score)
      completed = current
      ranked = current
      if (current[0] && current[0].score > MATE / 2) break
    } catch { break }
  }

  if (config.noise) {
    completed = completed
      .map((item) => ({ ...item, score: item.score + (Math.random() - 0.5) * config.noise }))
      .sort((a, b) => b.score - a.score)
  }
  const pool = Math.min(config.pool, completed.length)
  const picked = completed[Math.floor(Math.random() * pool)]
  if (!picked) return legal[0]
  // Map the belief-board move back onto the real position.
  const real = legal.find((m) => m.from === picked.move.from && m.to === picked.move.to)
  return real || legal.find((m) => known.has(`${m.from}${m.to}`)) || legal[0]
}
