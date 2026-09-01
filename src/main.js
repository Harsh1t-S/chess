import { Chess } from 'chess.js'
import './style.css'

const FILES = ['a','b','c','d','e','f','g','h']
const GLYPHS = { wk:'♔', wq:'♕', wr:'♖', wb:'♗', wn:'♘', wp:'♙', bk:'♚', bq:'♛', br:'♜', bb:'♝', bn:'♞', bp:'♟' }
const COST = { q:9, r:5, b:3, n:3, p:1, k:0 }
const NAMES = { q:'Queen', r:'Rook', b:'Bishop', n:'Knight', p:'Pawn', k:'King' }
const DIFFICULTY = { quick:{depth:2,time:180}, club:{depth:3,time:650}, strong:{depth:4,time:1800}, forge:{depth:5,time:4200} }

class SetupGame {
  constructor(){ this.board=new Map(); this.remaining={w:39,b:39}; this.king={w:false,b:false}; this.turn='w'; this.firstMover=null; this.history=[] }
  finished(c){ return this.remaining[c]===0 && this.king[c] }
  complete(){ return this.finished('w') && this.finished('b') }
  canPlace(c,p,sq){
    if (this.complete()) return false
    if (c!==this.turn || this.board.has(sq) || !(p in COST) || COST[p]>this.remaining[c]) return false
    if (p==='k' && this.king[c]) return false
    const rank=Number(sq[1])
    if (c==='w') return p==='p' ? rank===2||rank===3 : rank>=1&&rank<=3
    return p==='p' ? rank===6||rank===7 : rank>=6&&rank<=8
  }
  place(c,p,sq){
    if (!this.canPlace(c,p,sq)) throw new Error('That placement is not allowed.')
    this.board.set(sq,c+p); this.remaining[c]-=COST[p]; if(p==='k') this.king[c]=true
    this.history.push({color:c,piece:p,square:sq})
    if(this.finished(c) && !this.firstMover) this.firstMover=c
    if(!this.complete()) { const other=c==='w'?'b':'w'; this.turn=this.finished(other)?c:other }
  }
  undo(){
    if(!this.history.length) return
    const h=this.history.pop(); this.board.delete(h.square); this.remaining[h.color]+=COST[h.piece]; if(h.piece==='k') this.king[h.color]=false
    this.turn=h.color; this.firstMover=null
    for(const c of ['w','b']) if(this.finished(c)){ this.firstMover=c; break }
  }
  legalSquares(c,p){ return FILES.flatMap(f=>[1,2,3,4,5,6,7,8].map(r=>`${f}${r}`)).filter(s=>this.canPlace(c,p,s)) }
  fen(){
    if(!this.complete()) throw new Error('Finish both armies first.')
    const rows=[]
    for(let r=8;r>=1;r--){ let row='', empty=0; for(const f of FILES){ const x=this.board.get(`${f}${r}`); if(!x){empty++;continue} if(empty){row+=empty;empty=0} row+=x[0]==='w'?x[1].toUpperCase():x[1] } if(empty) row+=empty; rows.push(row) }
    return `${rows.join('/')} ${this.firstMover||'w'} - - 0 1`
  }
}

const app=document.querySelector('#app')
app.innerHTML=`
<header class="topbar"><div class="brand"><span>♞</span><div><strong>ForgeChess</strong><small>Setup Chess engine</small></div></div><div class="mode-tabs"><button data-mode="ai" class="active">Vs engine</button><button data-mode="local">Two player</button></div></header>
<main class="layout">
  <aside class="panel controls">
    <div class="panel-head"><div><small id="phase-label">PHASE ONE</small><h2 id="phase-title">Build your army</h2></div><button id="new">New</button></div>
    <div id="ai-settings"><label>Play as</label><div class="choices"><button data-side="w" class="active">White</button><button data-side="b">Black</button><button data-side="random">Random</button></div><label>Engine strength</label><select id="difficulty"><option value="quick">Quick</option><option value="club" selected>Club</option><option value="strong">Strong</option><option value="forge">Forge</option></select></div>
    <div id="setup-controls"><div class="budget"><span id="placer">White places</span><strong><span id="budget">39</span> pts</strong></div><p id="help">Choose a piece, then tap a highlighted square.</p><div id="palette" class="palette"></div></div>
    <div class="actions"><button id="undo">↶ Undo</button><button id="flip">⇅ Flip</button><button id="copy">⧉ Copy</button></div>
  </aside>
  <section class="game-area"><div id="top-player" class="player"></div><div class="board-wrap"><div id="eval" class="eval"><div id="eval-fill"></div></div><div id="board" class="board" role="grid"></div></div><div id="bottom-player" class="player"></div><div class="mobile-actions"><button id="m-undo">↶ Undo</button><button id="m-flip">⇅ Flip</button><button id="m-new">＋ New</button></div></section>
  <aside class="panel info"><div class="status"><span id="orb"></span><div><small>MATCH STATUS</small><h2 id="status">White places first</h2></div></div><div class="metrics"><div><small id="m1l">White left</small><strong id="m1">39</strong></div><div><small id="m2l">Black left</small><strong id="m2">39</strong></div><div><small id="m3l">First move</small><strong id="m3">—</strong></div></div><h3 id="log-title">Placements</h3><div id="log" class="log"></div><div class="position"><small id="pos-label">ARMY</small><code id="pos"></code></div></aside>
</main><div id="toast" class="toast"></div>`

let mode='ai', requestedSide='w', human='w', difficulty='club', flipped=false, selectedPiece=null, selectedSquare=null, setup=new SetupGame(), chess=null, engineBusy=false
const worker=new Worker(new URL('./engine.worker.js',import.meta.url),{type:'module'})
const $=s=>document.querySelector(s)
const colorName=c=>c==='w'?'White':'Black'

function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>t.classList.remove('show'),1800) }
function boardPiece(sq){ return chess ? chess.get(sq) && chess.get(sq).color+chess.get(sq).type : setup.board.get(sq) }
function humanSetupTurn(){ return mode==='local'||setup.turn===human }
function humanMoveTurn(){ return mode==='local'||(chess&&chess.turn()===human) }
function save(){ localStorage.setItem('forgechess-v3',JSON.stringify({mode,requestedSide,human,difficulty,flipped,placements:setup.history,phase:chess?'play':'setup',moves:chess?chess.history({verbose:true}).map(m=>({from:m.from,to:m.to,promotion:m.promotion})):[]})) }
function load(){ try{ const s=JSON.parse(localStorage.getItem('forgechess-v3')); if(!s)return; mode=s.mode||'ai';requestedSide=s.requestedSide||'w';human=s.human||'w';difficulty=s.difficulty||'club';flipped=!!s.flipped;setup=new SetupGame();for(const m of s.placements||[])setup.place(m.color,m.piece,m.square);if(s.phase==='play'&&setup.complete()){chess=new Chess(setup.fen(),{skipValidation:true});for(const m of s.moves||[])chess.move(m)} }catch{} }

function renderPalette(){ const p=$('#palette'); p.innerHTML=''; for(const piece of ['q','r','b','n','p','k']){ const b=document.createElement('button'); b.className='piece-btn'+(selectedPiece===piece?' active':''); b.disabled=!humanSetupTurn()||!setup.canPlace(setup.turn,piece,setup.legalSquares(setup.turn,piece)[0]||'z9'); b.innerHTML=`<span>${GLYPHS[setup.turn+piece]}</span><small>${NAMES[piece]}</small><strong>${piece==='k'?'FREE':COST[piece]}</strong>`; b.onclick=()=>{selectedPiece=selectedPiece===piece?null:piece;render()}; p.append(b) } }
function renderBoard(){ const board=$('#board');board.innerHTML=''; const ranks=flipped?[1,2,3,4,5,6,7,8]:[8,7,6,5,4,3,2,1], files=flipped?[...FILES].reverse():FILES; const legal=new Set(!chess&&selectedPiece&&humanSetupTurn()?setup.legalSquares(setup.turn,selectedPiece):[]); let moveTargets=[]; if(chess&&selectedSquare) moveTargets=chess.moves({square:selectedSquare,verbose:true}); const last=chess?chess.history({verbose:true}).at(-1):null
 for(const r of ranks)for(const f of files){ const sq=`${f}${r}`, el=document.createElement('button');el.className=`square ${(FILES.indexOf(f)+r)%2===0?'light':'dark'}`;el.dataset.square=sq; if(!chess){if((r<=3||r>=6))el.classList.add('zone');if(legal.has(sq))el.classList.add('legal')} else {if(selectedSquare===sq)el.classList.add('selected');if(moveTargets.some(m=>m.to===sq))el.classList.add('legal');if(last&&(last.from===sq||last.to===sq))el.classList.add('last');if(chess.inCheck()){const p=chess.get(sq);if(p?.type==='k'&&p.color===chess.turn())el.classList.add('check')}} const piece=boardPiece(sq); if(piece){const sp=document.createElement('span');sp.className='glyph '+(piece[0]==='w'?'white':'black');sp.textContent=GLYPHS[piece];el.append(sp)} el.onclick=()=>onSquare(sq);board.append(el) }
}
function renderPlayers(){ const top=flipped?'w':'b', bottom=flipped?'b':'w'; const make=c=>`<span class="avatar ${c}">${GLYPHS[c+'p']}</span><div><strong>${mode==='ai'?(c===human?'You':'Forge engine'):colorName(c)}</strong><small>${chess?(chess.turn()===c?'to move':''):`${setup.remaining[c]} pts left${setup.king[c]?'':' · king needed'}`}</small></div>`;$('#top-player').innerHTML=make(top);$('#bottom-player').innerHTML=make(bottom) }
function renderInfo(){ const phase=!chess;$('#phase-label').textContent=phase?'PHASE ONE':'PHASE TWO';$('#phase-title').textContent=phase?'Build your army':'Fight the battle';$('#setup-controls').hidden=!phase;$('#ai-settings').hidden=mode!=='ai'||!phase; if(phase){$('#placer').textContent=`${colorName(setup.turn)} places`;$('#budget').textContent=setup.remaining[setup.turn];$('#status').textContent=engineBusy?`Forge is placing for ${colorName(setup.turn)}`:setup.remaining[setup.turn]===0&&!setup.king[setup.turn]?`${colorName(setup.turn)} must place a king`:`${colorName(setup.turn)} places a piece`;$('#m1').textContent=setup.remaining.w;$('#m2').textContent=setup.remaining.b;$('#m3').textContent=setup.firstMover?colorName(setup.firstMover):'—';$('#log-title').textContent='Placements';$('#log').innerHTML=setup.history.map((m,i)=>`<div>${i+1}. ${GLYPHS[m.color+m.piece]} ${colorName(m.color)} ${NAMES[m.piece]} <strong>${m.square}</strong></div>`).join('')||'<p>No pieces placed yet.</p>';$('#pos').textContent=[...setup.board.entries()].map(([s,p])=>`${p[1].toUpperCase()}${s}`).join(', ')||'Empty board · 39 points each';$('#eval-fill').style.height='50%'} else {let status=chess.isCheckmate()?`${colorName(chess.turn()==='w'?'b':'w')} wins by checkmate`:chess.isDraw()?'Draw':engineBusy?'Forge is thinking':`${colorName(chess.turn())} to move${chess.inCheck()?' — check':''}`;$('#status').textContent=status;$('#m1l').textContent='Moves';$('#m1').textContent=chess.history().length;$('#m2l').textContent='Turn';$('#m2').textContent=colorName(chess.turn());$('#m3l').textContent='Engine';$('#m3').textContent=DIFFICULTY[difficulty].depth;$('#log-title').textContent='Moves';$('#log').innerHTML=chess.history().map((m,i)=>`<div>${i+1}. ${m}</div>`).join('')||'<p>The battle starts here.</p>';$('#pos-label').textContent='FEN';$('#pos').textContent=chess.fen() } $('#orb').className=(!chess?setup.turn:chess.turn())==='w'?'white':'black';renderPalette() }
function render(){ renderBoard();renderPlayers();renderInfo();save() }

function finishSetup(){ chess=new Chess(setup.fen(),{skipValidation:true});selectedPiece=null;toast(`${colorName(setup.firstMover)} moves first`);render();maybeEngineMove() }
function autoPlace(){ if(mode!=='ai'||chess||setup.turn===human||setup.complete())return; engineBusy=true;render();setTimeout(()=>{const choices=['p','n','b','r','q','k'].filter(p=>setup.legalSquares(setup.turn,p).length); const p=choices.find(x=>x==='k'&&!setup.king[setup.turn]&&setup.remaining[setup.turn]===0)||choices[Math.floor(Math.random()*choices.length)]; const squares=setup.legalSquares(setup.turn,p); if(p&&squares.length)setup.place(setup.turn,p,squares[Math.floor(Math.random()*squares.length)]);engineBusy=false;if(setup.complete())finishSetup();else{render();autoPlace()}},180) }
function onSquare(sq){ if(!chess){if(!humanSetupTurn()||engineBusy)return;if(!selectedPiece)return toast('Choose a piece first');try{setup.place(setup.turn,selectedPiece,sq);selectedPiece=null;if(setup.complete())finishSetup();else{render();autoPlace()}}catch(e){toast(e.message)}return} if(!humanMoveTurn()||engineBusy||chess.isGameOver())return; const p=chess.get(sq); if(selectedSquare){const move=chess.moves({square:selectedSquare,verbose:true}).find(m=>m.to===sq);if(move){try{chess.move({from:selectedSquare,to:sq,promotion:'q'});selectedSquare=null;render();maybeEngineMove();return}catch{}}} selectedSquare=p?.color===chess.turn()?sq:null;renderBoard() }
function maybeEngineMove(){ if(mode!=='ai'||!chess||chess.turn()===human||chess.isGameOver())return;engineBusy=true;renderInfo();const d=DIFFICULTY[difficulty];worker.postMessage({fen:chess.fen(),maxDepth:d.depth,timeMs:d.time}) }
worker.onmessage=e=>{engineBusy=false;if(e.data?.move){try{chess.move(e.data.move)}catch{}}render()}
function newGame(){ setup=new SetupGame();chess=null;selectedPiece=null;selectedSquare=null;engineBusy=false;human=requestedSide==='random'?(Math.random()<.5?'w':'b'):requestedSide;flipped=human==='b';render();autoPlace() }
function undo(){ if(engineBusy)return;if(!chess){setup.undo();selectedPiece=null;render();autoPlace();return} chess.undo();if(mode==='ai'&&chess.history().length&&chess.turn()!==human)chess.undo();selectedSquare=null;render() }
async function copyPos(){ const text=chess?chess.fen():[...setup.board.entries()].map(([s,p])=>`${p[1].toUpperCase()}${s}`).join(', ');await navigator.clipboard.writeText(text);toast(chess?'FEN copied':'Army copied') }

$('#new').onclick=newGame;$('#m-new').onclick=newGame;$('#undo').onclick=undo;$('#m-undo').onclick=undo;$('#flip').onclick=()=>{flipped=!flipped;render()};$('#m-flip').onclick=()=>{flipped=!flipped;render()};$('#copy').onclick=copyPos
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x===b));newGame()}
for(const b of document.querySelectorAll('[data-side]'))b.onclick=()=>{requestedSide=b.dataset.side;document.querySelectorAll('[data-side]').forEach(x=>x.classList.toggle('active',x===b));toast('Color choice applies to the next game')}
$('#difficulty').onchange=e=>{difficulty=e.target.value;save()}
load();$('#difficulty').value=difficulty;document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x.dataset.mode===mode));document.querySelectorAll('[data-side]').forEach(x=>x.classList.toggle('active',x.dataset.side===requestedSide));render();if(!chess)autoPlace();else maybeEngineMove()
