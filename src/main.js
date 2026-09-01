import { Chess } from 'chess.js'
import { pieceSvg } from './pieces.js'
import { FogGame, chooseFogMove } from './fog.js'
import './style.css'

const FILES=['a','b','c','d','e','f','g','h']
const COST={q:9,r:5,b:3,n:3,p:1,k:0}
const NAMES={q:'Queen',r:'Rook',b:'Bishop',n:'Knight',p:'Pawn',k:'King'}
const ENGINES={
  quick:{name:'Spark',rating:700,depth:2,time:180,label:'Beginner',fog:1},
  club:{name:'Anvil',rating:1100,depth:3,time:650,label:'Casual',fog:2},
  strong:{name:'Titan',rating:1500,depth:4,time:1800,label:'Advanced',fog:3},
  forge:{name:'Forge',rating:1800,depth:5,time:4200,label:'Expert',fog:4}
}

class SetupGame{
  constructor(){this.board=new Map();this.remaining={w:39,b:39};this.king={w:false,b:false};this.turn='w';this.firstMover=null;this.history=[]}
  finished(c){return this.remaining[c]===0&&this.king[c]}
  complete(){return this.finished('w')&&this.finished('b')}
  canPlace(c,p,sq){
    if(this.complete()||c!==this.turn||this.board.has(sq)||!(p in COST)||COST[p]>this.remaining[c])return false
    if(p==='k'&&this.king[c])return false
    const rank=Number(sq[1])
    if(c==='w')return p==='p'?(rank===2||rank===3):(rank>=1&&rank<=3)
    return p==='p'?(rank===6||rank===7):(rank>=6&&rank<=8)
  }
  legalSquares(c,p){return FILES.flatMap(f=>[1,2,3,4,5,6,7,8].map(r=>`${f}${r}`)).filter(s=>this.canPlace(c,p,s))}
  place(c,p,sq){
    if(!this.canPlace(c,p,sq))throw new Error('That placement is not allowed.')
    this.board.set(sq,c+p);this.remaining[c]-=COST[p];if(p==='k')this.king[c]=true
    this.history.push({color:c,piece:p,square:sq})
    if(this.finished(c)&&!this.firstMover)this.firstMover=c
    if(!this.complete()){const other=c==='w'?'b':'w';this.turn=this.finished(other)?c:other}
  }
  undo(){
    const h=this.history.pop();if(!h)return
    this.board.delete(h.square);this.remaining[h.color]+=COST[h.piece];if(h.piece==='k')this.king[h.color]=false
    this.turn=h.color;this.firstMover=null
    for(const c of ['w','b'])if(this.finished(c)){this.firstMover=c;break}
  }
  serialize(){return this.history.map(x=>({...x}))}
  fen(){
    if(!this.complete())throw new Error('Finish both armies first.')
    const rows=[]
    for(let r=8;r>=1;r--){let row='',empty=0;for(const f of FILES){const x=this.board.get(`${f}${r}`);if(!x){empty++;continue}if(empty){row+=empty;empty=0}row+=x[0]==='w'?x[1].toUpperCase():x[1]}if(empty)row+=empty;rows.push(row)}
    return `${rows.join('/')} ${this.firstMover||'w'} - - 0 1`
  }
  static fromHistory(items=[]){const g=new SetupGame();for(const m of items)g.place(m.color,m.piece,m.square);return g}
}

const app=document.querySelector('#app')
app.innerHTML=`
<div class="app-shell">
  <aside class="nav-rail">
    <button class="logo-button" aria-label="ForgeChess">♞</button>
    <div class="nav-stack">
      <button class="nav-item active"><span>♟</span><small>Play</small></button>
      <button class="nav-item" id="rail-new"><span>＋</span><small>New</small></button>
      <button class="nav-item" id="rail-rules"><span>?</span><small>Rules</small></button>
    </div>
    <div class="nav-foot">FC</div>
  </aside>

  <header class="mobile-header">
    <div class="mobile-brand"><span>♞</span><strong>ForgeChess</strong></div>
    <button id="mobile-menu">☰</button>
  </header>

  <main class="workspace">
    <section class="board-column">
      <div id="top-player" class="player-bar"></div>
      <div class="board-line">
        <div class="eval-bar" id="eval-bar"><div id="eval-fill"></div><span id="eval-label">SET</span></div>
        <div id="board" class="chess-board" role="grid" aria-label="ForgeChess board"></div>
        <button id="fog-handoff" class="fog-handoff" hidden><span>FOG OF WAR</span><strong id="handoff-title">Pass to White</strong><small>Tap to reveal your view</small></button>
      </div>
      <div id="bottom-player" class="player-bar"></div>
      <div class="quick-actions">
        <button id="undo">↶ <span>Undo</span></button>
        <button id="flip">⇅ <span>Flip</span></button>
        <button id="copy">⧉ <span>Copy</span></button>
        <button id="new">＋ <span>New</span></button>
      </div>
    </section>

    <aside class="game-panel" id="game-panel">
      <div class="panel-top">
        <div class="variant-tabs">
          <button data-variant="setup" class="active">Setup Chess</button>
          <button data-variant="fog">Fog Chess</button>
        </div>
        <div class="mode-tabs">
          <button data-mode="ai" class="active">Play Engine</button>
          <button data-mode="local">Two Player</button>
        </div>
      </div>

      <section class="panel-section phase-card">
        <div class="phase-copy"><span id="phase-label">SETUP PHASE</span><h1 id="phase-title">Build your army</h1><p id="status">White places first</p></div>
        <span id="turn-dot" class="turn-dot white"></span>
      </section>

      <section id="engine-settings" class="panel-section">
        <div class="section-title"><span>Opponent</span><small>Estimated strength</small></div>
        <div id="engine-picker" class="engine-picker"></div>
        <div class="side-picker">
          <span>Play as</span>
          <div><button data-side="w" class="active">White</button><button data-side="b">Black</button><button data-side="random">Random</button></div>
        </div>
      </section>

      <section id="setup-section" class="panel-section setup-section">
        <div class="budget-line"><div><span id="placer-dot" class="mini-dot white"></span><b id="placer">White to place</b></div><strong><span id="budget">39</span><small> pts left</small></strong></div>
        <p class="setup-help" id="setup-help">Choose a piece, then tap a highlighted square.</p>
        <div id="piece-bank" class="piece-bank"></div>
        <div class="setup-note"><span>Pieces: first 3 ranks</span><span>Pawns: ranks 2–3</span><span>King: free + required</span></div>
      </section>

      <section class="panel-section game-info">
        <div class="info-strip">
          <div><small id="stat1-label">White</small><strong id="stat1">39</strong></div>
          <div><small id="stat2-label">Black</small><strong id="stat2">39</strong></div>
          <div><small id="stat3-label">First move</small><strong id="stat3">—</strong></div>
        </div>
        <div class="history-head"><strong id="history-title">Placements</strong><small id="history-count">0</small></div>
        <div id="history" class="history"><div class="history-empty">Your setup will appear here.</div></div>
        <div class="position-row"><span id="position-label">ARMY</span><code id="position">Empty board</code><button id="position-copy">Copy</button></div>
      </section>
    </aside>
  </main>
</div>
<div id="toast" class="toast"></div>
<dialog id="rules-dialog" class="rules-dialog">
  <button class="dialog-close" id="close-rules">×</button>
  <h2>ForgeChess variants</h2>
  <h3>Setup Chess</h3>
  <p>Spend 39 material points and place one free king. Regular pieces stay in your first three ranks; pawns stay on ranks two and three. The first army to finish gets the first move.</p>
  <div class="rule-grid"><span>Queen <b>9</b></span><span>Rook <b>5</b></span><span>Bishop <b>3</b></span><span>Knight <b>3</b></span><span>Pawn <b>1</b></span><span>King <b>Free</b></span></div>
  <h3>Fog Chess</h3>
  <p>You see your pieces and the squares they can move to. Enemy pieces outside your vision are hidden. There is no check or checkmate: capture the enemy king to win. Kings may move or castle through attacked squares.</p>
</dialog>`

let variant='setup',mode='ai',requestedSide='w',human='w',difficulty='club',flipped=false,selectedPiece=null,selectedSquare=null
let setup=new SetupGame(),chess=null,fog=new FogGame(),fogHandoff=false,engineBusy=false,engineEval=0,engineDepth=0,engineNodes=0,aiTimer=null,fogTimer=null
const worker=new Worker(new URL('./engine.worker.js',import.meta.url),{type:'module'})
const $=s=>document.querySelector(s)
const colorName=c=>c==='w'?'White':'Black'
const currentEngine=()=>ENGINES[difficulty]
const fogViewer=()=>mode==='ai'?human:fog.turn

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1900)}
function boardPiece(sq){
  if(variant==='fog'){
    const visible=fog.visibility(fogViewer());if(!visible.has(sq))return null
    return fog.get(sq)
  }
  if(chess){const p=chess.get(sq);return p?`${p.color}${p.type}`:null}return setup.board.get(sq)||null
}
function humanSetupTurn(){return variant==='setup'&&(mode==='local'||setup.turn===human)}
function humanMoveTurn(){if(variant==='fog')return mode==='local'||fog.turn===human;return mode==='local'||(chess&&chess.turn()===human)}
function save(){
  try{localStorage.setItem('forgechess-v6',JSON.stringify({variant,mode,requestedSide,human,difficulty,flipped,placements:setup.serialize(),phase:chess?'play':'setup',moves:chess?chess.history({verbose:true}).map(m=>({from:m.from,to:m.to,promotion:m.promotion})):[],fogMoves:fog.serialize()}))}catch{}
}
function load(){
  try{
    const s=JSON.parse(localStorage.getItem('forgechess-v6')||localStorage.getItem('forgechess-v5')||'null');if(!s)return
    variant=s.variant==='fog'?'fog':'setup';mode=s.mode==='local'?'local':'ai';requestedSide=['w','b','random'].includes(s.requestedSide)?s.requestedSide:'w';human=s.human==='b'?'b':'w';difficulty=ENGINES[s.difficulty]?s.difficulty:'club';flipped=!!s.flipped
    if(variant==='fog'){fog=new FogGame();fog.loadMoves(s.fogMoves||[]);fogHandoff=mode==='local'&&!fog.winner}
    else{setup=SetupGame.fromHistory(s.placements||[]);if(s.phase==='play'&&setup.complete()){chess=new Chess(setup.fen(),{skipValidation:true});for(const m of s.moves||[])try{chess.move(m)}catch{}}}
  }catch{}
}

function renderEnginePicker(){
  $('#engine-picker').innerHTML=Object.entries(ENGINES).map(([id,e])=>`<button class="engine-card ${id===difficulty?'active':''}" data-engine="${id}"><span class="bot-avatar">${pieceSvg('bn')}</span><span><b>${e.name}</b><small>${variant==='fog'?'Fog '+e.label:e.label}</small></span><strong>≈${e.rating}</strong></button>`).join('')
  document.querySelectorAll('[data-engine]').forEach(btn=>btn.onclick=()=>{difficulty=btn.dataset.engine;render();toast(`${currentEngine().name} selected · ≈${currentEngine().rating} Elo`)})
}

function renderPieceBank(){
  const color=setup.turn
  $('#piece-bank').innerHTML=['q','r','b','n','p','k'].map(type=>{
    const available=humanSetupTurn()&&setup.legalSquares(color,type).length>0
    return `<button class="bank-piece ${selectedPiece===type?'active':''}" data-bank-piece="${type}" ${available?'':'disabled'}><span>${pieceSvg(color+type)}</span><small>${NAMES[type]}</small><b>${type==='k'?'FREE':COST[type]}</b></button>`
  }).join('')
  document.querySelectorAll('[data-bank-piece]').forEach(btn=>btn.onclick=()=>{selectedPiece=selectedPiece===btn.dataset.bankPiece?null:btn.dataset.bankPiece;renderBoard();renderPieceBank()})
}

function renderBoard(){
  const board=$('#board');board.innerHTML=''
  const ranks=flipped?[1,2,3,4,5,6,7,8]:[8,7,6,5,4,3,2,1]
  const files=flipped?[...FILES].reverse():FILES
  const isFog=variant==='fog',visible=isFog?fog.visibility(fogViewer()):null
  const setupLegal=new Set(!isFog&&!chess&&selectedPiece&&humanSetupTurn()?setup.legalSquares(setup.turn,selectedPiece):[])
  const moveTargets=isFog?(selectedSquare?fog.movesFrom(selectedSquare):[]):chess&&selectedSquare?chess.moves({square:selectedSquare,verbose:true}):[]
  const last=isFog?fog.history.at(-1)?.move:chess?chess.history({verbose:true}).at(-1):null
  ranks.forEach((rank,ri)=>files.forEach((file,fi)=>{
    const sq=`${file}${rank}`,el=document.createElement('button')
    el.className=`square ${(FILES.indexOf(file)+rank)%2===0?'light':'dark'}`;el.dataset.square=sq;el.setAttribute('aria-label',sq)
    if(isFog){
      if(!visible.has(sq))el.classList.add('fogged')
      if(selectedSquare===sq)el.classList.add('selected')
      if(moveTargets.some(m=>m.to===sq)){el.classList.add('legal');if(fog.get(sq)&&visible.has(sq))el.classList.add('capture')}
      if(last&&(last.from===sq||last.to===sq)&&visible.has(sq))el.classList.add('last-move')
    }else if(!chess){
      if((setup.turn==='w'&&rank<=3)||(setup.turn==='b'&&rank>=6))el.classList.add('setup-zone')
      if(setupLegal.has(sq))el.classList.add('legal')
    }else{
      if(selectedSquare===sq)el.classList.add('selected')
      if(moveTargets.some(m=>m.to===sq)){el.classList.add('legal');if(chess.get(sq))el.classList.add('capture')}
      if(last&&(last.from===sq||last.to===sq))el.classList.add('last-move')
      if(chess.inCheck()){const p=chess.get(sq);if(p?.type==='k'&&p.color===chess.turn())el.classList.add('in-check')}
    }
    const code=boardPiece(sq);if(code){const holder=document.createElement('span');holder.className='piece-holder';holder.innerHTML=pieceSvg(code);el.append(holder)}
    if(fi===0){const c=document.createElement('span');c.className='coord rank';c.textContent=rank;el.append(c)}
    if(ri===7){const c=document.createElement('span');c.className='coord file';c.textContent=file;el.append(c)}
    el.onclick=()=>onSquare(sq);board.append(el)
  }))
  const handoff=$('#fog-handoff');handoff.hidden=!(isFog&&mode==='local'&&fogHandoff&&!fog.winner);$('#handoff-title').textContent=`Pass to ${colorName(fog.turn)}`
}

function playerMarkup(color){
  const engine=mode==='ai'&&color!==human,e=currentEngine()
  const active=variant==='fog'?fog.turn===color:chess?chess.turn()===color:setup.turn===color
  const name=mode==='local'?colorName(color):(engine?e.name:'You')
  let sub
  if(variant==='fog')sub=fog.winner?(fog.winner===color?'King hunter · Winner':'King captured'):(engine?`Fog AI · ≈${e.rating}`:(active?'Your move':'Hidden information'))
  else sub=chess?(engine?`Computer · ≈${e.rating}`:(active?'Your move':'Player')):`${setup.remaining[color]} points left${setup.king[color]?'':' · king needed'}`
  return `<div class="player-left"><span class="player-avatar ${color}">${engine?pieceSvg(color+'n'):pieceSvg(color+'p')}</span><div><div class="player-name"><strong>${name}</strong>${engine?`<span class="rating-chip">${e.rating}</span>`:''}</div><small>${sub}</small></div></div><div class="turn-state ${active?'active':''}">${active?(variant==='fog'||chess?'TO MOVE':'PLACING'):''}</div>`
}
function renderPlayers(){const top=flipped?'w':'b',bottom=flipped?'b':'w';$('#top-player').innerHTML=playerMarkup(top);$('#bottom-player').innerHTML=playerMarkup(bottom)}

function renderHistory(){
  if(variant==='fog'){
    const viewer=fogViewer(),hist=fog.history.map(h=>h.move);$('#history-title').textContent='Moves';$('#history-count').textContent=hist.length
    const pairs=[];for(let i=0;i<hist.length;i+=2){const wm=hist[i],bm=hist[i+1];pairs.push({n:Math.floor(i/2)+1,w:wm?(viewer==='w'?`${wm.from}-${wm.to}`:'?'):'',b:bm?(viewer==='b'?`${bm.from}-${bm.to}`:'?'):''})}
    $('#history').innerHTML=pairs.length?pairs.map(p=>`<div class="move-row"><span>${p.n}.</span><b>${p.w}</b><b>${p.b}</b></div>`).join(''):'<div class="history-empty">Opponent moves will be hidden.</div>'
    return
  }
  if(!chess){
    $('#history-title').textContent='Placements';$('#history-count').textContent=setup.history.length
    $('#history').innerHTML=setup.history.length?setup.history.map((m,i)=>`<div class="history-row"><span>${i+1}</span><span class="history-piece">${pieceSvg(m.color+m.piece)}</span><span>${colorName(m.color)} ${NAMES[m.piece]}</span><b>${m.square}</b></div>`).join(''):'<div class="history-empty">Your setup will appear here.</div>'
  }else{
    const hist=chess.history({verbose:true});$('#history-title').textContent='Moves';$('#history-count').textContent=hist.length
    const pairs=[];for(let i=0;i<hist.length;i+=2)pairs.push({n:Math.floor(i/2)+1,w:hist[i]?.san||'',b:hist[i+1]?.san||''})
    $('#history').innerHTML=pairs.length?pairs.map(p=>`<div class="move-row"><span>${p.n}.</span><b>${p.w}</b><b>${p.b}</b></div>`).join(''):'<div class="history-empty">The game starts here.</div>'
  }
}

function renderPanel(){
  const e=currentEngine()
  if(variant==='fog'){
    const turn=fog.turn,vis=fog.visibility(fogViewer())
    $('#phase-label').textContent='FOG OF WAR';$('#phase-title').textContent='Capture the king';$('#turn-dot').className=`turn-dot ${turn==='w'?'white':'black'}`
    $('#engine-settings').hidden=mode!=='ai';$('#setup-section').hidden=true
    $('#status').textContent=fog.winner?`${colorName(fog.winner)} captured the king`:engineBusy?`${e.name} is moving through the fog…`:`${colorName(turn)} to move · no checks`
    $('#stat1-label').textContent='Visible';$('#stat1').textContent=vis.size;$('#stat2-label').textContent='Your moves';$('#stat2').textContent=fog.allMoves(fogViewer()).length;$('#stat3-label').textContent='Goal';$('#stat3').textContent='♚'
    $('#position-label').textContent='FOG';$('#position').textContent=`${vis.size} of 64 squares visible`;$('#position-copy').textContent='Hidden'
    $('#eval-fill').style.height='50%';$('#eval-label').textContent='FOG'
    renderEnginePicker();renderHistory();return
  }
  const phase=!chess,turn=phase?setup.turn:chess.turn()
  $('#phase-label').textContent=phase?'SETUP PHASE':'GAME IN PROGRESS';$('#phase-title').textContent=phase?'Build your army':'Play the position'
  $('#turn-dot').className=`turn-dot ${turn==='w'?'white':'black'}`
  $('#engine-settings').hidden=mode!=='ai'||!phase;$('#setup-section').hidden=!phase;$('#position-copy').textContent='Copy'
  if(phase){
    $('#status').textContent=engineBusy?`${e.name} is placing…`:setup.remaining[setup.turn]===0&&!setup.king[setup.turn]?`${colorName(setup.turn)} must place its king`:`${colorName(setup.turn)} to place`
    $('#placer').textContent=`${colorName(setup.turn)} to place`;$('#placer-dot').className=`mini-dot ${setup.turn==='w'?'white':'black'}`;$('#budget').textContent=setup.remaining[setup.turn]
    $('#stat1-label').textContent='White left';$('#stat1').textContent=setup.remaining.w;$('#stat2-label').textContent='Black left';$('#stat2').textContent=setup.remaining.b;$('#stat3-label').textContent='First move';$('#stat3').textContent=setup.firstMover?colorName(setup.firstMover):'—'
    $('#position-label').textContent='ARMY';$('#position').textContent=[...setup.board.entries()].map(([s,p])=>`${p[1].toUpperCase()}${s}`).join(', ')||'Empty board'
    $('#eval-fill').style.height='50%';$('#eval-label').textContent='SET';renderPieceBank()
  }else{
    const status=chess.isCheckmate()?`${colorName(chess.turn()==='w'?'b':'w')} wins by checkmate`:chess.isDraw()?'Draw':engineBusy?`${e.name} is thinking…`:`${colorName(chess.turn())} to move${chess.inCheck()?' · Check':''}`
    $('#status').textContent=status
    $('#stat1-label').textContent='Engine';$('#stat1').textContent=mode==='ai'?`≈${e.rating}`:'Local';$('#stat2-label').textContent='Depth';$('#stat2').textContent=engineDepth||'—';$('#stat3-label').textContent='Nodes';$('#stat3').textContent=engineNodes?engineNodes>999?`${(engineNodes/1000).toFixed(1)}k`:engineNodes:'—'
    $('#position-label').textContent='FEN';$('#position').textContent=chess.fen()
    const pct=Math.max(8,Math.min(92,50+engineEval/1000*50));$('#eval-fill').style.height=`${pct}%`;$('#eval-label').textContent=engineEval===0?'0.0':`${engineEval>0?'+':''}${(engineEval/100).toFixed(1)}`
  }
  renderEnginePicker();renderHistory()
}

function render(){
  document.querySelectorAll('[data-variant]').forEach(b=>b.classList.toggle('active',b.dataset.variant===variant));document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));document.querySelectorAll('[data-side]').forEach(b=>b.classList.toggle('active',b.dataset.side===requestedSide));renderBoard();renderPlayers();renderPanel();save()
}

function finishSetup(){chess=new Chess(setup.fen(),{skipValidation:true});selectedPiece=null;selectedSquare=null;engineEval=0;engineDepth=0;engineNodes=0;toast(`${colorName(setup.firstMover)} moves first`);render();maybeEngineMove()}
function autoPlace(){
  if(variant!=='setup'||mode!=='ai'||chess||setup.turn===human||setup.complete())return
  engineBusy=true;render();clearTimeout(aiTimer);aiTimer=setTimeout(()=>{
    const color=setup.turn,order=setup.remaining[color]===0&&!setup.king[color]?['k']:['q','r','b','n','p','k'],type=order.find(p=>setup.legalSquares(color,p).length)
    if(type){const squares=setup.legalSquares(color,type),preferred=squares.sort((a,b)=>Math.abs(Number(a[1])-(color==='w'?2:7))-Math.abs(Number(b[1])-(color==='w'?2:7)));setup.place(color,type,preferred[Math.floor(Math.random()*Math.min(preferred.length,4))])}
    engineBusy=false;if(setup.complete())finishSetup();else{render();autoPlace()}
  },250)
}

function onFogSquare(sq){
  if(fogHandoff||!humanMoveTurn()||engineBusy||fog.winner)return
  const viewer=fogViewer(),visible=fog.visibility(viewer),p=visible.has(sq)?fog.get(sq):null
  if(selectedSquare){const move=fog.movesFrom(selectedSquare).find(m=>m.to===sq);if(move){fog.move(selectedSquare,sq,'q');selectedSquare=null;if(mode==='local'&&!fog.winner)fogHandoff=true;render();maybeFogEngineMove();return}}
  selectedSquare=p?.[0]===fog.turn?sq:null;renderBoard()
}
function onSquare(sq){
  if(variant==='fog'){onFogSquare(sq);return}
  if(!chess){
    if(!humanSetupTurn()||engineBusy)return
    if(!selectedPiece)return toast('Choose a piece from the bank first')
    try{setup.place(setup.turn,selectedPiece,sq);selectedPiece=null;if(setup.complete())finishSetup();else{render();autoPlace()}}catch(e){toast(e.message)}
    return
  }
  if(!humanMoveTurn()||engineBusy||chess.isGameOver())return
  const p=chess.get(sq)
  if(selectedSquare){const move=chess.moves({square:selectedSquare,verbose:true}).find(m=>m.to===sq);if(move){try{chess.move({from:selectedSquare,to:sq,promotion:'q'});selectedSquare=null;engineEval=0;engineDepth=0;engineNodes=0;render();maybeEngineMove();return}catch{}}}
  selectedSquare=p?.color===chess.turn()?sq:null;renderBoard()
}

function maybeFogEngineMove(){
  if(variant!=='fog'||mode!=='ai'||fog.turn===human||fog.winner)return
  engineBusy=true;render();clearTimeout(fogTimer);const e=currentEngine();fogTimer=setTimeout(()=>{const m=chooseFogMove(fog,fog.turn,e.fog);if(m)fog.move(m.from,m.to,m.promotion||'q');engineBusy=false;render()},Math.max(220,700-e.fog*100))
}
function maybeEngineMove(){if(variant!=='setup'||mode!=='ai'||!chess||chess.turn()===human||chess.isGameOver())return;engineBusy=true;render();const e=currentEngine();worker.postMessage({fen:chess.fen(),maxDepth:e.depth,timeMs:e.time})}
worker.onmessage=ev=>{
  if(variant!=='setup')return
  const d=ev.data||{};if(d.type==='progress'){engineEval=d.score||0;engineDepth=d.depth||0;engineNodes=d.nodes||0;renderPanel();return}
  engineBusy=false;if(d.type==='result'&&d.move){try{chess.move(d.move)}catch{}}if(d.depth)engineDepth=d.depth;if(d.nodes)engineNodes=d.nodes;render()
}

function newGame(){
  clearTimeout(aiTimer);clearTimeout(fogTimer);setup=new SetupGame();chess=null;fog=new FogGame();selectedPiece=null;selectedSquare=null;engineBusy=false;engineEval=0;engineDepth=0;engineNodes=0
  human=requestedSide==='random'?(Math.random()<.5?'w':'b'):requestedSide;flipped=human==='b';fogHandoff=variant==='fog'&&mode==='local';render();if(variant==='fog')maybeFogEngineMove();else autoPlace()
}
function undo(){
  if(engineBusy)return
  if(variant==='fog'){fog.undo();if(mode==='ai'&&fog.history.length&&fog.turn!==human)fog.undo();selectedSquare=null;fogHandoff=mode==='local';render();return}
  if(!chess){setup.undo();selectedPiece=null;render();autoPlace();return}chess.undo();if(mode==='ai'&&chess.history().length&&chess.turn()!==human)chess.undo();selectedSquare=null;engineEval=0;engineDepth=0;engineNodes=0;render()
}
async function copyPosition(){
  if(variant==='fog'){toast('Full position is hidden in Fog Chess');return}
  const text=chess?chess.fen():[...setup.board.entries()].map(([s,p])=>`${p[1].toUpperCase()}${s}`).join(', ');try{await navigator.clipboard.writeText(text);toast(chess?'FEN copied':'Army copied')}catch{toast('Copy failed')}
}

$('#undo').onclick=undo;$('#flip').onclick=()=>{flipped=!flipped;render()};$('#copy').onclick=copyPosition;$('#position-copy').onclick=copyPosition;$('#new').onclick=newGame;$('#rail-new').onclick=newGame
$('#rail-rules').onclick=()=>$('#rules-dialog').showModal();$('#close-rules').onclick=()=>$('#rules-dialog').close();$('#mobile-menu').onclick=()=>$('#game-panel').scrollIntoView({behavior:'smooth'})
$('#fog-handoff').onclick=()=>{fogHandoff=false;selectedSquare=null;flipped=fog.turn==='b';render()}
document.querySelectorAll('[data-variant]').forEach(b=>b.onclick=()=>{variant=b.dataset.variant;newGame()})
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;newGame()})
document.querySelectorAll('[data-side]').forEach(b=>b.onclick=()=>{requestedSide=b.dataset.side;document.querySelectorAll('[data-side]').forEach(x=>x.classList.toggle('active',x.dataset.side===requestedSide));toast('Applies to the next game')})

load();render();if(variant==='fog')maybeFogEngineMove();else if(!chess)autoPlace();else maybeEngineMove()
