import './fog.css'

const FILES=['a','b','c','d','e','f','g','h']
const inside=(f,r)=>f>=0&&f<8&&r>=1&&r<=8
const sq=(f,r)=>`${FILES[f]}${r}`
const pos=s=>[FILES.indexOf(s[0]),Number(s[1])]
const other=c=>c==='w'?'b':'w'

export class FogGame{
  constructor(){this.reset()}
  reset(){
    this.board=new Map();this.turn='w';this.winner=null;this.enPassant=null;this.castle={w:{k:true,q:true},b:{k:true,q:true}};this.history=[]
    const back=['r','n','b','q','k','b','n','r']
    for(let i=0;i<8;i++){this.board.set(sq(i,1),'w'+back[i]);this.board.set(sq(i,2),'wp');this.board.set(sq(i,7),'bp');this.board.set(sq(i,8),'b'+back[i])}
  }
  cloneState(){return{board:[...this.board.entries()],turn:this.turn,winner:this.winner,enPassant:this.enPassant,castle:JSON.parse(JSON.stringify(this.castle))}}
  restore(s){this.board=new Map(s.board);this.turn=s.turn;this.winner=s.winner;this.enPassant=s.enPassant;this.castle=JSON.parse(JSON.stringify(s.castle))}
  get(square){return this.board.get(square)||null}
  allMoves(color=this.turn){const out=[];for(const [s,p] of this.board)if(p[0]===color)out.push(...this.movesFrom(s));return out}
  movesFrom(from){
    const code=this.get(from);if(!code||this.winner)return[]
    const color=code[0],type=code[1],[f,r]=pos(from),enemy=other(color),out=[]
    const add=(tf,tr,special=null)=>{if(!inside(tf,tr))return false;const to=sq(tf,tr),target=this.get(to);if(target?.[0]===color)return false;out.push({from,to,piece:type,color,captured:target||null,special});return !target}
    if(type==='p'){
      const d=color==='w'?1:-1,start=color==='w'?2:7,promo=color==='w'?8:1
      const one=sq(f,r+d)
      if(inside(f,r+d)&&!this.get(one)){
        out.push({from,to:one,piece:type,color,captured:null,promotion:r+d===promo?'q':null})
        const two=sq(f,r+2*d);if(r===start&&!this.get(two))out.push({from,to:two,piece:type,color,captured:null,special:'double'})
      }
      for(const df of[-1,1])if(inside(f+df,r+d)){
        const to=sq(f+df,r+d),target=this.get(to)
        if(target?.[0]===enemy)out.push({from,to,piece:type,color,captured:target,promotion:r+d===promo?'q':null})
        else if(this.enPassant===to)out.push({from,to,piece:type,color,captured:enemy+'p',special:'ep'})
      }
      return out
    }
    if(type==='n'){for(const[df,dr]of[[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]])add(f+df,r+dr);return out}
    if(type==='b'||type==='r'||type==='q'){
      const dirs=type==='b'?[[1,1],[1,-1],[-1,1],[-1,-1]]:type==='r'?[[1,0],[-1,0],[0,1],[0,-1]]:[[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]
      for(const[df,dr]of dirs){let tf=f+df,tr=r+dr;while(inside(tf,tr)){if(!add(tf,tr))break;tf+=df;tr+=dr}}
      return out
    }
    if(type==='k'){
      for(let df=-1;df<=1;df++)for(let dr=-1;dr<=1;dr++)if(df||dr)add(f+df,r+dr)
      const home=color==='w'?1:8
      if(from===`e${home}`){
        if(this.castle[color].k&&this.get(`h${home}`)===color+'r'&&!this.get(`f${home}`)&&!this.get(`g${home}`))out.push({from,to:`g${home}`,piece:'k',color,captured:null,special:'castle-k'})
        if(this.castle[color].q&&this.get(`a${home}`)===color+'r'&&!this.get(`b${home}`)&&!this.get(`c${home}`)&&!this.get(`d${home}`))out.push({from,to:`c${home}`,piece:'k',color,captured:null,special:'castle-q'})
      }
    }
    return out
  }
  move(from,to,promotion='q'){
    if(this.winner)return null
    const move=this.movesFrom(from).find(m=>m.to===to);if(!move||move.color!==this.turn)return null
    this.history.push({state:this.cloneState(),move:{...move}})
    const code=this.get(from);this.board.delete(from)
    if(move.special==='ep'){const[f,r]=pos(to);this.board.delete(sq(f,r+(move.color==='w'?-1:1)))}
    if(move.special==='castle-k'){const home=move.color==='w'?1:8;this.board.delete(`h${home}`);this.board.set(`f${home}`,move.color+'r')}
    if(move.special==='castle-q'){const home=move.color==='w'?1:8;this.board.delete(`a${home}`);this.board.set(`d${home}`,move.color+'r')}
    const placed=move.promotion?move.color+(promotion||'q'):code;this.board.set(to,placed)
    if(move.captured?.[1]==='k')this.winner=move.color
    if(code[1]==='k'){this.castle[move.color].k=false;this.castle[move.color].q=false}
    if(code[1]==='r'){
      if(from===(move.color==='w'?'a1':'a8'))this.castle[move.color].q=false
      if(from===(move.color==='w'?'h1':'h8'))this.castle[move.color].k=false
    }
    const victim=other(move.color)
    if(to===(victim==='w'?'a1':'a8'))this.castle[victim].q=false
    if(to===(victim==='w'?'h1':'h8'))this.castle[victim].k=false
    this.enPassant=null
    if(code[1]==='p'&&move.special==='double'){const[f,r]=pos(from);this.enPassant=sq(f,r+(move.color==='w'?1:-1))}
    if(!this.winner)this.turn=other(this.turn)
    return move
  }
  undo(){const h=this.history.pop();if(!h)return null;this.restore(h.state);return h.move}
  visibility(color){
    const visible=new Set()
    for(const[s,p]of this.board)if(p[0]===color)visible.add(s)
    for(const[s,p]of this.board)if(p[0]===color)for(const m of this.movesFrom(s))visible.add(m.to)
    if(this.enPassant&&this.turn===color)visible.add(this.enPassant)
    return visible
  }
  serialize(){return this.history.map(h=>({from:h.move.from,to:h.move.to,promotion:h.move.promotion||null}))}
  loadMoves(moves=[]){for(const m of moves){if(!this.move(m.from,m.to,m.promotion||'q'))break}}
  positionString(){return[...this.board.entries()].sort().map(([s,p])=>`${p}${s}`).join(' ')}
}

const VALUE={p:100,n:320,b:330,r:500,q:900,k:10000}
export function chooseFogMove(game,color,strength=2){
  const moves=game.allMoves(color);if(!moves.length)return null
  const visible=game.visibility(color)
  const scored=moves.map(m=>{
    let score=0
    if(m.captured)score+=(m.captured[1]==='k'?100000:VALUE[m.captured[1]]||0)
    const[f,r]=pos(m.to);score+=14-(Math.abs(3.5-f)+Math.abs(4.5-r))*2
    if(m.piece==='p')score+=(color==='w'?r:9-r)*3
    if(m.special?.startsWith('castle'))score+=35
    if(m.captured&&!visible.has(m.to))score-=20
    score+=(Math.random()-.5)*(strength===1?220:strength===2?100:strength===3?40:12)
    return{m,score}
  }).sort((a,b)=>b.score-a.score)
  const pool=strength<=1?Math.min(8,scored.length):strength===2?Math.min(5,scored.length):strength===3?Math.min(3,scored.length):1
  return scored[Math.floor(Math.random()*pool)].m
}
