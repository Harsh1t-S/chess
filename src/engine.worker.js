import { Chess } from 'chess.js'

const VALUE={p:100,n:320,b:330,r:500,q:900,k:0}
const MATE=100000

function evaluate(game){
  let score=0
  const board=game.board()
  for(let r=0;r<8;r++)for(let f=0;f<8;f++){
    const p=board[r][f]
    if(!p)continue
    let v=VALUE[p.type]
    const center=7-(Math.abs(f-3.5)+Math.abs(r-3.5))
    if(p.type==='n')v+=center*7
    if(p.type==='b')v+=center*4
    if(p.type==='p')v+=(p.color==='w'?7-r:r)*8
    score+=p.color==='w'?v:-v
  }
  return score
}

function orderedMoves(game){
  return game.moves({verbose:true}).sort((a,b)=>moveScore(b)-moveScore(a))
}
function moveScore(m){
  let s=0
  if(m.captured)s+=10000+(VALUE[m.captured]||0)*10-(VALUE[m.piece]||0)
  if(m.promotion)s+=8000+(VALUE[m.promotion]||0)
  if(m.san.includes('#'))s+=50000
  else if(m.san.includes('+'))s+=500
  return s
}
function terminal(game,ply){
  if(game.isCheckmate())return -MATE+ply
  if(game.isDraw())return 0
  return null
}
function negamax(game,depth,alpha,beta,ctx,ply=0){
  ctx.nodes++
  if((ctx.nodes&1023)===0&&performance.now()>=ctx.deadline)throw new Error('timeout')
  const end=terminal(game,ply)
  if(end!==null)return end
  if(depth===0){const e=evaluate(game);return (game.turn()==='w'?1:-1)*e}
  let best=-Infinity
  for(const m of orderedMoves(game)){
    game.move(m)
    const score=-negamax(game,depth-1,-beta,-alpha,ctx,ply+1)
    game.undo()
    if(score>best)best=score
    if(score>alpha)alpha=score
    if(alpha>=beta)break
  }
  return best
}
function search(fen,maxDepth,timeMs){
  const game=new Chess(fen,{skipValidation:true})
  const moves=orderedMoves(game)
  if(!moves.length)return {move:null,depth:0,nodes:0}
  const ctx={deadline:performance.now()+Math.max(50,timeMs),nodes:0}
  let best={from:moves[0].from,to:moves[0].to,promotion:moves[0].promotion},completed=0
  for(let depth=1;depth<=maxDepth;depth++){
    let localBest=best,localScore=-Infinity
    try{
      for(const m of orderedMoves(game)){
        game.move(m)
        const score=-negamax(game,depth-1,-Infinity,Infinity,ctx,1)
        game.undo()
        if(score>localScore){localScore=score;localBest={from:m.from,to:m.to,promotion:m.promotion}}
      }
      best=localBest;completed=depth
      self.postMessage({type:'progress',depth,nodes:ctx.nodes,score:(game.turn()==='w'?1:-1)*localScore})
      if(Math.abs(localScore)>MATE-100||performance.now()>=ctx.deadline)break
    }catch(e){if(e.message!=='timeout')throw e;break}
  }
  return {move:best,depth:completed,nodes:ctx.nodes}
}
self.onmessage=e=>{
  try{self.postMessage({type:'result',...search(e.data.fen,e.data.maxDepth||3,e.data.timeMs||600)})}
  catch(err){self.postMessage({type:'error',message:err instanceof Error?err.message:String(err)})}
}
