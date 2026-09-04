// Stockfish client. Loaded on demand from a CDN and driven over UCI in its own
// worker, so it is a separate program we talk to rather than code we ship.
//
// This build (stockfish.js 10) uses the handcrafted evaluation, so it needs no
// NNUE network file: about 620 KB in total for an engine several hundred Elo
// above anything we could reasonably write here. It is used for judging
// positions — the evaluation bar, hints and post-game review — while the local
// engine remains what actually plays, since that is where the bot personalities
// and the learning bias live.
//
// Stockfish is GPL-3.0. It is fetched unmodified from the CDN at runtime and
// never redistributed as part of this project.
export const STOCKFISH_BASE = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/'
export const STOCKFISH_CREDIT = {
  name: 'Stockfish 10',
  url: 'https://stockfishchess.org/',
  license: 'GPL-3.0'
}

const MATE_SCORE = 32000
const START_TIMEOUT = 15000
const SEARCH_TIMEOUT = 20000

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
      const glue = JSON.stringify(this.base + 'stockfish.wasm.js')
      const binary = JSON.stringify(this.base + 'stockfish.wasm')
      const bootstrap = `
        var queued = [];
        self.onmessage = function (event) { queued.push(event.data) };

        // The glue assigns its own object to Module, discarding anything set
        // beforehand, so the assignment is intercepted and the pre-fetched
        // binary is merged into whatever it installs.
        var config = {};
        Object.defineProperty(self, 'Module', {
          configurable: true,
          get: function () { return config },
          set: function (value) {
            if (value && typeof value === 'object' && config.wasmBinary) value.wasmBinary = config.wasmBinary;
            config = value;
          }
        });

        fetch(${binary})
          .then(function (response) {
            if (!response.ok) throw new Error('wasm ' + response.status);
            return response.arrayBuffer();
          })
          .then(function (buffer) {
            config.wasmBinary = buffer;
            importScripts(${glue});
            var handler = self.onmessage;
            var pending = queued;
            queued = null;
            for (var i = 0; i < pending.length; i++) handler({ data: pending[i] });
          })
          .catch(function (error) { self.postMessage('forgechess-load-error: ' + error.message) });
      `
      const url = URL.createObjectURL(new Blob([bootstrap], { type: 'application/javascript' }))
      this.worker = new Worker(url)
      URL.revokeObjectURL(url)
      this.worker.onmessage = (event) => {
        const line = typeof event.data === 'string' ? event.data : (event.data && event.data.data)
        if (typeof line === 'string') for (const listener of [...this.listeners]) listener(line)
      }
      this.worker.onerror = () => { this.failed = true }

      await this.expect('uci', (line) => line === 'uciok', START_TIMEOUT)
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
