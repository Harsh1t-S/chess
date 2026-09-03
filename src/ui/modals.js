// Dialogs: promotion picker, end-of-game result card and generic modals.
import { pieceUrl, PIECE_GLYPHS } from './themes.js'

export function openModal (html, { className = '', onClose = null } = {}) {
  const dialog = document.createElement('dialog')
  dialog.className = `fc-modal ${className}`.trim()
  dialog.innerHTML = html
  document.body.append(dialog)
  const close = (value) => {
    if (!dialog.open) return
    dialog.close()
    dialog.remove()
    onClose?.(value)
  }
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(null) })
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(null) })
  dialog.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => close(button.dataset.close))
  })
  dialog.showModal()
  return { dialog, close }
}

// Chess.com-style promotion column anchored over the promotion square.
export function promptPromotion (color, square, boardElement, themeId, flipped) {
  return new Promise((resolve) => {
    const layer = document.createElement('div')
    layer.className = 'promotion-layer'
    const file = 'abcdefgh'.indexOf(square[0])
    const rank = Number(square[1]) - 1
    const column = flipped ? 7 - file : file
    const fromTop = color === 'w' ? !flipped : flipped
    layer.style.setProperty('--promo-column', String(column))
    layer.classList.add(fromTop ? 'from-top' : 'from-bottom')
    layer.innerHTML = `
      <div class="promotion-choices">
        ${['q', 'r', 'b', 'n'].map((type) => `
          <button class="promotion-choice" data-piece="${type}" aria-label="Promote to ${type}">
            <img src="${pieceUrl(color + type, themeId)}" alt="" onerror="this.replaceWith(document.createTextNode('${PIECE_GLYPHS[color + type]}'))">
          </button>`).join('')}
        <button class="promotion-cancel" data-piece="" aria-label="Cancel">✕</button>
      </div>`
    const finish = (value) => { layer.remove(); resolve(value || null) }
    layer.addEventListener('pointerdown', (event) => {
      const button = event.target.closest('[data-piece]')
      event.stopPropagation()
      if (!button) { finish(null); return }
      finish(button.dataset.piece || null)
    })
    boardElement.append(layer)
    void rank
  })
}

const RESULT_ICONS = { win: '♛', loss: '♚', draw: '½' }

export function showResult (result) {
  const kind = result.kind || 'draw'
  return new Promise((resolve) => {
    openModal(`
      <div class="result-card ${kind}">
        <div class="result-hero">
          <div class="result-icon">${RESULT_ICONS[kind] || '♚'}</div>
          <div class="result-kicker">${result.kicker || 'Game over'}</div>
          <h2 class="result-title">${result.title}</h2>
          <p class="result-reason">${result.reason || ''}</p>
          ${result.accuracy ? `
            <div class="result-accuracy">
              <div><small>White</small><strong>${result.accuracy.w}%</strong></div>
              <span>Accuracy</span>
              <div><small>Black</small><strong>${result.accuracy.b}%</strong></div>
            </div>` : '<div class="result-analysing">Reviewing the game…</div>'}
        </div>
        <div class="result-actions">
          <button class="ghost" data-close="review">Game review</button>
          <button class="primary" data-close="rematch">Play again</button>
        </div>
        <button class="result-dismiss" data-close="dismiss" aria-label="Close">✕</button>
      </div>`, { className: 'result-modal', onClose: resolve })
  })
}

export function toast (message, tone = 'info') {
  let host = document.querySelector('.toast-host')
  if (!host) {
    host = document.createElement('div')
    host.className = 'toast-host'
    document.body.append(host)
  }
  const element = document.createElement('div')
  element.className = `toast ${tone}`
  element.textContent = message
  host.append(element)
  requestAnimationFrame(() => element.classList.add('show'))
  setTimeout(() => {
    element.classList.remove('show')
    setTimeout(() => element.remove(), 260)
  }, 2400)
}
