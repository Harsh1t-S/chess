// The opening book built by tools/build-book.mjs from real games.
//
// It is a static asset keyed by the same Zobrist position hash the rest of the
// learning system uses, so it merges with what the engine learns from its own
// games: the book supplies theory it has never played, the local records supply
// the mistakes it has actually made.
const BOOK_URL = `${import.meta.env.BASE_URL || '/'}book/classic.json`.replace(/\/{2,}/g, '/')

// Only positions with real support get an opinion, and the nudge stays small
// enough that a tactic always outweighs it.
const MIN_POSITION_GAMES = 20
const MIN_MOVE_GAMES = 3
const MAX_BONUS = 90
const MAX_PENALTY = -60

let positions = null
let loading = null

export async function loadBook () {
  if (positions) return positions
  if (loading) return loading
  loading = fetch(BOOK_URL)
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      positions = (data && (data.positions || data)) || {}
      return positions
    })
    .catch(() => {
      positions = {}
      return positions
    })
  return loading
}

export function bookStats () {
  if (!positions) return { positions: 0, loaded: false }
  return { positions: Object.keys(positions).length, loaded: true }
}

// Centipawn nudges keyed by UCI, in the same form the search's rootBias takes.
export function bookBias (variant, positionKey) {
  if (variant !== 'classic' || !positions) return null
  const entry = positions[positionKey]
  if (!entry) return null

  let total = 0
  for (const stats of Object.values(entry)) total += stats[0]
  if (total < MIN_POSITION_GAMES) return null

  const bias = {}
  let any = false
  for (const [uci, [games, wins, draws]] of Object.entries(entry)) {
    if (games < MIN_MOVE_GAMES) continue
    const share = games / total
    const score = (wins + draws * 0.5) / games
    const confidence = Math.min(1, games / 30)
    // how well the move does, plus a smaller pull towards the main lines
    const value = ((score - 0.5) * 120 + Math.log2(1 + share * 8) * 18) * confidence
    const rounded = Math.round(Math.max(MAX_PENALTY, Math.min(MAX_BONUS, value)))
    if (rounded !== 0) { bias[uci] = rounded; any = true }
  }
  return any ? bias : null
}

// Learned-from-play records win where the two disagree: they describe mistakes
// this engine actually made, which matters more than what the crowd plays.
export function mergeBias (bookSide, learned) {
  if (!bookSide) return learned
  if (!learned) return bookSide
  return { ...bookSide, ...learned }
}
