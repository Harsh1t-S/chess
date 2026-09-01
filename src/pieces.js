const shapes={
  p:`<circle cx="50" cy="25" r="13.5"/><path d="M39 41h22c0 7-3 12-8 16 9 7 14 16 14 27H33c0-11 5-20 14-27-5-4-8-9-8-16Z"/><path d="M28 78h44l5 9H23z"/>`,
  r:`<path d="M24 18h12v10h9V18h10v10h9V18h12v22H24z"/><path d="M31 39h38l-5 38H36z"/><path d="M27 74h46l6 13H21z"/>`,
  b:`<path d="M50 14c12 8 18 18 18 29 0 9-4 16-11 22l8 10H35l8-10c-7-6-11-13-11-22 0-11 6-21 18-29Z"/><path d="M57 27 43 50" fill="none" stroke-width="5.5"/><path d="M28 74h44l7 13H21z"/>`,
  n:`<path d="M28 83c3-13 9-23 18-31l-10-7c5-3 10-7 14-13l-3-13c10 2 20 7 27 15 8 8 12 18 12 30 0 8-2 14-7 19H28Z"/><path d="M52 34c8-4 15-4 21-1" fill="none" stroke-width="5"/><circle cx="66" cy="37" r="3.4"/><path d="M26 79h54l6 8H20z"/>`,
  q:`<circle cx="22" cy="24" r="5.5"/><circle cx="38" cy="18" r="5.5"/><circle cx="50" cy="14" r="5.5"/><circle cx="62" cy="18" r="5.5"/><circle cx="78" cy="24" r="5.5"/><path d="M23 31 34 61l8-28 8 26 8-26 8 28 11-30-5 42H28z"/><path d="M26 72h48l6 15H20z"/>`,
  k:`<path d="M46 9h8v12h11v8H54v11h-8V29H35v-8h11z"/><path d="M50 38c13 0 22 8 22 19 0 8-4 14-10 19H38c-6-5-10-11-10-19 0-11 9-19 22-19Z"/><path d="M26 72h48l6 15H20z"/>`
}

export function pieceSvg(code,extra=''){
  if(!code||code.length<2)return ''
  const color=code[0],type=code[1]
  const white=color==='w'
  const fill=white?'#f7f7f4':'#2f2f2d'
  const stroke=white?'#4b4b48':'#11110f'
  const hi=white?'#ffffff':'#4a4a47'
  const lo=white?'#d9d9d4':'#232321'
  const gid=`g-${code}`
  return `<svg class="chess-piece ${white?'piece-white':'piece-black'} ${extra}" data-piece="${code}" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${hi}"/>
        <stop offset="0.55" stop-color="${fill}"/>
        <stop offset="1" stop-color="${lo}"/>
      </linearGradient>
    </defs>
    <g fill="url(#${gid})" stroke="${stroke}" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round">${shapes[type]||''}</g>
  </svg>`
}
