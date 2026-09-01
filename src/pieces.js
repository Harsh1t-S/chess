const CLASSIC_BASE='https://images.chesscomfiles.com/chess-themes/pieces/classic/300'

export function pieceSvg(code,extra=''){
  if(!code||code.length<2)return ''
  const color=code[0],type=code[1]
  const src=`${CLASSIC_BASE}/${color}${type}.png`
  return `<img class="chess-piece ${color==='w'?'piece-white':'piece-black'} ${extra}" data-piece="${code}" src="${src}" alt="" draggable="false" aria-hidden="true" style="width:100%;height:100%;object-fit:contain;display:block;user-select:none;-webkit-user-drag:none"/>`
}
