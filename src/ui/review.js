// Post-game review: accuracy, an evaluation graph and every move classified.
import { QUALITY, QUALITY_ORDER, qualityOf } from './quality.js'

const clampEval = (cp) => Math.max(-1000, Math.min(1000, cp))

export function summarise (review) {
  const blank = () => Object.fromEntries(QUALITY_ORDER.map((key) => [key, 0]))
  const counts = { w: blank(), b: blank() }
  for (const item of review || []) {
    const bucket = counts[item.mover]
    if (bucket && bucket[item.quality] !== undefined) bucket[item.quality]++
  }
  return counts
}

function evalGraph (evals) {
  if (!evals || evals.length < 2) return '<div class="review-graph empty">No evaluation data</div>'
  const width = 100
  const height = 100
  const step = width / (evals.length - 1)
  const toY = (cp) => 50 - (clampEval(cp) / 1000) * 50
  let path = `M 0 ${toY(evals[0])}`
  evals.forEach((cp, index) => { if (index) path += ` L ${(index * step).toFixed(2)} ${toY(cp).toFixed(2)}` })
  const area = `${path} L ${width} ${height} L 0 ${height} Z`
  const areaTop = `${path} L ${width} 0 L 0 0 Z`
  return `
    <svg class="review-graph" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Evaluation over the game">
      <rect x="0" y="0" width="100" height="100" class="graph-black"></rect>
      <path d="${areaTop}" class="graph-white"></path>
      <line x1="0" y1="50" x2="100" y2="50" class="graph-mid"></line>
      <path d="${path}" class="graph-line"></path>
      <path d="${area}" class="graph-hit"></path>
    </svg>`
}

export function renderReview (container, data, handlers = {}) {
  if (!data || !data.review || !data.review.length) {
    container.innerHTML = '<div class="review-empty"><h3>No review yet</h3><p>Finish a game and the engine will analyse every move.</p></div>'
    return
  }
  const counts = summarise(data.review)
  const rows = []
  for (let i = 0; i < data.review.length; i += 2) {
    rows.push([data.review[i], data.review[i + 1] || null])
  }
  const cell = (item) => {
    if (!item) return '<span class="review-move empty"></span>'
    const quality = qualityOf(item.quality)
    return `<button class="review-move ${quality.className}" data-ply="${item.ply}" title="${quality.label}${item.loss ? ` · -${(item.loss / 100).toFixed(2)}` : ''}">
      <span class="review-san">${item.san || item.uci}</span><span class="review-badge">${quality.icon}</span>
    </button>`
  }
  const bar = (color) => {
    const bucket = counts[color]
    return `<div class="review-counts">
      ${QUALITY_ORDER.filter((key) => key !== 'brilliant' || bucket.brilliant).map((key) => `
        <span class="${QUALITY[key].className}"><b>${bucket[key]}</b>${QUALITY[key].label}</span>`).join('')}
    </div>`
  }

  container.innerHTML = `
    <div class="review-head">
      <div class="review-accuracy">
        <div class="side white"><small>White</small><strong>${data.accuracy.w}%</strong></div>
        <span class="review-accuracy-label">Accuracy</span>
        <div class="side black"><small>Black</small><strong>${data.accuracy.b}%</strong></div>
      </div>
      ${evalGraph(data.evals)}
      ${data.engine ? `<p class="review-engine">Analysed by ${data.engine}</p>` : ''}
    </div>
    <div class="review-breakdown">
      <div><h4>White</h4>${bar('w')}</div>
      <div><h4>Black</h4>${bar('b')}</div>
    </div>
    <div class="review-moves">
      ${rows.map(([white, black], index) => `
        <div class="review-row">
          <span class="review-number">${index + 1}.</span>
          ${cell(white)}${cell(black)}
        </div>`).join('')}
    </div>`

  container.querySelectorAll('[data-ply]').forEach((button) => {
    button.addEventListener('click', () => handlers.onSelectPly?.(Number(button.dataset.ply) + 1))
  })
}

export { QUALITY }
