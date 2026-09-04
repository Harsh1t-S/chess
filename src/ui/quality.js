// How a reviewed move is named, marked and coloured. Shared so the badge on
// the board and the row in the review list can never disagree about what a
// move was called.
//
// The order is worst to best: it is the order the breakdown counts are read in
// and the order a player scans when looking for what went wrong.
export const QUALITY = {
  blunder: { label: 'Blunder', icon: '??', className: 'q-blunder', color: '#fa412d' },
  mistake: { label: 'Mistake', icon: '?', className: 'q-mistake', color: '#ffa459' },
  inaccuracy: { label: 'Inaccuracy', icon: '?!', className: 'q-inaccuracy', color: '#f7c631' },
  good: { label: 'Good', icon: '✓', className: 'q-good', color: '#96af8b' },
  best: { label: 'Best', icon: '★', className: 'q-best', color: '#95bb4a' },
  brilliant: { label: 'Brilliant', icon: '!!', className: 'q-brilliant', color: '#26c2a3' }
}

export const QUALITY_ORDER = ['blunder', 'mistake', 'inaccuracy', 'good', 'best', 'brilliant']
export const qualityOf = (key) => QUALITY[key] || QUALITY.good
