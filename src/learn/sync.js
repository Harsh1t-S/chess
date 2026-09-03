// Mirrors the local learning store into Supabase. Every call fails soft: the
// app is fully playable, and keeps learning, with no network at all.
import { SUPABASE_URL, SUPABASE_KEY, SYNC_ENABLED } from '../config.js'
import { mergeRemote, takeOutbox, clearOutbox, deviceId, getMeta, setMeta } from './store.js'

const PULL_INTERVAL = 6 * 60 * 60 * 1000
let online = true

async function rpc (name, body, timeoutMs = 9000) {
  if (!SYNC_ENABLED || !SUPABASE_URL || !SUPABASE_KEY) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal
    })
    if (!response.ok) { online = false; return null }
    online = true
    const text = await response.text()
    return text ? JSON.parse(text) : null
  } catch {
    online = false
    return null
  } finally {
    clearTimeout(timer)
  }
}

export const isOnline = () => online && SYNC_ENABLED

// Pull the shared book for a variant into IndexedDB, at most once per interval.
export async function pullBook (variant, { force = false } = {}) {
  const stamp = await getMeta(`pull:${variant}`, 0)
  if (!force && Date.now() - stamp < PULL_INTERVAL) return 0
  const rows = await rpc('chess_book_top', { p_variant: variant, p_limit: 2000 })
  if (!Array.isArray(rows)) return 0
  const merged = await mergeRemote(rows.map((row) => ({
    variant: row.variant,
    position: row.position_key,
    uci: row.uci,
    games: row.games,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    cp_loss_sum: Number(row.cp_loss_sum) || 0,
    mistakes: row.mistakes
  })))
  await setMeta(`pull:${variant}`, Date.now())
  return merged
}

// Push everything queued locally. Book deltas go up in one batched call.
export async function flush () {
  const items = await takeOutbox()
  if (!items.length) return 0
  const device = await deviceId()
  const bookDeltas = []
  const games = []
  const ids = []
  for (const item of items) {
    ids.push(item.id)
    if (item.kind === 'book') bookDeltas.push(...item.deltas)
    else if (item.kind === 'game') games.push({ ...item.game, device })
  }

  let ok = true
  for (let i = 0; i < bookDeltas.length; i += 1500) {
    const chunk = bookDeltas.slice(i, i + 1500)
    const result = await rpc('chess_book_merge', { p_entries: chunk })
    if (result === null) { ok = false; break }
  }
  if (ok) {
    for (const game of games) {
      const result = await rpc('chess_game_log', { p_game: game })
      if (result === null) { ok = false; break }
    }
  }
  if (!ok) return 0
  await clearOutbox(ids)
  return ids.length
}

export async function globalStats () {
  const rows = await rpc('chess_learning_stats', {})
  if (!Array.isArray(rows) || !rows.length) return null
  const row = rows[0]
  return {
    positions: Number(row.positions) || 0,
    entries: Number(row.entries) || 0,
    games: Number(row.games_recorded) || 0,
    mistakes: Number(row.mistakes) || 0
  }
}
