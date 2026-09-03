# ForgeChess

Three chess variants against an engine that reviews its own games and stops
repeating the moves that lost them.

**Live:** https://forgechess.vercel.app

## What it is

| | |
|---|---|
| **Classic** | Standard chess, full rules — castling, en passant, promotion, fifty-move, threefold repetition. |
| **Setup Chess** | Both sides spend 39 material points building an army before the game starts. Queens 9, rooks 5, bishops and knights 3, pawns 1; the king is free but mandatory. Pieces go on your first three ranks, pawns on ranks two and three. The first army to finish moves first. |
| **Fog of War** | You only see your own pieces and the squares they can move to. No check, no checkmate — capture the enemy king to win, and the king may walk through attacked squares. |

## The engine

A from-scratch 0x88 engine in a Web Worker. No chess library in the hot loop.

- Legal move generation verified by **perft** against the six standard test
  positions (startpos through position 6) — `npm test` runs them.
- 64-bit Zobrist hashing (two 32-bit halves), verified incrementally against a
  full recompute over random play.
- Iterative deepening principal variation search with a transposition table,
  quiescence with delta pruning, null-move pruning, late move reductions,
  killer moves, history and counter-move heuristics, check extensions,
  aspiration windows and mate-distance pruning.
- Tapered PeSTO evaluation plus pawn structure, mobility, king shelter,
  bishop pair and rook file terms.

Roughly 230–280k nodes/sec in the browser, reaching depth 12 from the start
position in three seconds. Against the previous chess.js implementation at
equal time it scored **6–0, every game by checkmate**.

Six opponents from 600 to 2300. Lower levels are weakened by re-scoring the top
root moves exactly and then accepting a worse one inside a calibrated window,
which produces human-shaped mistakes rather than random garbage.

## How it learns

This is the part the app is built around.

1. When a game ends, the worker replays it and searches every position at
   higher depth than the game was played at.
2. Each move gets a centipawn loss, a classification (best / good /
   inaccuracy / mistake / blunder) and an accuracy percentage.
3. Every mistake is written to IndexedDB against the **Zobrist key of the
   position it was played in**, together with the move, how much it lost and
   how the game ended.
4. Before its next search, the engine looks up the current position and passes
   the result in as a **root bias**: moves it has blundered with are penalised
   by up to 300 centipawns, moves that have historically won are given a small
   bonus. The bias also reorders moves in the search.

So the second time it reaches a position where it hung a queen, that move is
already 300 centipawns behind before the search starts.

The same analysis pass drives the **Game Review** screen — accuracy for both
sides, an evaluation graph and every move classified.

### Shared book

Learning is local first: IndexedDB, works fully offline, survives with no
network at all. When online it also syncs to Supabase, so the book compounds
across everyone playing.

Every table has row-level security on with **no policies** — the publishable
key cannot read or write them directly. All access goes through four
`SECURITY DEFINER` functions that clamp and validate their input:

| function | purpose |
|---|---|
| `chess_book_merge(jsonb)` | Adds a batch of position/move deltas, aggregated and clamped. |
| `chess_book_top(text, int)` | Returns the most-played slice of the shared book for a variant. |
| `chess_game_log(jsonb)` | Archives one finished game. |
| `chess_learning_stats()` | Aggregate counters for the Learning panel. |

## Interface

Board and piece artwork comes from chess.com's theme CDN at runtime — 18 board
themes, 19 piece sets — and the service worker caches what you use so the
installed app still renders offline. Nothing copyrighted is committed to this
repository; if the artwork cannot load, board colours and Unicode piece glyphs
take over, and the glyphs are what render first on every load anyway.

Drag and drop and click-to-move, animated pieces, promotion picker,
right-click arrows and square highlights, clickable move list with keyboard
navigation, captured-material tray, animated evaluation bar, clocks with eight
time controls, synthesised sound effects (no audio assets), resign and draw
offers, and a responsive layout down to phone width.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # perft, hashing, notation, search, variants
npm run build
```

No runtime dependencies. Vite and vite-plugin-pwa are the only devDependencies.

### Configuration

The app ships with working publishable Supabase credentials in `src/config.js`,
so a fresh clone builds and syncs with no setup. To point it at your own
project, copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`, or set `VITE_SYNC_ENABLED=false` to keep everything
local.

## Layout

```
src/
  engine/    board.js (0x88, make/unmake, Zobrist) · eval.js · search.js
             notation.js (SAN/UCI) · levels.js · engine.worker.js
  core/      game.js (move list, PGN, results) · setup.js · fog.js
  learn/     store.js (IndexedDB book) · sync.js (Supabase)
  ui/        board.js (rendering, drag, arrows) · themes.js · sounds.js
             modals.js · review.js
  styles/    base · layout · board · panel · modals
test/        run.mjs
```
