// Stockfish client. Loaded on demand from a CDN and driven over UCI in its own
// worker, so it is a separate program we talk to rather than code we ship.
//
// This is the Stockfish 16 single-threaded WASM build: 575 KB, no thread or
// SharedArrayBuffer requirements, and no network file to download — that build
// has NNUE off by default and uses Stockfish's classical evaluation, which is
// still far ahead of anything reasonable to write here. It judges positions for
// the evaluation bar, hints and post-game review, while the local engine
// remains what actually plays.
//
// Two things make loading it awkward. Emscripten blanks its script directory
// for `blob:` workers, so the relative path to its .wasm cannot resolve; the
// glue is therefore fetched as text and that one filename rewritten to an
// absolute URL before the worker is created. And the engine installs its
// message handler only after the wasm is up, so an early command is dropped —
// `uci` is repeated until it answers.
//
// Stockfish is GPL-3.0. It is fetched unmodified from the CDN at runtime (the
// rewrite happens in memory, in the browser) and is never redistributed here.
export const STOCKFISH_BASE = 'https://cdn.jsdelivr.net/npm/stockfish@16.0.0/src/'
export const STOCKFISH_GLUE = 'stockfish-nnue-16-single.js'
export const STOCKFISH_WASM = 'stockfish-nnue-16-single.wasm'
export const STOCKFISH_CREDIT = {
  name: 'Stockfish 16',
  url: 'https://stockfishchess.org/',
  license: 'GPL-3.0'
}

const MATE_SCORE = 32000
const START_TIMEOUT = 45000
const SEARCH_TIMEOUT = 30000

export class Stockfish {
  constructor (base = STOCKFISH_BASE) {
    // A blob worker has no base URL of its own, so relative paths inside the
    // bootstrap would not resolve. Absolutise here and self-hosting works too.
    this.base = typeof location !== 'undefined' ? new URL(base, location.href).href : base
    this.worker = null
    this.ready = null
    this.queue = Promise.resolve()
    this.listeners = new Set()
    this.failed = false
  }

  get available () { return !!this.worker && !this.failed }

  // Cross-origin scripts cannot be handed straight to `new Worker`, so a small
  // bootstrap is wrapped in a blob and imports the engine from there.
  //
  // Two wrinkles that bootstrap has to handle. The glue fetches its .wasm by a
  // bare relative name, which a blob worker has no base URL to resolve, so the
  // binary is fetched here and handed over as Module.wasmBinary. And the glue
  // installs its own onmessage when it loads, so any UCI command that arrives
  // before then would be dropped — commands are buffered and replayed.
  async start () {
    if (this.ready) return this.ready
    this.ready = (async () => {
      if (typeof Worker === 'undefined') throw new Error('workers unavailable')
      const glueUrl = this.base + STOCKFISH_GLUE
      const response = await fetch(glueUrl)
      if (!response.ok) throw new Error(`stockfish glue ${response.status}`)
      let source = await response.text()
      if (!source.includes(STOCKFISH_WASM)) throw new Error('unexpected stockfish build')
      source = source.split(STOCKFISH_WASM).join(this.base + STOCKFISH_WASM)

      const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }))
      this.worker = new Worker(url)
      URL.revokeObjectURL(url)
      this.worker.onmessage = (event) => {
        const line = typeof event.data === 'string' ? event.data : (event.data && event.data.data)
        if (typeof line === 'string') for (const listener of [...this.listeners]) listener(line)
      }
      this.worker.onerror = () => { this.failed = true }

      const nudge = setInterval(() => this.send('uci'), 400)
      try {
        await this.expect('uci', (line) => line === 'uciok', START_TIMEOUT)
      } finally { clearInterval(nudge) }
      this.send('setoption name Hash value 32')
      this.send('setoption name Ponder value false')
      await this.expect('isready', (line) => line === 'readyok', START_TIMEOUT)
      return true
    })().catch((error) => {
      this.failed = true
      this.dispose()
      throw error
    })
    return this.ready
  }

  send (command) { if (this.worker) this.worker.postMessage(command) }

  expect (command, done, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.listeners.delete(listener); reject(new Error(`timeout: ${command}`)) }, timeout)
      const listener = (line) => {
        if (!done(line)) return
        clearTimeout(timer)
        this.listeners.delete(listener)
        resolve(line)
      }
      this.listeners.add(listener)
      if (command) this.send(command)
    })
  }

  // Searches are serialised: one engine, one search at a time.
  analyse ({ fen, moves = [], depth = 12, movetime = 0 }) {
    const run = async () => {
      await this.start()
      const position = `position fen ${fen}${moves.length ? ` moves ${moves.join(' ')}` : ''}`
      this.send(position)
      let score = 0
      let mate = null
      let seenDepth = 0
      let pv = []
      const collect = (line) => {
        if (!line.startsWith('info')) return false
        const depthMatch = line.match(/\bdepth (\d+)/)
        const cpMatch = line.match(/\bscore cp (-?\d+)/)
        const mateMatch = line.match(/\bscore mate (-?\d+)/)
        const pvMatch = line.match(/\bpv (.+)$/)
        if (depthMatch) seenDepth = Number(depthMatch[1])
        if (cpMatch) { score = Number(cpMatch[1]); mate = null }
        if (mateMatch) {
          mate = Number(mateMatch[1])
          score = mate > 0 ? MATE_SCORE - mate * 2 : -MATE_SCORE - mate * 2
        }
        if (pvMatch) pv = pvMatch[1].trim().split(/\s+/)
        return false
      }
      const finished = (line) => {
        collect(line)
        return line.startsWith('bestmove')
      }
      const command = movetime ? `go movetime ${movetime}` : `go depth ${depth}`
      const last = await this.expect(command, finished, SEARCH_TIMEOUT)
      const best = last.split(/\s+/)[1]
      return {
        score,
        mate,
        depth: seenDepth,
        best: best && best !== '(none)' ? best : null,
        pv,
        engine: 'stockfish'
      }
    }
    // chain onto the queue but do not let one failure poison the next call
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => {})
    return result
  }

  stop () { this.send('stop') }

  dispose () {
    if (this.worker) { try { this.worker.terminate() } catch { /* already gone */ } }
    this.worker = null
    this.listeners.clear()
  }
}

let shared = null
export function getStockfish (base) {
  if (!shared) shared = new Stockfish(base || STOCKFISH_BASE)
  return shared
}
