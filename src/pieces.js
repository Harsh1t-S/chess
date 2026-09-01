const shapes={
  p:`<circle cx="50" cy="26" r="13"/><path d="M38 42h24l-5 14c8 5 12 13 12 23H31c0-10 4-18 12-23l-5-14Z"/><path d="M25 79h50v9H25z"/>`,
  r:`<path d="M27 18h10v10h9V18h8v10h9V18h10v21H27z"/><path d="M34 39h32l-4 37H38z"/><path d="M27 76h46v12H27z"/>`,
  b:`<path d="M50 15c10 8 16 18 16 28 0 10-6 17-13 21l8 12H39l8-12c-8-4-13-11-13-21 0-10 6-20 16-28Z"/><path d="m55 27-12 20" stroke-width="5" fill="none"/><path d="M27 76h46v12H27z"/>`,
  n:`<path d="M27 78c5-18 15-31 29-39l-8-4 8-19c16 8 25 20 25 37 0 10-4 18-11 25H27Z"/><path d="M55 28c-9 10-17 15-25 17l10 9 16-3" fill="none" stroke-width="5" stroke-linecap="round"/><circle cx="62" cy="34" r="3.5"/> <path d="M24 78h54v10H24z"/>`,
  q:`<circle cx="25" cy="25" r="6"/><circle cx="50" cy="18" r="6"/><circle cx="75" cy="25" r="6"/><path d="m25 31 10 30 15-37 15 37 10-30-4 43H29l-4-43Z"/><path d="M25 74h50v14H25z"/>`,
  k:`<path d="M46 10h8v12h10v8H54v11h-8V30H36v-8h10z"/><path d="M50 38c13 0 22 9 22 21 0 7-3 13-9 18H37c-6-5-9-11-9-18 0-12 9-21 22-21Z"/><path d="M24 76h52v12H24z"/>`
}

export function pieceSvg(code,extra=''){
  if(!code||code.length<2)return ''
  const color=code[0],type=code[1]
  const fill=color==='w'?'#f4f4f4':'#303030'
  const stroke=color==='w'?'#565656':'#111111'
  const inner=color==='w'?'#d7d7d7':'#4a4a4a'
  return `<svg class="chess-piece ${color==='w'?'piece-white':'piece-black'} ${extra}" data-piece="${code}" viewBox="0 0 100 100" aria-hidden="true" focusable="false" style="--piece-fill:${fill};--piece-stroke:${stroke};--piece-inner:${inner}"><g fill="var(--piece-fill)" stroke="var(--piece-stroke)" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round">${shapes[type]||''}</g></svg>`
}
