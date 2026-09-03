// Engine personalities. `skill` drives how often the search settles for a
// second-best move, which is what makes the lower bots feel human rather than
// randomly awful.
export const LEVELS = {
  nova: { id: 'nova', name: 'Nova', rating: 600, label: 'Beginner', depth: 2, movetime: 200, skill: 0, fog: 1, blurb: 'Hangs pieces and misses one-movers. A real beginner.' },
  ember: { id: 'ember', name: 'Ember', rating: 900, label: 'Casual', depth: 3, movetime: 350, skill: 4, fog: 1, blurb: 'Spots most captures, still walks into tactics.' },
  anvil: { id: 'anvil', name: 'Anvil', rating: 1200, label: 'Club', depth: 5, movetime: 700, skill: 9, fog: 2, blurb: 'Sound development. Punishes anything you hang.' },
  titan: { id: 'titan', name: 'Titan', rating: 1550, label: 'Advanced', depth: 8, movetime: 1200, skill: 14, fog: 3, blurb: 'Calculates real tactics and converts endgames.' },
  forge: { id: 'forge', name: 'Forge', rating: 1900, label: 'Expert', depth: 11, movetime: 2200, skill: 17, fog: 4, blurb: 'Deep search. Gives almost nothing away.' },
  obsidian: { id: 'obsidian', name: 'Obsidian', rating: 2300, label: 'Master', depth: 64, movetime: 3800, skill: 20, fog: 5, blurb: 'Full strength, no handicap. Always its best move.' }
}

export const LEVEL_ORDER = ['nova', 'ember', 'anvil', 'titan', 'forge', 'obsidian']
export const DEFAULT_LEVEL = 'anvil'
export const getLevel = (id) => LEVELS[id] || LEVELS[DEFAULT_LEVEL]

export const TIME_CONTROLS = {
  unlimited: { id: 'unlimited', name: 'Unlimited', initial: 0, increment: 0, group: 'Casual' },
  bullet1: { id: 'bullet1', name: '1 min', initial: 60, increment: 0, group: 'Bullet' },
  bullet2: { id: 'bullet2', name: '1 | 1', initial: 60, increment: 1, group: 'Bullet' },
  blitz3: { id: 'blitz3', name: '3 min', initial: 180, increment: 0, group: 'Blitz' },
  blitz32: { id: 'blitz32', name: '3 | 2', initial: 180, increment: 2, group: 'Blitz' },
  blitz5: { id: 'blitz5', name: '5 min', initial: 300, increment: 0, group: 'Blitz' },
  rapid10: { id: 'rapid10', name: '10 min', initial: 600, increment: 0, group: 'Rapid' },
  rapid15: { id: 'rapid15', name: '15 | 10', initial: 900, increment: 10, group: 'Rapid' }
}
export const TIME_CONTROL_ORDER = ['unlimited', 'bullet1', 'bullet2', 'blitz3', 'blitz32', 'blitz5', 'rapid10', 'rapid15']
export const getTimeControl = (id) => TIME_CONTROLS[id] || TIME_CONTROLS.unlimited
