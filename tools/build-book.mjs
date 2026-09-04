#!/usr/bin/env node
// Builds an opening book from the Lichess open database (CC0).
//
//   npm run build:book -- --games 8000 --min-rating 2000
//
// Games are streamed straight out of the compressed monthly PGN, replayed on
// the engine's own board so every position is keyed by the same Zobrist hash
// the app uses, and written as
//   { header, positions: { <positionKey>: { <uci>: [g, w, d, l] } } }
// which is the array-packed form of a learning-store record's `moves` map
// (id `<variant>|<positionKey>`, with cp/m left at zero — nothing here is a
// judged mistake, it is just what strong humans actually played).
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { createZstdDecompress } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Board, WHITE } from '../src/engine/board.js'
import { sanToMove, uciToMove, moveToUci } from '../src/engine/notation.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const DEFAULTS = {
  games: 8000,
  plies: 24,
  minRating: 1800,
  minGames: 5,
  variant: 'classic',
  out: 'public/book/classic.json',
  source: 'https://database.lichess.org/standard/lichess_db_standard_rated_2013-01.pgn.zst',
  maxMb: 256,
  skip: 0,
  append: false
}

// Games this short are nearly all disconnects and pre-move accidents.
const MIN_GAME_PLIES = 6
const RESULTS = { '1-0': 'white', '0-1': 'black', '1/2-1/2': 'draw' }

const USAGE = `Usage: node tools/build-book.mjs [options]

  --games N        games to ingest (default ${DEFAULTS.games})
  --plies N        book depth in half-moves (default ${DEFAULTS.plies})
  --min-rating N   skip games where either player is below this (default ${DEFAULTS.minRating})
  --min-games N    drop positions seen fewer times than this (default ${DEFAULTS.minGames})
  --out PATH       output file (default ${DEFAULTS.out})
  --source URL     .pgn / .pgn.zst URL or local path (default: Lichess 2013-01)
  --max-mb N       cap on compressed bytes pulled from the source (default ${DEFAULTS.maxMb})
  --skip N         qualifying games to skip before ingesting, to resume a run
  --append         merge into the existing --out file instead of replacing it
  --variant NAME   variant label written into the header (default ${DEFAULTS.variant})
`

function parseArgs (argv) {
  const options = { ...DEFAULTS }
  const numbers = { games: 'games', plies: 'plies', 'min-rating': 'minRating', 'min-games': 'minGames', 'max-mb': 'maxMb', skip: 'skip' }
  const strings = { out: 'out', source: 'source', variant: 'variant' }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') { process.stdout.write(USAGE); process.exit(0) }
    if (arg === '--append') { options.append = true; continue }
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null]
    const key = flag.replace(/^--/, '')
    const value = inline !== null ? inline : argv[++i]
    if (numbers[key]) {
      const parsed = Number(value)
      if (!Number.isFinite(parsed) || parsed < 0) fail(`${flag} needs a number`)
      options[numbers[key]] = parsed
    } else if (strings[key]) {
      if (!value) fail(`${flag} needs a value`)
      options[strings[key]] = value
    } else fail(`unknown option ${arg}`)
  }
  return options
}

const fail = (message) => { process.stderr.write(`build-book: ${message}\n\n${USAGE}`); process.exit(1) }

// --- source ------------------------------------------------------------------

// pzstd (what Lichess compresses with) prefixes every zstd frame with a
// skippable frame holding that frame's compressed size. libzstd's CLI walks
// past those; node:zlib refuses them, so strip them back out of the byte
// stream. Anything that does not start with a skippable frame is passed
// through untouched.
function stripSkippableFrames () {
  const SKIP_MASK = 0xfffffff0
  const SKIP_MAGIC = 0x184d2a50
  let held = Buffer.alloc(0)
  let passthrough = 0 // bytes of real zstd frame still to forward
  let raw = false // source has no skippable frames at all

  return new Transform({
    transform (chunk, _encoding, done) {
      if (raw) { this.push(chunk); done(); return }
      held = held.length ? Buffer.concat([held, chunk]) : chunk
      for (;;) {
        if (passthrough > 0) {
          const take = Math.min(passthrough, held.length)
          if (take) { this.push(held.subarray(0, take)); held = held.subarray(take); passthrough -= take }
          if (passthrough > 0) break
        }
        if (held.length < 12) break
        if ((held.readUInt32LE(0) & SKIP_MASK) !== SKIP_MAGIC) {
          raw = true
          this.push(held)
          held = Buffer.alloc(0)
          break
        }
        const size = held.readUInt32LE(4)
        if (held.length < 8 + size) break
        // pzstd's 4-byte payload is the size of the frame that follows.
        passthrough = size === 4 ? held.readUInt32LE(8) : Infinity
        held = held.subarray(8 + size)
      }
      done()
    },
    flush (done) { if (held.length) this.push(held); done() }
  })
}

// Yields decompressed text chunks, stopping as soon as `state.stop` is set so a
// finished ingest never pulls more of the file than it needs.
async function * readSource (options, state) {
  const isUrl = /^https?:\/\//.test(options.source)
  const maxBytes = Math.round(options.maxMb * 1024 * 1024)
  const controller = new AbortController()
  let input

  if (isUrl) {
    const response = await fetch(options.source, {
      headers: { range: `bytes=0-${maxBytes - 1}` },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`${options.source} -> HTTP ${response.status}`)
    if (response.status !== 206) process.stderr.write('note: source ignored the range request, reading from the start\n')
    input = Readable.fromWeb(response.body)
  } else {
    const path = resolve(process.cwd(), options.source)
    if (!existsSync(path)) throw new Error(`no such file: ${path}`)
    input = createReadStream(path, { end: maxBytes - 1 })
  }

  const counted = input.pipe(new Transform({
    transform (chunk, _encoding, done) { state.bytes += chunk.length; done(null, chunk) }
  }))

  const compressed = /\.zst$/i.test(options.source.split('?')[0])
  const output = compressed
    ? counted.pipe(stripSkippableFrames()).pipe(createZstdDecompress({ maxOutputLength: Number.MAX_SAFE_INTEGER }))
    : counted

  try {
    for await (const chunk of output) {
      yield chunk
      if (state.stop) break
    }
  } catch (error) {
    // Cutting the download mid-frame is the normal way this ends; only a
    // genuine failure before we had our fill is worth reporting.
    if (!state.stop) process.stderr.write(`note: source stream ended early (${error.message})\n`)
  } finally {
    controller.abort()
    input.destroy()
  }
}

// --- PGN ---------------------------------------------------------------------

const TAG = /^\[([A-Za-z0-9_]+)\s+"([\s\S]*)"\]$/

// Splits the decoded stream into { tags, movetext } games without ever holding
// more than the game being read.
async function * readGames (options, state) {
  const decoder = new TextDecoder('utf-8')
  let tail = ''
  let tags = {}
  let movetext = ''

  const flush = () => {
    const game = movetext.trim() ? { tags, movetext } : null
    tags = {}
    movetext = ''
    return game
  }

  for await (const chunk of readSource(options, state)) {
    tail += decoder.decode(chunk, { stream: true })
    let start = 0
    for (;;) {
      const end = tail.indexOf('\n', start)
      if (end === -1) break
      const line = tail.slice(start, end).trim()
      start = end + 1
      if (!line) continue
      if (line.charCodeAt(0) === 91 /* [ */) {
        // A tag after movetext means the previous game is complete.
        if (movetext) { const game = flush(); if (game) yield game }
        const match = TAG.exec(line)
        if (match) tags[match[1]] = match[2]
      } else movetext += line + ' '
    }
    tail = tail.slice(start)
    if (state.stop) break
  }
  const last = flush()
  if (last) yield last
}

// Movetext -> SAN tokens, dropping comments, variations, NAGs, move numbers and
// the result. Lichess ships clock and eval comments in newer months.
function sanTokens (movetext) {
  let text = ''
  let braces = 0
  let parens = 0
  for (let i = 0; i < movetext.length; i++) {
    const ch = movetext[i]
    if (ch === '{') { braces++; continue }
    if (ch === '}') { if (braces) braces--; continue }
    if (braces) continue
    if (ch === '(') { parens++; continue }
    if (ch === ')') { if (parens) parens--; continue }
    if (parens) continue
    if (ch === ';') { while (i < movetext.length && movetext[i] !== '\n') i++; continue }
    text += ch
  }
  const tokens = []
  for (const token of text.split(/\s+/)) {
    if (!token || token[0] === '$' || token === '*') continue
    if (/^\d+\.*$/.test(token) || token === '...') continue
    if (RESULTS[token] !== undefined) continue
    tokens.push(token.replace(/^\d+\.+/, ''))
  }
  return tokens
}

function rating (tags) {
  const white = Number.parseInt(tags.WhiteElo, 10)
  const black = Number.parseInt(tags.BlackElo, 10)
  if (!Number.isFinite(white) || !Number.isFinite(black)) return -1
  return Math.min(white, black)
}

// --- book --------------------------------------------------------------------

const positionKey = (board) => ((board.keyHi >>> 0).toString(16).padStart(8, '0')) + ((board.keyLo >>> 0).toString(16).padStart(8, '0'))

class Book {
  constructor () {
    this.positions = new Map()
    this.games = 0 // games already folded in by an earlier run
  }

  add (key, uci, won, drawn) {
    let entry = this.positions.get(key)
    if (!entry) { entry = new Map(); this.positions.set(key, entry) }
    let stats = entry.get(uci)
    if (!stats) { stats = [0, 0, 0, 0]; entry.set(uci, stats) }
    stats[0]++
    if (drawn) stats[2]++
    else if (won) stats[1]++
    else stats[3]++
  }

  merge (key, uci, counts) {
    let entry = this.positions.get(key)
    if (!entry) { entry = new Map(); this.positions.set(key, entry) }
    let stats = entry.get(uci)
    if (!stats) { stats = [0, 0, 0, 0]; entry.set(uci, stats) }
    for (let i = 0; i < 4; i++) stats[i] += counts[i] || 0
  }
}

const LONG_SAN = /^[NBRQK]?([a-h][1-8])x?([a-h][1-8])=?([NBRQ])?$/

// The engine's SAN writer emits the shortest legal spelling, so `sanToMove`
// misses the fully disambiguated form ("Nb8d7") and the zero-castling that a
// few clients in the database still use.
function resolveSan (board, san) {
  const move = sanToMove(board, san)
  if (move) return move
  const clean = san.replace(/[+#!?]/g, '')
  if (clean === '0-0' || clean === '0-0-0') return sanToMove(board, clean.replace(/0/g, 'O'))
  const long = LONG_SAN.exec(clean)
  return long ? uciToMove(board, long[1] + long[2] + (long[3] || 'q').toLowerCase()) : 0
}

// Replays one game on the engine board and returns its (key, uci, mover)
// records, or null when any move inside the book depth fails to parse — a game
// we cannot follow exactly is a game we cannot trust.
function replay (tokens, plies) {
  const board = new Board()
  const limit = Math.min(plies, tokens.length)
  const records = []
  for (let i = 0; i < limit; i++) {
    const move = resolveSan(board, tokens[i])
    if (!move) return null
    const key = positionKey(board)
    const uci = moveToUci(move)
    const mover = board.turn
    if (!board.makeMove(move)) return null
    records.push([key, uci, mover])
  }
  return records
}

function loadExisting (path) {
  const book = new Book()
  if (!existsSync(path)) return book
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  for (const [key, moves] of Object.entries(parsed.positions || {})) {
    for (const [uci, counts] of Object.entries(moves)) book.merge(key, uci, counts)
  }
  book.games = Number(parsed.header && parsed.header.games) || 0
  return book
}

// Positions that only a handful of games ever reached say more about those
// games than about the opening, so they are dropped before anything is written.
function prune (book, minGames) {
  const keys = []
  let moves = 0
  for (const [key, entry] of book.positions) {
    let total = 0
    for (const stats of entry.values()) total += stats[0]
    if (total < minGames) continue
    keys.push(key)
    moves += entry.size
  }
  return { keys, moves }
}

// Written a position at a time so a large book never has to exist as one string.
async function write (path, book, header, keys) {
  mkdirSync(dirname(path), { recursive: true })
  const stream = createWriteStream(path)
  const put = (text) => stream.write(text) || new Promise((done) => stream.once('drain', done))

  await put(`{"header":${JSON.stringify(header)},"positions":{`)
  let first = true
  for (const key of keys) {
    const body = []
    for (const [uci, stats] of book.positions.get(key)) body.push(`${JSON.stringify(uci)}:[${stats.join(',')}]`)
    await put(`${first ? '' : ','}${JSON.stringify(key)}:{${body.join(',')}}`)
    first = false
  }
  await put('}}')
  await new Promise((done, error) => { stream.on('error', error); stream.end(done) })
}

// --- run ---------------------------------------------------------------------

async function main () {
  const options = parseArgs(process.argv)
  const out = resolve(ROOT, options.out)
  const state = { stop: false, bytes: 0 }
  const book = options.append ? loadExisting(out) : new Book()
  if (options.append && book.positions.size) process.stderr.write(`resuming from ${book.positions.size} positions in ${options.out}\n`)

  let seen = 0
  let ingested = 0
  let skipped = 0
  let unparsed = 0
  const started = Date.now()

  const onInterrupt = () => {
    if (state.stop) process.exit(130)
    state.stop = true
    process.stderr.write('\ninterrupted — flushing what has been read so far\n')
  }
  process.on('SIGINT', onInterrupt)
  process.on('SIGTERM', onInterrupt)

  const progress = () => {
    const seconds = (Date.now() - started) / 1000
    const mb = (state.bytes / 1024 / 1024).toFixed(1)
    process.stderr.write(`\r${ingested} games · ${book.positions.size} positions · ${mb} MB read · ${Math.round(ingested / Math.max(seconds, 0.001))}/s   `)
  }

  for await (const game of readGames(options, state)) {
    seen++
    if (seen % 2000 === 0) progress()
    const tags = game.tags
    const result = RESULTS[tags.Result]
    if (!result) continue
    if (tags.Variant && tags.Variant !== 'Standard') continue
    if (tags.FEN || tags.SetUp === '1') continue
    if (rating(tags) < options.minRating) continue
    const tokens = sanTokens(game.movetext)
    if (tokens.length < MIN_GAME_PLIES) continue
    if (skipped < options.skip) { skipped++; continue }

    const records = replay(tokens, options.plies)
    if (!records) { unparsed++; continue }
    for (const [key, uci, mover] of records) {
      const side = mover === WHITE ? 'white' : 'black'
      book.add(key, uci, result === side, result === 'draw')
    }
    ingested++
    if (ingested >= options.games) { state.stop = true; break }
  }
  progress()
  process.stderr.write('\n')

  const { keys, moves } = prune(book, options.minGames)
  const header = {
    variant: options.variant,
    generated: new Date().toISOString(),
    source: options.source,
    games: book.games + ingested,
    plies: options.plies,
    minRating: options.minRating,
    minGames: options.minGames,
    positions: keys.length,
    moves
  }
  await write(out, book, header, keys)

  const bytes = statSync(out).size
  process.stderr.write([
    `games scanned      ${seen}`,
    `games ingested     ${ingested}${unparsed ? ` (${unparsed} dropped on an unparsable move)` : ''}`,
    `positions seen     ${book.positions.size}`,
    `positions kept     ${keys.length} (>= ${options.minGames} games)`,
    `moves kept         ${moves}`,
    `output             ${options.out} — ${(bytes / 1024).toFixed(1)} KB`,
    ''
  ].join('\n'))
}

main().catch((error) => { process.stderr.write(`build-book: ${error.message}\n`); process.exit(1) })
