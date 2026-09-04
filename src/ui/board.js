// The board component: themed squares, an animated piece layer, drag and drop,
// click-to-move, legal-move hints and right-click arrows.
import { PIECE_GLYPHS, pieceUrl } from './themes.js'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const ARROW_COLORS = ['#f2a33c', '#5a9bd5', '#63b356', '#d05a5a']

export class BoardView {
  constructor (root, handlers = {}) {
    this.root = root
    this.handlers = handlers
    this.flipped = false
    this.pieceThemeId = 'neo'
    this.pieces = new Map()
    this.squares = new Map()
    this.size = 0
    this.interactive = true
    this.drag = null
    this.rightStart = null
    this.arrows = []
    this.circles = new Map()
    this.hint = null

    root.classList.add('board-view')
    root.setAttribute('role', 'grid')
    root.setAttribute('aria-label', 'Chess board')
    root.tabIndex = -1
    root.innerHTML = `
      <div class="board-squares" role="rowgroup"></div>
      <svg class="board-fog" viewBox="0 0 100 100" aria-hidden="true" hidden>
        <defs>
          <filter id="fc-fog-feather" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="3"></feGaussianBlur>
          </filter>
          <!-- Alpha is driven from the noise's red channel, not from its own
               alpha: taking a constant colour and a near-constant alpha is what
               turns turbulence into a flat grey wash instead of cloud. -->
          <filter id="fc-fog-cloud" x="-30%" y="-30%" width="160%" height="160%">
            <feTurbulence type="fractalNoise" baseFrequency="0.38" numOctaves="5" seed="17" result="noise"></feTurbulence>
            <feColorMatrix in="noise" type="matrix"
              values="0 0 0 0 0.86  0 0 0 0 0.90  0 0 0 0 0.87  1.6 0 0 0 -0.62"></feColorMatrix>
            <feComponentTransfer>
              <feFuncA type="gamma" amplitude="1" exponent="0.75" offset="0"></feFuncA>
            </feComponentTransfer>
          </filter>
          <filter id="fc-fog-billow" x="-30%" y="-30%" width="160%" height="160%">
            <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="4" seed="41" result="billow"></feTurbulence>
            <feColorMatrix in="billow" type="matrix"
              values="0 0 0 0 0.74  0 0 0 0 0.79  0 0 0 0 0.76  2.1 0 0 0 -0.95"></feColorMatrix>
            <feGaussianBlur stdDeviation="0.7"></feGaussianBlur>
          </filter>
          <radialGradient id="fc-fog-depth" cx="50%" cy="45%" r="75%">
            <stop offset="0%" stop-color="#0d1210" stop-opacity="0.9"></stop>
            <stop offset="100%" stop-color="#040605" stop-opacity="0.99"></stop>
          </radialGradient>
          <mask id="fc-fog-mask">
            <rect x="-10" y="-10" width="120" height="120" fill="#fff"></rect>
            <g class="fog-holes" filter="url(#fc-fog-feather)"></g>
          </mask>
        </defs>
        <g mask="url(#fc-fog-mask)">
          <rect x="-10" y="-10" width="120" height="120" fill="url(#fc-fog-depth)"></rect>
          <g class="fog-drift">
            <rect x="-30" y="-30" width="160" height="160" filter="url(#fc-fog-billow)" opacity="0.62"></rect>
          </g>
          <g class="fog-drift-slow">
            <rect x="-30" y="-30" width="160" height="160" filter="url(#fc-fog-cloud)" opacity="0.3"></rect>
          </g>
        </g>
      </svg>
      <div class="board-pieces"></div>
      <svg class="board-marks" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs></defs>
        <g class="board-circles"></g>
        <g class="board-arrows"></g>
      </svg>
      <div class="board-drag-layer"></div>`

    this.squareLayer = root.querySelector('.board-squares')
    this.fogLayer = root.querySelector('.board-fog')
    this.fogHoles = root.querySelector('.fog-holes')
    this.fogKey = ''
    this.pieceLayer = root.querySelector('.board-pieces')
    this.marks = root.querySelector('.board-marks')
    this.circleGroup = root.querySelector('.board-circles')
    this.arrowGroup = root.querySelector('.board-arrows')
    this.marks.querySelector('defs').innerHTML = ARROW_COLORS.map((color, i) => `
      <marker id="fc-arrow-${i}" markerWidth="3.2" markerHeight="3.2" refX="1.6" refY="1.6" orient="auto">
        <path d="M0,0 L3.2,1.6 L0,3.2 z" fill="${color}"></path>
      </marker>`).join('')

    this.cursor = 'e1'
    this.buildSquares()
    this.bindPointer()
    this.bindKeyboard()

    this.observer = new ResizeObserver(() => this.measure())
    this.observer.observe(root)
    this.measure()
  }

  destroy () { this.observer.disconnect() }

  buildSquares () {
    const fragment = document.createDocumentFragment()
    for (let rank = 8; rank >= 1; rank--) {
      for (let fileIndex = 0; fileIndex < 8; fileIndex++) {
        const name = `${FILES[fileIndex]}${rank}`
        const square = document.createElement('div')
        square.className = `square ${(fileIndex + rank) % 2 === 0 ? 'light' : 'dark'}`
        square.dataset.square = name
        square.setAttribute('role', 'gridcell')
        square.setAttribute('aria-label', name)
        square.tabIndex = -1
        square.innerHTML = '<span class="square-hint"></span><span class="coord-rank"></span><span class="coord-file"></span>'
        fragment.append(square)
        this.squares.set(name, square)
      }
    }
    this.squareLayer.append(fragment)
    this.layoutSquares()
  }

  layoutSquares () {
    for (const [name, element] of this.squares) {
      const [column, row] = this.coords(name)
      element.style.gridColumn = String(column + 1)
      element.style.gridRow = String(row + 1)
      const showFile = row === 7
      const showRank = column === 0
      element.querySelector('.coord-file').textContent = showFile ? name[0] : ''
      element.querySelector('.coord-rank').textContent = showRank ? name[1] : ''
    }
  }

  // Screen coordinates for a square, honouring the current orientation.
  coords (name) {
    const file = FILES.indexOf(name[0])
    const rank = Number(name[1]) - 1
    return this.flipped ? [7 - file, rank] : [file, 7 - rank]
  }

  squareAt (clientX, clientY) {
    const rect = this.root.getBoundingClientRect()
    if (!rect.width) return null
    const column = Math.floor(((clientX - rect.left) / rect.width) * 8)
    const row = Math.floor(((clientY - rect.top) / rect.height) * 8)
    if (column < 0 || column > 7 || row < 0 || row > 7) return null
    const file = this.flipped ? 7 - column : column
    const rank = this.flipped ? row : 7 - row
    return `${FILES[file]}${rank + 1}`
  }

  measure () {
    const rect = this.root.getBoundingClientRect()
    this.size = rect.width / 8
    for (const [name, element] of this.pieces) this.place(element, name, false)
  }

  setFlipped (flipped) {
    if (this.flipped === flipped) return
    this.flipped = flipped
    this.fogKey = ''
    this.layoutSquares()
    for (const [name, element] of this.pieces) this.place(element, name, false)
    this.drawMarks()
  }

  setPieceTheme (themeId) {
    if (this.pieceThemeId === themeId) return
    this.pieceThemeId = themeId
    for (const element of this.pieces.values()) this.paint(element, element.dataset.code)
  }

  // Point a piece element at the themed artwork.
  paint (element, code) {
    const image = element.querySelector('img')
    const glyph = element.querySelector('.piece-glyph')
    element.dataset.code = code
    glyph.textContent = PIECE_GLYPHS[code] || ''
    // The glyph shows immediately and the artwork fades in over it, so a slow
    // or blocked CDN never leaves the board looking empty.
    element.classList.remove('loaded')
    image.onload = () => { if (image.naturalWidth) element.classList.add('loaded') }
    image.onerror = () => element.classList.remove('loaded')
    image.src = pieceUrl(code, this.pieceThemeId)
    if (image.complete && image.naturalWidth) element.classList.add('loaded')
  }

  setInteractive (value) { this.interactive = !!value }

  place (element, square, animate = true) {
    const [column, row] = this.coords(square)
    element.classList.toggle('no-anim', !animate)
    element.style.transform = `translate(${column * this.size}px, ${row * this.size}px)`
    if (!animate) {
      // force the transform to settle before transitions are re-enabled
      void element.offsetWidth
      element.classList.remove('no-anim')
    }
  }

  createPiece (code, square) {
    const element = document.createElement('div')
    element.className = 'piece'
    element.dataset.code = code
    element.dataset.square = square
    const image = document.createElement('img')
    image.alt = ''
    image.draggable = false
    const glyph = document.createElement('span')
    glyph.className = 'piece-glyph'
    element.append(image, glyph)
    this.paint(element, code)
    this.pieceLayer.append(element)
    this.place(element, square, false)
    return element
  }

  // `animate` describes the move that produced this position so the right DOM
  // node slides instead of the whole board being rebuilt.
  setPosition (map, animate = null) {
    if (animate) {
      const mover = this.pieces.get(animate.from)
      if (mover) {
        this.pieces.delete(animate.from)
        const capturedSquare = animate.epSquare || animate.to
        const captured = this.pieces.get(capturedSquare)
        if (captured && capturedSquare !== animate.from) {
          this.pieces.delete(capturedSquare)
          captured.classList.add('captured')
          setTimeout(() => captured.remove(), 180)
        }
        const existingAtTarget = this.pieces.get(animate.to)
        if (existingAtTarget && existingAtTarget !== mover) existingAtTarget.remove()
        this.pieces.set(animate.to, mover)
        mover.dataset.square = animate.to
        this.place(mover, animate.to, true)
      }
      if (animate.rookFrom && animate.rookTo) {
        const rook = this.pieces.get(animate.rookFrom)
        if (rook) {
          this.pieces.delete(animate.rookFrom)
          this.pieces.set(animate.rookTo, rook)
          rook.dataset.square = animate.rookTo
          this.place(rook, animate.rookTo, true)
        }
      }
    }
    this.reconcile(map)
  }

  reconcile (map) {
    for (const [square, element] of [...this.pieces]) {
      const code = map.get(square)
      if (!code) { element.remove(); this.pieces.delete(square); continue }
      if (element.dataset.code !== code) this.paint(element, code)
    }
    for (const [square, code] of map) {
      if (this.pieces.has(square)) continue
      this.pieces.set(square, this.createPiece(code, square))
    }
  }

  // Fog is drawn as one soft layer with the visible squares blurred out of its
  // mask, rather than a black tile per square: the boundary feathers and the
  // turbulence gives it body, so it reads as weather instead of missing tiles.
  setFog (visible) {
    // SVGElement does not implement the `hidden` IDL property, so assigning to
    // it would only set a JS expando and leave the attribute — and the layer —
    // in place. The attribute has to be toggled explicitly.
    if (!visible) {
      if (this.fogKey !== '') {
        this.fogLayer.setAttribute('hidden', '')
        this.fogHoles.innerHTML = ''
        this.fogKey = ''
      }
      return
    }
    const key = `${this.flipped ? 'f' : 'n'}:${[...visible].sort().join('')}`
    if (key === this.fogKey) return
    this.fogKey = key
    this.fogLayer.removeAttribute('hidden')
    let markup = ''
    for (const square of visible) {
      const [column, row] = this.coords(square)
      // slight overlap so neighbouring clear squares melt into one opening
      markup += `<rect x="${column * 12.5 - 1.1}" y="${row * 12.5 - 1.1}" width="14.7" height="14.7" rx="3" fill="#000"></rect>`
    }
    this.fogHoles.innerHTML = markup
  }

  // { selected, targets:[{to,capture}], lastMove:{from,to}, check, fog:Set, zone:Set, premove }
  setHighlights (state = {}) {
    const targets = new Map((state.targets || []).map((target) => [target.to, target]))
    const fog = state.fog || null
    this.setFog(fog)
    const zone = state.zone || null
    for (const [name, element] of this.squares) {
      element.classList.toggle('selected', state.selected === name)
      element.classList.toggle('last-from', !!state.lastMove && state.lastMove.from === name)
      element.classList.toggle('last-to', !!state.lastMove && state.lastMove.to === name)
      element.classList.toggle('in-check', state.check === name)
      element.classList.toggle('fogged', !!fog && !fog.has(name))
      element.classList.toggle('lit', !!fog && fog.has(name))
      element.classList.toggle('setup-zone', !!zone && zone.has(name))
      const target = targets.get(name)
      element.classList.toggle('target', !!target && !target.capture)
      element.classList.toggle('target-capture', !!target && target.capture)
      element.classList.toggle('hover', this.drag ? this.drag.hover === name : false)
    }
  }

  // --- pointer handling -----------------------------------------------------
  bindPointer () {
    const root = this.root
    root.addEventListener('contextmenu', (event) => event.preventDefault())

    root.addEventListener('pointerdown', (event) => {
      const square = this.squareAt(event.clientX, event.clientY)
      if (!square) return
      if (event.button === 2) { this.rightStart = square; return }
      if (event.button !== 0) return
      // Keep focus off the squares on a pointer press. Otherwise a click would
      // park focus on the board and the arrow keys would stop stepping through
      // the move list, which is what most people expect them to do.
      event.preventDefault()
      this.clearMarks()
      if (!this.interactive) { this.handlers.onSelect?.(square); return }
      const piece = this.pieces.get(square)
      const grabbable = piece && this.handlers.canGrab?.(square)
      this.handlers.onSelect?.(square)
      if (!grabbable) return
      root.setPointerCapture(event.pointerId)
      this.drag = { square, element: piece, pointerId: event.pointerId, moved: false, hover: square }
      piece.classList.add('dragging')
      this.moveDragged(event.clientX, event.clientY)
    })

    root.addEventListener('pointermove', (event) => {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return
      this.drag.moved = true
      this.moveDragged(event.clientX, event.clientY)
      const hover = this.squareAt(event.clientX, event.clientY)
      if (hover !== this.drag.hover) {
        this.drag.hover = hover
        for (const [name, element] of this.squares) element.classList.toggle('hover', name === hover)
      }
    })

    const finish = (event) => {
      if (event.button === 2 && this.rightStart) {
        const end = this.squareAt(event.clientX, event.clientY)
        if (end) this.toggleMark(this.rightStart, end)
        this.rightStart = null
        return
      }
      if (!this.drag || event.pointerId !== this.drag.pointerId) return
      const { element, square, moved } = this.drag
      const target = this.squareAt(event.clientX, event.clientY)
      element.classList.remove('dragging')
      element.style.zIndex = ''
      this.drag = null
      for (const [, node] of this.squares) node.classList.remove('hover')
      this.place(element, element.dataset.square || square, false)
      if (moved && target && target !== square) this.handlers.onDrop?.(square, target)
    }
    root.addEventListener('pointerup', finish)
    root.addEventListener('pointercancel', finish)
  }

  // Roving tabindex: one square is tabbable, arrows walk the cursor, Enter or
  // Space acts on it. Arrows are only intercepted while the board has focus, so
  // the global history shortcuts keep working everywhere else.
  bindKeyboard () {
    this.setCursor(this.cursor, false)
    this.root.addEventListener('keydown', (event) => {
      const deltas = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
      if (deltas[event.key]) {
        event.preventDefault()
        event.stopPropagation()
        const [dx, dy] = deltas[event.key]
        const file = FILES.indexOf(this.cursor[0])
        const rank = Number(this.cursor[1]) - 1
        const flip = this.flipped ? -1 : 1
        const nextFile = Math.max(0, Math.min(7, file + dx * flip))
        const nextRank = Math.max(0, Math.min(7, rank + dy * flip))
        this.setCursor(`${FILES[nextFile]}${nextRank + 1}`)
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        this.clearMarks()
        this.handlers.onSelect?.(this.cursor)
        return
      }
      if (event.key === 'Escape') {
        event.stopPropagation()
        this.handlers.onEscape?.()
      }
    })
    this.root.addEventListener('focusin', (event) => {
      const square = event.target.closest?.('.square')
      if (square && square.dataset.square) this.cursor = square.dataset.square
    })
  }

  setCursor (name, focus = true) {
    this.cursor = name
    for (const [square, element] of this.squares) element.tabIndex = square === name ? 0 : -1
    if (focus) this.squares.get(name)?.focus({ preventScroll: true })
  }

  // Announce what stands on each square so the board is usable without sight.
  describe (map, extra = {}) {
    const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }
    for (const [square, element] of this.squares) {
      const code = map.get(square)
      let label = square
      if (extra.fog && !extra.fog.has(square)) label += ', hidden by fog'
      else if (code) label += `, ${code[0] === 'w' ? 'white' : 'black'} ${names[code[1]] || ''}`.trimEnd()
      else label += ', empty'
      if (extra.selected === square) label += ', selected'
      element.setAttribute('aria-label', label)
    }
  }

  moveDragged (clientX, clientY) {
    const rect = this.root.getBoundingClientRect()
    const half = this.size / 2
    const x = Math.max(-half, Math.min(rect.width - half, clientX - rect.left - half))
    const y = Math.max(-half, Math.min(rect.height - half, clientY - rect.top - half))
    this.drag.element.style.zIndex = '40'
    this.drag.element.classList.add('no-anim')
    this.drag.element.style.transform = `translate(${x}px, ${y}px) scale(1.08)`
  }

  // --- arrows and circles ---------------------------------------------------
  toggleMark (from, to) {
    if (from === to) {
      if (this.circles.has(from)) this.circles.delete(from)
      else this.circles.set(from, ARROW_COLORS[0])
    } else {
      const index = this.arrows.findIndex((arrow) => arrow.from === from && arrow.to === to)
      if (index >= 0) this.arrows.splice(index, 1)
      else this.arrows.push({ from, to, color: 0 })
    }
    this.drawMarks()
  }

  clearMarks () {
    if (!this.arrows.length && !this.circles.size) return
    this.arrows = []
    this.circles.clear()
    this.drawMarks()
  }

  // A suggested move, drawn in its own colour so it reads apart from the
  // arrows the player draws by hand.
  setHint (from, to) {
    this.hint = from && to ? { from, to } : null
    this.drawMarks()
  }

  center (square) {
    const [column, row] = this.coords(square)
    return [column * 12.5 + 6.25, row * 12.5 + 6.25]
  }

  drawMarks () {
    this.circleGroup.innerHTML = [...this.circles.entries()].map(([square, color]) => {
      const [x, y] = this.center(square)
      return `<circle cx="${x}" cy="${y}" r="5.6" fill="none" stroke="${color}" stroke-width="0.9" opacity="0.85"></circle>`
    }).join('')
    const arrows = this.hint ? [...this.arrows, { ...this.hint, color: 2, hint: true }] : this.arrows
    this.arrowGroup.innerHTML = arrows.map((arrow) => {
      const [x1, y1] = this.center(arrow.from)
      const [x2, y2] = this.center(arrow.to)
      const dx = x2 - x1
      const dy = y2 - y1
      const length = Math.hypot(dx, dy) || 1
      const trim = 4.4
      const ex = x2 - (dx / length) * trim
      const ey = y2 - (dy / length) * trim
      return `<line class="${arrow.hint ? 'hint-arrow' : ''}" x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="${ARROW_COLORS[arrow.color]}" stroke-width="${arrow.hint ? 2.6 : 2.1}" stroke-linecap="round" opacity="${arrow.hint ? 0.95 : 0.82}" marker-end="url(#fc-arrow-${arrow.color})"></line>`
    }).join('')
  }
}
