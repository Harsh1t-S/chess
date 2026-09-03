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

    root.classList.add('board-view')
    root.innerHTML = `
      <div class="board-squares"></div>
      <div class="board-pieces"></div>
      <svg class="board-marks" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs></defs>
        <g class="board-circles"></g>
        <g class="board-arrows"></g>
      </svg>
      <div class="board-drag-layer"></div>`

    this.squareLayer = root.querySelector('.board-squares')
    this.pieceLayer = root.querySelector('.board-pieces')
    this.marks = root.querySelector('.board-marks')
    this.circleGroup = root.querySelector('.board-circles')
    this.arrowGroup = root.querySelector('.board-arrows')
    this.marks.querySelector('defs').innerHTML = ARROW_COLORS.map((color, i) => `
      <marker id="fc-arrow-${i}" markerWidth="3.2" markerHeight="3.2" refX="1.6" refY="1.6" orient="auto">
        <path d="M0,0 L3.2,1.6 L0,3.2 z" fill="${color}"></path>
      </marker>`).join('')

    this.buildSquares()
    this.bindPointer()

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

  // { selected, targets:[{to,capture}], lastMove:{from,to}, check, fog:Set, zone:Set, premove }
  setHighlights (state = {}) {
    const targets = new Map((state.targets || []).map((target) => [target.to, target]))
    const fog = state.fog || null
    const zone = state.zone || null
    for (const [name, element] of this.squares) {
      element.classList.toggle('selected', state.selected === name)
      element.classList.toggle('last-from', !!state.lastMove && state.lastMove.from === name)
      element.classList.toggle('last-to', !!state.lastMove && state.lastMove.to === name)
      element.classList.toggle('in-check', state.check === name)
      element.classList.toggle('fogged', !!fog && !fog.has(name))
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

  center (square) {
    const [column, row] = this.coords(square)
    return [column * 12.5 + 6.25, row * 12.5 + 6.25]
  }

  drawMarks () {
    this.circleGroup.innerHTML = [...this.circles.entries()].map(([square, color]) => {
      const [x, y] = this.center(square)
      return `<circle cx="${x}" cy="${y}" r="5.6" fill="none" stroke="${color}" stroke-width="0.9" opacity="0.85"></circle>`
    }).join('')
    this.arrowGroup.innerHTML = this.arrows.map((arrow) => {
      const [x1, y1] = this.center(arrow.from)
      const [x2, y2] = this.center(arrow.to)
      const dx = x2 - x1
      const dy = y2 - y1
      const length = Math.hypot(dx, dy) || 1
      const trim = 4.4
      const ex = x2 - (dx / length) * trim
      const ey = y2 - (dy / length) * trim
      return `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="${ARROW_COLORS[arrow.color]}" stroke-width="2.1" stroke-linecap="round" opacity="0.82" marker-end="url(#fc-arrow-${arrow.color})"></line>`
    }).join('')
  }
}
