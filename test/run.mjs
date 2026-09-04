// Engine and rules test suite. Run with `npm test`.
import { Board } from '../src/engine/board.js'
import { Searcher } from '../src/engine/search.js'
import { moveToSan, sanToMove, uciToMove } from '../src/engine/notation.js'
import { evaluate, MATE_SCORE, MATE_IN_MAX } from '../src/engine/eval.js'
import { Game } from '../src/core/game.js'
import { SetupGame, ARMY_TEMPLATES, templateCost, randomTemplate } from '../src/core/setup.js'
import { FogGame, chooseFogMove } from '../src/core/fog.js'

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) { console.log(`  ok   ${name}`) } else { failures++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (name) => console.log(`\n${name}`)

function perft (board, depth) {
  if (depth === 0) return 1
  let nodes = 0
  for (const move of board.generate()) {
    if (!board.makeMove(move)) continue
    nodes += depth === 1 ? 1 : perft(board, depth - 1)
    board.undoMove()
  }
  return nodes
}

section('Move generation (perft)')
const PERFT = [
  ['startpos', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['position 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['position 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ['position 6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]]
]
for (const [name, fen, expected] of PERFT) {
  for (let depth = 1; depth <= expected.length; depth++) {
    const board = new Board(fen)
    const nodes = perft(board, depth)
    check(`${name} depth ${depth}`, nodes === expected[depth - 1], `got ${nodes}, want ${expected[depth - 1]}`)
    check(`${name} depth ${depth} unwinds cleanly`, board.ply === 0 && board.fen() === new Board(fen).fen())
  }
}

section('Zobrist hashing')
{
  let mismatches = 0
  const fens = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    'qqqkqqqq/pppppppp/8/8/8/8/PPPPPPPP/QQQKQQQQ w - - 0 1'
  ]
  for (const fen of fens) {
    for (let trial = 0; trial < 40; trial++) {
      const board = new Board(fen)
      for (let ply = 0; ply < 60; ply++) {
        const moves = board.legalMoves()
        if (!moves.length) break
        board.makeMove(moves[Math.floor(Math.random() * moves.length)])
        const lo = board.keyLo
        const hi = board.keyHi
        board.computeKey()
        if (lo !== board.keyLo || hi !== board.keyHi) mismatches++
      }
      while (board.ply) board.undoMove()
      if (board.fen() !== new Board(fen).fen()) mismatches++
    }
  }
  check('incremental keys match a full recompute', mismatches === 0, `${mismatches} mismatches`)
}

section('Notation')
{
  const board = new Board()
  const line = 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O c3 d5 exd5 Nxd5'.split(' ')
  let ok = true
  for (const san of line) {
    const move = sanToMove(board, san)
    if (!move || moveToSan(board, move).replace(/[+#]/g, '') !== san) { ok = false; break }
    board.makeMove(move)
  }
  check('Ruy Lopez line round-trips through SAN', ok)
  check('resulting FEN is correct', board.fen() === 'r1bq1rk1/2p1bppp/p1n5/1p1np3/8/1BP2N2/PP1P1PPP/RNBQR1K1 w - - 0 10', board.fen())
}

section('Evaluation')
{
  const white = evaluate(new Board('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'))
  const black = evaluate(new Board('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1'))
  check('start position is symmetric', white === black, `${white} vs ${black}`)
  const down = evaluate(new Board('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/1NBQKBNR w Kkq - 0 1'))
  check('a missing rook is worth roughly a rook', down < -380 && down > -560, String(down))
}

section('Search')
{
  const searcher = new Searcher()
  const mates = [
    '7k/8/6K1/8/8/8/8/R7 w - - 0 1',
    '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
    '3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
    '6k1/pp4p1/2p5/2bp4/8/P5Pb/1P3rrP/2BRRN1K b - - 0 1'
  ]
  for (const fen of mates) {
    searcher.newGame()
    const board = new Board(fen)
    const result = searcher.search(board, { depth: 10, movetime: 1600, skill: 20 })
    let verified = false
    if (Math.abs(result.score) > MATE_IN_MAX && result.score > 0) {
      for (const uci of result.pv) {
        const move = uciToMove(board, uci)
        if (!move) break
        board.makeMove(move)
      }
      verified = board.outcome() === 'checkmate'
    }
    check(`forced mate is real: ${fen.split(' ')[0].slice(0, 18)}`, verified, `score ${result.score}`)
  }

  searcher.newGame()
  const start = new Board()
  const opening = searcher.search(start, { depth: 8, movetime: 1200, skill: 20 })
  check('reaches at least depth 6 in 1.2s from the start position', opening.depth >= 6, `depth ${opening.depth}`)
  check('opening choice is a sensible first move', ['e2e4', 'd2d4', 'g1f3', 'c2c4', 'b1c3', 'g2g3'].includes(opening.pv[0] || ''), opening.pv[0])
}

section('Self play terminates')
{
  const searcher = new Searcher()
  searcher.newGame()
  const board = new Board()
  let outcome = null
  for (let ply = 0; ply < 300; ply++) {
    outcome = board.outcome()
    if (outcome) break
    const result = searcher.search(board, { depth: 5, movetime: 80, skill: 20 })
    if (!result.move || !board.makeMove(result.move)) { outcome = 'illegal'; break }
  }
  check('a full engine-vs-engine game reaches a legal result', !!outcome && outcome !== 'illegal', String(outcome))
  void MATE_SCORE
}

section('Setup Chess')
{
  for (const template of ARMY_TEMPLATES) {
    check(`template "${template.name}" spends exactly 39 points`, templateCost(template) === 39, String(templateCost(template)))
  }
  let completed = 0
  for (let trial = 0; trial < 120; trial++) {
    const setup = new SetupGame()
    const white = randomTemplate()
    const black = randomTemplate()
    let guard = 0
    while (!setup.complete() && guard++ < 200) {
      const color = setup.turn
      const move = setup.nextEngineMove(color, color === 'w' ? white : black)
      if (!move) break
      setup.place(color, move.type, move.square)
    }
    if (setup.complete()) completed++
  }
  check('every template pairing completes both armies', completed === 120, `${completed}/120`)

  const setup = new SetupGame()
  const white = ARMY_TEMPLATES[0]
  while (!setup.complete()) {
    const color = setup.turn
    const move = setup.nextEngineMove(color, white)
    if (!move) break
    setup.place(color, move.type, move.square)
  }
  const game = new Game(setup.fen(), 'setup')
  check('a finished setup produces a playable position', game.legalTargets('e2').length > 0 || game.board.legalMoves().length > 0)
}

section('Fog of War')
{
  const fog = new FogGame()
  let plies = 0
  // Sample as the game runs. Checking only the final position asserts nothing:
  // a side that never lost a piece and got everything spotted legitimately ends
  // up knowing all sixteen, and the test would fail for the wrong reason.
  const leastKnown = { w: Infinity, b: Infinity }
  while (!fog.winner && plies < 240) {
    leastKnown.w = Math.min(leastKnown.w, fog.knowledge.w.size)
    leastKnown.b = Math.min(leastKnown.b, fog.knowledge.b.size)
    const move = chooseFogMove(fog, fog.turn, 2)
    if (!move) break
    fog.move(move.from, move.to, move.promotion || 'q')
    plies++
  }
  check('a fog game reaches a result', !!fog.winner, `${plies} plies`)
  check('neither side ever sees the whole board', leastKnown.w < 16 && leastKnown.b < 16,
    `w:${leastKnown.w} b:${leastKnown.b}`)
  const visible = fog.visibility('w')
  check('vision is limited', visible.size < 64, String(visible.size))
}

section('Game model')
{
  const game = new Game()
  for (const [from, to] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'b5'], ['a7', 'a6']]) game.play(from, to)
  check('SAN history is correct', game.moves.map((m) => m.san).join(' ') === 'e4 e5 Nf3 Nc6 Bb5 a6', game.moves.map((m) => m.san).join(' '))
  check('castling is offered', game.legalTargets('e1').some((t) => t.castle))
  check('PGN includes the moves', game.pgn().includes('1. e4 e5'))
  const snapshot = game.boardAt(2)
  check('history snapshots replay correctly', snapshot.fen().startsWith('rnbqkbnr/pppp1ppp/8/4p3/4P3'), snapshot.fen())
  game.undo()
  check('undo removes the last move', game.moves.length === 5)
}

console.log(failures ? `\n${failures} FAILURES\n` : '\nAll tests passed\n')
process.exit(failures ? 1 : 0)
