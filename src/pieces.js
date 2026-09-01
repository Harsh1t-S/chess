const shapes={
  p:`<circle cx="50" cy="24" r="11.5"/><path d="M39 39c1 7 4 12 8 16-8 5-13 13-14 23h34c-1-10-6-18-14-23 4-4 7-9 8-16H39Z"/><path d="M29 77h42l5 10H24l5-10Z"/>`,
  r:`<path d="M28 18h10v9h8v-9h8v9h8v-9h10v21H28V18Z"/><path d="M34 39h32l-3 8H37l-3-8Z"/><path d="M38 47h24l4 29H34l4-29Z"/><path d="M28 76h44l5 11H23l5-11Z"/>`,
  b:`<circle cx="50" cy="20" r="5"/><path d="M50 25c-11 8-17 17-17 27 0 10 6 18 14 22h6c8-4 14-12 14-22 0-10-6-19-17-27Z"/><path d="M56 31 43 53" fill="none" stroke-width="4.2"/><path d="M35 71h30l5 7H30l5-7Z"/><path d="M27 78h46l5 9H22l5-9Z"/>`,
  n:`<path d="M31 78c2-13 7-23 16-31l-11 1 7-11 8-8-1-11c17 6 28 20 29 37 1 10-3 17-9 23H31Z"/><path d="M50 29c9 2 15 7 19 15-5-3-10-4-15-3-8 1-15 5-22 11" fill="none" stroke-width="4.2"/><circle cx="61" cy="34" r="3.2"/><path d="M27 78h46l5 9H22l5-9Z"/>`,
  q:`<circle cx="22" cy="24" r="5"/><circle cx="36" cy="18" r="5"/><circle cx="50" cy="14" r="5"/><circle cx="64" cy="18" r="5"/><circle cx="78" cy="24" r="5"/><path d="M22 30l9 32 13-34 6 35 6-35 13 34 9-32-6 44H28l-6-44Z"/><path d="M30 69h40l4 8H26l4-8Z"/><path d="M25 77h50l5 10H20l5-10Z"/>`,
  k:`<path d="M46 10h8v10h10v8H54v10h-8V28H36v-8h10V10Z"/><path d="M50 38c13 0 22 8 22 19 0 7-3 13-8 17H36c-5-4-8-10-8-17 0-11 9-19 22-19Z"/><path d="M33 58h34" fill="none" stroke-width="4"/><path d="M31 72h38l5 6H26l5-6Z"/><path d="M24 78h52l5 9H19l5-9Z"/>`
}

export function pieceSvg(code,extra=''){
  if(!code||code.length<2)return ''
  const color=code[0],type=code[1]
  const fill=color==='w'?'#f7f7f7':'#2c2c2c'
  const stroke=color==='w'?'#444':'#111'
  const accent=color==='w'?'#d9d9d9':'#4a4a4a'
  return `<svg class="chess-piece ${color==='w'?'piece-white':'piece-black'} ${extra}" data-piece="${code}" viewBox="0 0 100 100" aria-hidden="true" focusable="false" style="--piece-fill:${fill};--piece-stroke:${stroke};--piece-accent:${accent}"><g fill="var(--piece-fill)" stroke="var(--piece-stroke)" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round">${shapes[type]||''}</g></svg>`
}
