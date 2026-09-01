// Kaneo chess pieces by Kadagaden, inspired by Chess.com's Neo set.
// Licensed CC BY 4.0: https://github.com/Kadagaden/chess-pieces
const BASE='https://raw.githubusercontent.com/Kadagaden/chess-pieces/master/chess_kaneo/'
const names={p:'P',r:'R',n:'N',b:'B',q:'Q',k:'K'}

export function pieceSvg(code,extra=''){
  if(!code||code.length<2)return ''
  const color=code[0],type=code[1]
  const file=`${color}${names[type]}.svg`
  return `<img class="chess-piece ${color==='w'?'piece-white':'piece-black'} ${extra}" data-piece="${code}" src="${BASE}${file}" alt="" draggable="false" aria-hidden="true" />`
}
