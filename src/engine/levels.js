// Engine personalities.
//
// `play` is the difficulty dial and is read directly by the search:
//   best        chance of simply playing the best move it found
//   temperature spread, in centipawns, when it does settle for something else
//   maxLoss     hard ceiling — it will never choose a move worse than this
//
// The shape matters as much as the numbers: a rated player is mostly accurate
// and occasionally wrong, so a high `best` with a modest tail reads far more
// human than sampling every move every time.
//
// `think` is how long the bot appears to deliberate, in milliseconds, before
// its move appears. Without it even a deep search answers instantly and the
// game feels mechanical.
export const LEVELS = {
  nova: {
    id: 'nova',
    name: 'Nova',
    rating: 600,
    label: 'Beginner',
    depth: 2,
    movetime: 220,
    skill: 0,
    fog: 1,
    play: { best: 0.10, temperature: 320, maxLoss: 900 },
    think: 450,
    blurb: 'Hangs pieces and misses one-movers. A real beginner.'
  },
  ember: {
    id: 'ember',
    name: 'Ember',
    rating: 900,
    label: 'Casual',
    depth: 3,
    movetime: 350,
    skill: 4,
    fog: 1,
    play: { best: 0.20, temperature: 230, maxLoss: 700 },
    think: 520,
    blurb: 'Spots most captures, still walks into tactics.'
  },
  anvil: {
    id: 'anvil',
    name: 'Anvil',
    rating: 1200,
    label: 'Club',
    depth: 5,
    movetime: 650,
    skill: 9,
    fog: 2,
    play: { best: 0.38, temperature: 150, maxLoss: 430 },
    think: 700,
    blurb: 'Sound development. Punishes anything you hang.'
  },
  titan: {
    id: 'titan',
    name: 'Titan',
    rating: 1550,
    label: 'Advanced',
    depth: 8,
    movetime: 1100,
    skill: 14,
    fog: 3,
    play: { best: 0.60, temperature: 90, maxLoss: 240 },
    think: 950,
    blurb: 'Calculates real tactics and converts endgames.'
  },
  forge: {
    id: 'forge',
    name: 'Forge',
    rating: 1900,
    label: 'Expert',
    depth: 11,
    movetime: 2000,
    skill: 17,
    fog: 4,
    play: { best: 0.80, temperature: 45, maxLoss: 130 },
    think: 1250,
    blurb: 'Deep search. Gives almost nothing away.'
  },
  obsidian: {
    id: 'obsidian',
    name: 'Obsidian',
    rating: 2300,
    label: 'Master',
    depth: 64,
    movetime: 3200,
    skill: 20,
    fog: 5,
    play: { best: 1, temperature: 0, maxLoss: 0 },
    think: 1500,
    blurb: 'Full strength, no handicap. Always its best move.'
  }
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
