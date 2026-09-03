// IndexedDB-backed learning store. Everything here works offline; the Supabase
// layer in sync.js only mirrors what already lives locally.

const DB_NAME = 'forgechess'
const DB_VERSION = 1
const BOOK_LIMIT = 24000

let dbPromise = null

function openDb () {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('book')) {
        const book = db.createObjectStore('book', { keyPath: 'id' })
        book.createIndex('variant', 'variant')
        book.createIndex('updated', 'updated')
      }
      if (!db.objectStoreNames.contains('games')) {
        const games = db.createObjectStore('games', { keyPath: 'id', autoIncrement: true })
        games.createIndex('finished', 'finished')
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch((error) => { dbPromise = null; throw error })
  return dbPromise
}

function tx (db, stores, mode) {
  const transaction = db.transaction(stores, mode)
  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
  return { transaction, done }
}

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

const bookId = (variant, position) => `${variant}|${position}`
const emptyMove = () => ({ g: 0, w: 0, d: 0, l: 0, cp: 0, m: 0 })

// --- reads ------------------------------------------------------------------

export async function getBookEntry (variant, position) {
  try {
    const db = await openDb()
    const { transaction } = tx(db, ['book'], 'readonly')
    return (await request(transaction.objectStore('book').get(bookId(variant, position)))) || null
  } catch { return null }
}

// Root-move bias in centipawns: punish moves this engine has blundered with,
// gently reward moves that have historically won from here.
export function biasFromEntry (entry) {
  if (!entry || !entry.moves) return null
  const bias = {}
  let any = false
  for (const [uci, stats] of Object.entries(entry.moves)) {
    let value = 0
    if (stats.m > 0) {
      const averageLoss = stats.cp / stats.m
      value -= Math.min(280, averageLoss * Math.min(1, stats.m / 2) * 0.85)
    }
    if (stats.g > 0) {
      const rate = (stats.w + stats.d * 0.5) / stats.g
      value += (rate - 0.5) * 2 * 70 * Math.min(1, stats.g / 5)
    }
    const rounded = Math.round(Math.max(-300, Math.min(90, value)))
    if (rounded !== 0) { bias[uci] = rounded; any = true }
  }
  return any ? bias : null
}

export async function getBias (variant, position) {
  return biasFromEntry(await getBookEntry(variant, position))
}

export async function listGames (limit = 40) {
  try {
    const db = await openDb()
    const { transaction } = tx(db, ['games'], 'readonly')
    const store = transaction.objectStore('games')
    const all = await request(store.getAll())
    return all.sort((a, b) => b.finished - a.finished).slice(0, limit)
  } catch { return [] }
}

export async function getGame (id) {
  try {
    const db = await openDb()
    const { transaction } = tx(db, ['games'], 'readonly')
    return (await request(transaction.objectStore('games').get(id))) || null
  } catch { return null }
}

export async function getMeta (key, fallback = null) {
  try {
    const db = await openDb()
    const { transaction } = tx(db, ['meta'], 'readonly')
    const row = await request(transaction.objectStore('meta').get(key))
    return row ? row.value : fallback
  } catch { return fallback }
}

export async function setMeta (key, value) {
  try {
    const db = await openDb()
    const { transaction, done } = tx(db, ['meta'], 'readwrite')
    transaction.objectStore('meta').put({ key, value })
    await done
  } catch { /* offline or storage blocked */ }
}

export async function deviceId () {
  let id = await getMeta('device')
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await setMeta('device', id)
  }
  return id
}

export async function stats () {
  try {
    const db = await openDb()
    const { transaction } = tx(db, ['book', 'games'], 'readonly')
    const bookStore = transaction.objectStore('book')
    const gameStore = transaction.objectStore('games')
    const [positions, games, entries] = await Promise.all([
      request(bookStore.count()),
      request(gameStore.count()),
      request(bookStore.getAll())
    ])
    let mistakes = 0
    let learnedMoves = 0
    for (const entry of entries) {
      for (const stat of Object.values(entry.moves || {})) {
        learnedMoves++
        mistakes += stat.m || 0
      }
    }
    return { positions, games, mistakes, learnedMoves }
  } catch { return { positions: 0, games: 0, mistakes: 0, learnedMoves: 0 } }
}

// --- writes -----------------------------------------------------------------

// Folds a finished, reviewed game into the book. `review` entries come from the
// worker and carry the position key, the played move and its centipawn loss.
export async function recordGame (game) {
  const deltas = buildDeltas(game)
  try {
    const db = await openDb()
    const { transaction, done } = tx(db, ['book', 'games', 'outbox'], 'readwrite')
    const bookStore = transaction.objectStore('book')
    const now = Date.now()
    for (const delta of deltas) {
      const id = bookId(delta.variant, delta.position)
      const existing = await request(bookStore.get(id))
      const entry = existing || { id, variant: delta.variant, position: delta.position, moves: {}, updated: now }
      const stats = entry.moves[delta.uci] || emptyMove()
      stats.g += delta.g
      stats.w += delta.w
      stats.d += delta.d
      stats.l += delta.l
      stats.cp += delta.cp
      stats.m += delta.m
      entry.moves[delta.uci] = stats
      entry.updated = now
      bookStore.put(entry)
    }
    const stored = { ...game, finished: now }
    transaction.objectStore('games').add(stored)
    if (deltas.length) transaction.objectStore('outbox').add({ kind: 'book', deltas, at: now })
    transaction.objectStore('outbox').add({ kind: 'game', game: summarise(stored), at: now })
    await done
    await prune()
    return deltas.length
  } catch { return 0 }
}

function summarise (game) {
  return {
    variant: game.variant,
    result: game.result,
    reason: game.reason,
    level: game.level,
    humanSide: game.humanSide,
    mode: game.mode,
    plies: (game.moves || []).length,
    moves: (game.moves || []).slice(0, 120),
    accuracyWhite: game.accuracy ? game.accuracy.w : null,
    accuracyBlack: game.accuracy ? game.accuracy.b : null
  }
}

// One delta per (position, move): result counters for both sides, plus a
// mistake record whenever the move lost real evaluation.
function buildDeltas (game) {
  const review = game.review || []
  const variant = game.variant
  const result = game.result
  const deltas = []
  for (const item of review) {
    if (!item.position || !item.uci) continue
    const mover = item.mover
    const won = result === mover
    const drawn = result === 'draw'
    const loss = Math.max(0, Math.min(1200, item.loss || 0))
    const isMistake = loss >= 60
    if (item.ply >= 40 && !isMistake) continue
    deltas.push({
      variant,
      position: item.position,
      uci: item.uci,
      g: 1,
      w: won ? 1 : 0,
      d: drawn ? 1 : 0,
      l: !won && !drawn ? 1 : 0,
      cp: isMistake ? Math.round(loss) : 0,
      m: isMistake ? 1 : 0
    })
  }
  return deltas
}

// Merge rows pulled from Supabase without double counting: remote totals
// replace local ones when they are strictly larger.
export async function mergeRemote (rows) {
  if (!rows || !rows.length) return 0
  try {
    const db = await openDb()
    const { transaction, done } = tx(db, ['book'], 'readwrite')
    const store = transaction.objectStore('book')
    const now = Date.now()
    let merged = 0
    for (const row of rows) {
      const id = bookId(row.variant, row.position)
      const existing = await request(store.get(id))
      const entry = existing || { id, variant: row.variant, position: row.position, moves: {}, updated: now }
      const stats = entry.moves[row.uci] || emptyMove()
      if (row.games > stats.g) {
        stats.g = row.games
        stats.w = row.wins
        stats.d = row.draws
        stats.l = row.losses
        stats.cp = row.cp_loss_sum
        stats.m = row.mistakes
        entry.moves[row.uci] = stats
        entry.updated = now
        merged++
      }
      store.put(entry)
    }
    await done
    return merged
  } catch { return 0 }
}

export async function takeOutbox (limit = 400) {
  try {
    const db = await openDb()
    const { transaction } = tx(db, ['outbox'], 'readonly')
    const all = await request(transaction.objectStore('outbox').getAll())
    return all.slice(0, limit)
  } catch { return [] }
}

export async function clearOutbox (ids) {
  if (!ids || !ids.length) return
  try {
    const db = await openDb()
    const { transaction, done } = tx(db, ['outbox'], 'readwrite')
    const store = transaction.objectStore('outbox')
    for (const id of ids) store.delete(id)
    await done
  } catch { /* keep them queued for the next attempt */ }
}

async function prune () {
  try {
    const db = await openDb()
    const { transaction } = tx(db, ['book'], 'readonly')
    const count = await request(transaction.objectStore('book').count())
    if (count <= BOOK_LIMIT) return
    const write = tx(db, ['book'], 'readwrite')
    const index = write.transaction.objectStore('book').index('updated')
    let remaining = count - BOOK_LIMIT
    await new Promise((resolve) => {
      const cursorRequest = index.openCursor()
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (!cursor || remaining <= 0) { resolve(); return }
        cursor.delete()
        remaining--
        cursor.continue()
      }
      cursorRequest.onerror = () => resolve()
    })
    await write.done
  } catch { /* pruning is best effort */ }
}

export async function resetLearning () {
  try {
    const db = await openDb()
    const { transaction, done } = tx(db, ['book', 'games', 'outbox'], 'readwrite')
    transaction.objectStore('book').clear()
    transaction.objectStore('games').clear()
    transaction.objectStore('outbox').clear()
    await done
    return true
  } catch { return false }
}
