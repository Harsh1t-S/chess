// Board and piece skins. Artwork is loaded from chess.com's theme CDN at
// runtime (and cached by the service worker), with square colours and Unicode
// glyphs as the offline fallback so the PWA still looks right with no network.
const PIECE_CDN = 'https://www.chess.com/chess-themes/pieces'
const BOARD_CDN = 'https://images.chesscomfiles.com/chess-themes/boards'

export const BOARD_THEMES = [
  { id: 'green', name: 'Green', light: '#eeeed2', dark: '#769656' },
  { id: 'brown', name: 'Brown', light: '#f0d9b5', dark: '#b58863' },
  { id: 'walnut', name: 'Walnut', light: '#c3a17f', dark: '#7a5230' },
  { id: 'dark_wood', name: 'Dark Wood', light: '#c2a582', dark: '#6b4a2f' },
  { id: 'burled_wood', name: 'Burled Wood', light: '#d3b48c', dark: '#8a5f37' },
  { id: 'blue', name: 'Blue', light: '#dee3e6', dark: '#8ca2ad' },
  { id: 'icy_sea', name: 'Icy Sea', light: '#c5d5dc', dark: '#7a9db0' },
  { id: 'purple', name: 'Purple', light: '#e6e0f0', dark: '#8877b5' },
  { id: 'marble', name: 'Marble', light: '#dcd7cd', dark: '#9b978d' },
  { id: 'marbleblue', name: 'Blue Marble', light: '#d5dde6', dark: '#7f95ac' },
  { id: 'stone', name: 'Stone', light: '#d7d2c8', dark: '#8a8378' },
  { id: 'glass', name: 'Glass', light: '#d8e2e6', dark: '#7d97a3' },
  { id: 'metal', name: 'Metal', light: '#d5d5d5', dark: '#8e8e8e' },
  { id: 'tournament', name: 'Tournament', light: '#e4e4dc', dark: '#5f8a4e' },
  { id: 'newspaper', name: 'Newspaper', light: '#e8e8e8', dark: '#a8a8a8' },
  { id: 'neon', name: 'Neon', light: '#d9e8ea', dark: '#4f9aa8' },
  { id: 'sand', name: 'Sand', light: '#e8dcc0', dark: '#bda57a' },
  { id: '8_bit', name: '8-Bit', light: '#f0f0c8', dark: '#4b9c48' }
]

export const PIECE_THEMES = [
  { id: 'neo', name: 'Neo' },
  { id: 'classic', name: 'Classic' },
  { id: 'wood', name: 'Wood' },
  { id: 'neo_wood', name: 'Neo Wood' },
  { id: 'glass', name: 'Glass' },
  { id: 'game_room', name: 'Game Room' },
  { id: 'light', name: 'Light' },
  { id: 'modern', name: 'Modern' },
  { id: 'icy_sea', name: 'Icy Sea' },
  { id: 'nature', name: 'Nature' },
  { id: 'metal', name: 'Metal' },
  { id: 'marble', name: 'Marble' },
  { id: 'tigers', name: 'Tigers' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'book', name: 'Book' },
  { id: 'bases', name: 'Bases' },
  { id: 'alpha', name: 'Alpha' },
  { id: '3d_wood', name: '3D Wood' },
  { id: '3d_staunton', name: '3D Staunton' }
]

export const DEFAULT_BOARD_THEME = 'green'
export const DEFAULT_PIECE_THEME = 'neo'

export const boardTheme = (id) => BOARD_THEMES.find((theme) => theme.id === id) || BOARD_THEMES[0]
export const pieceTheme = (id) => PIECE_THEMES.find((theme) => theme.id === id) || PIECE_THEMES[0]

export const pieceUrl = (code, themeId, size = 150) => `${PIECE_CDN}/${pieceTheme(themeId).id}/${size}/${code}.png`
export const boardUrl = (themeId) => `${BOARD_CDN}/${boardTheme(themeId).id}/150.png`

export const PIECE_GLYPHS = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟'
}

// Paint the CSS variables the board and highlights read from.
export function applyBoardTheme (root, themeId) {
  const theme = boardTheme(themeId)
  root.style.setProperty('--square-light', theme.light)
  root.style.setProperty('--square-dark', theme.dark)
  root.style.setProperty('--board-image', `url("${boardUrl(theme.id)}")`)
}

export function preloadPieces (themeId) {
  for (const code of Object.keys(PIECE_GLYPHS)) {
    const image = new Image()
    image.src = pieceUrl(code, themeId)
  }
}
