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

## Two engines

**Playing** is done by the engine in this repository (below). It is fast, runs
offline, and is where the bot personalities and the learning bias live.

**Judging** — the evaluation bar, the hint button and the post-game review — is
done by [Stockfish 16](https://stockfishchess.org/), fetched on demand from a
CDN and driven over UCI in its own worker. It is the single-threaded WASM build:
575 KB, no `SharedArrayBuffer` or cross-origin isolation needed, and no network
file to download, since that build leaves NNUE off and uses Stockfish's
classical evaluation. It is still far ahead of anything reasonable to write
here, which matters most for review: the centipawn losses that teach the engine
are only as good as the judge producing them.

If the CDN cannot be reached the local engine does the judging instead, so an
offline install still gets an evaluation bar, hints and a review — just a
weaker-judged one. The service worker caches Stockfish after first use, and
`VITE_STOCKFISH_BASE` points the loader at your own origin if you would rather
self-host it. Stockfish is GPL-3.0; it is fetched unmodified at runtime and is
not redistributed as part of this project.

## The playing engine

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

1. When a game ends, every position in it is re-analysed — by Stockfish where
   available, otherwise by the local engine at higher depth than the game was
   played at.
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

### Opening book from real games

`npm run build:book` streams rated games out of the [Lichess open
database](https://database.lichess.org/) (CC0), replays them on this engine's
own board and writes `public/book/classic.json` — position key to move to
`[games, wins, draws, losses]`, the array-packed form of a learning-store
record. Only a slice of the monthly file is pulled, never the whole thing.

```bash
npm run build:book -- --games 8000 --plies 24 --min-rating 1800 --min-games 5
node tools/build-book.mjs --help
```

The app loads that file at startup and turns it into a search bias, so the
engine plays real theory from move one instead of working the opening out from
a cold search. Moves that score well and get played a lot are worth up to +90
centipawns going into the search; unpopular or losing ones are pushed down. What
the engine learns from its own games is layered on top and wins wherever the two
disagree — the crowd knows the openings, but only the engine knows which moves
*it* has actually blundered with.

### Training it further on your own machine

You need Node 22 or newer (for the built-in zstd decoder) and a few minutes.
Nothing else — no GPU, no Python, no API keys.

```bash
git clone https://github.com/Harsh1t-S/chess
cd chess
npm install

# a bigger, stronger book: 40k games from strong players
npm run build:book -- --games 40000 --plies 28 --min-rating 2200 \
  --source https://database.lichess.org/standard/lichess_db_standard_rated_2019-01.pgn.zst

npm run build    # the new book is picked up automatically
npm run dev      # play against it
```

Roughly 830 games a second, and only the leading slice of the monthly file is
downloaded — `--max-mb` caps that regardless of how big the month is. Ctrl-C at
any point writes a valid book out of whatever it has read so far.

Run it repeatedly to grow the book rather than replace it:

```bash
npm run build:book -- --games 20000 --append
npm run build:book -- --games 20000 --skip 20000 --append
```

Knobs worth turning:

| flag | effect |
|---|---|
| `--min-rating` | Higher means fewer but better games. 2200+ gives master-level theory; 1500 gives a book that mirrors how club players actually play. |
| `--plies` | How deep the book goes. 24 covers the opening; 40 reaches into early middlegames but grows the file quickly. |
| `--min-games` | Raise it to keep only well-tested lines; lower it to keep rarities. |
| `--source` | Any month from the database. Later months are larger and stronger. |

Commit the resulting `public/book/classic.json` and the deployed app ships with
whatever you trained.

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

Drag and drop and click-to-move, animated pieces with a human-tempo delay
before the bot replies, promotion picker, right-click arrows and square
highlights, clickable move list with keyboard navigation, captured-material
tray, animated evaluation bar, clocks with eight time controls, resign and draw
offers, a hint button, and a responsive layout down to phone width. The board is
fully playable from the keyboard and reports itself to screen readers.

Sound uses chess.com's own effect set, loaded from their CDN alongside the
artwork and cached by the service worker, with a synthesised set standing in
when they cannot load.

Fog of War draws its fog as a single masked layer with feathered clearings and
drifting turbulence, rather than blacking out individual squares.

## Running it

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # perft, hashing, notation, search, variants
npm run test:e2e  # browser suite: rules, interface, flows (needs Playwright)
npm run build
npm run build:book  # rebuild the opening book from the Lichess database
```

`npm run test:e2e` drives a real browser through roughly a hundred checks —
castling, en passant, promotion and its cancellation, threefold repetition,
history navigation, persistence across reloads, every bot level answering,
clocks, resign and draw, both two-player modes, the fog handoff, theme
persistence, keyboard play, and the whole learning loop end to end. It needs
Playwright available (`npm i -D playwright`); it is not a dependency of the
project.

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
tools/       build-book.mjs (Lichess database -> opening book)
```
