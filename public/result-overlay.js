(()=>{
  const style=document.createElement('style');
  style.textContent=`
    .fc-result-backdrop{position:fixed;inset:0;z-index:250;background:rgba(8,9,8,.72);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);display:grid;place-items:center;padding:20px;animation:fcFade .18s ease-out}
    .fc-result-backdrop[hidden]{display:none}
    .fc-result-card{width:min(92vw,430px);overflow:hidden;border-radius:18px;background:linear-gradient(180deg,#34322f 0%,#242321 100%);border:1px solid rgba(255,255,255,.12);box-shadow:0 30px 80px rgba(0,0,0,.55);text-align:center;color:#f5f4f1;animation:fcPop .22s cubic-bezier(.2,.85,.25,1.1)}
    .fc-result-hero{padding:30px 26px 22px;background:radial-gradient(circle at 50% -20%,rgba(129,182,76,.32),transparent 58%)}
    .fc-result-icon{width:76px;height:76px;margin:0 auto 15px;border-radius:50%;display:grid;place-items:center;font-size:2.4rem;font-weight:900;background:#171815;border:1px solid rgba(255,255,255,.12);box-shadow:0 12px 28px rgba(0,0,0,.35)}
    .fc-result-card.win .fc-result-icon{background:linear-gradient(145deg,#85bb4e,#547d32);color:#fff;box-shadow:0 13px 32px rgba(90,145,48,.35)}
    .fc-result-card.loss .fc-result-icon{background:linear-gradient(145deg,#58534d,#302d29);color:#d8d4ce}
    .fc-result-card.draw .fc-result-icon{background:linear-gradient(145deg,#7f776d,#4d4842);color:#fff}
    .fc-result-kicker{font-size:.68rem;letter-spacing:.16em;font-weight:900;color:#98c66d;text-transform:uppercase;margin-bottom:6px}
    .fc-result-title{font-size:2rem;line-height:1.05;margin:0;font-weight:900;letter-spacing:-.045em}
    .fc-result-reason{margin:10px auto 0;color:#b9b5af;font-size:.9rem;line-height:1.45;max-width:310px}
    .fc-result-score{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:20px;font-weight:800}
    .fc-result-side{display:flex;align-items:center;gap:7px;color:#d8d5d0}
    .fc-result-dot{width:15px;height:15px;border-radius:50%;border:2px solid #777}
    .fc-result-dot.white{background:#f3f0e7;border-color:#d7d3ca}.fc-result-dot.black{background:#151514;border-color:#66615b}
    .fc-result-vs{color:#77736d;font-size:.7rem;letter-spacing:.12em}
    .fc-result-actions{padding:17px;display:grid;grid-template-columns:1fr 1.25fr;gap:9px;border-top:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.1)}
    .fc-result-actions button{min-height:46px;border-radius:9px;font-weight:850;border:0;cursor:pointer;font-size:.86rem}
    .fc-result-review{background:#403d39;color:#e6e2dc;border:1px solid rgba(255,255,255,.08)!important}.fc-result-rematch{background:#81b64c;color:white;box-shadow:0 5px 0 #5d8b35}.fc-result-rematch:active{transform:translateY(2px);box-shadow:0 3px 0 #5d8b35}
    @keyframes fcFade{from{opacity:0}to{opacity:1}}@keyframes fcPop{from{transform:translateY(10px) scale(.96);opacity:0}to{transform:none;opacity:1}}
    @media(max-width:520px){.fc-result-backdrop{padding:14px}.fc-result-card{border-radius:15px}.fc-result-hero{padding:25px 18px 18px}.fc-result-icon{width:66px;height:66px;font-size:2rem}.fc-result-title{font-size:1.75rem}.fc-result-actions{padding:12px}.fc-result-actions button{min-height:44px}}
    @media(prefers-reduced-motion:reduce){.fc-result-backdrop,.fc-result-card{animation:none}}
  `;
  document.head.append(style);

  const overlay=document.createElement('div');
  overlay.className='fc-result-backdrop';overlay.hidden=true;
  overlay.innerHTML=`<div class="fc-result-card" role="dialog" aria-modal="true" aria-labelledby="fc-result-title">
    <div class="fc-result-hero">
      <div class="fc-result-icon" id="fc-result-icon">♚</div>
      <div class="fc-result-kicker" id="fc-result-kicker">GAME OVER</div>
      <h2 class="fc-result-title" id="fc-result-title">Victory</h2>
      <p class="fc-result-reason" id="fc-result-reason"></p>
      <div class="fc-result-score"><span class="fc-result-side"><i class="fc-result-dot white"></i>White</span><span class="fc-result-vs">VS</span><span class="fc-result-side"><i class="fc-result-dot black"></i>Black</span></div>
    </div>
    <div class="fc-result-actions"><button class="fc-result-review" type="button">Review board</button><button class="fc-result-rematch" type="button">Play again</button></div>
  </div>`;
  document.body.append(overlay);

  const card=overlay.querySelector('.fc-result-card'),title=overlay.querySelector('#fc-result-title'),reason=overlay.querySelector('#fc-result-reason'),icon=overlay.querySelector('#fc-result-icon'),kicker=overlay.querySelector('#fc-result-kicker');
  let lastSignature='',dismissed='';

  function humanColor(){
    for(const bar of document.querySelectorAll('.player-bar')){
      if(!/\bYou\b/.test(bar.textContent||''))continue;
      const av=bar.querySelector('.player-avatar');
      if(av?.classList.contains('w'))return'w';
      if(av?.classList.contains('b'))return'b';
    }
    return null;
  }
  function isEngineMode(){return document.querySelector('[data-mode="ai"]')?.classList.contains('active')}
  function parseResult(text){
    if(!text)return null;
    const lower=text.toLowerCase();
    if(lower==='draw'||lower.startsWith('draw ')||lower.includes('stalemate'))return{kind:'draw',winner:null,reason:lower.includes('stalemate')?'Draw by stalemate':'The game ended in a draw'};
    const winner=lower.startsWith('white')?'w':lower.startsWith('black')?'b':null;
    if(!winner)return null;
    if(lower.includes('wins by checkmate'))return{kind:'win',winner,reason:`${winner==='w'?'White':'Black'} wins by checkmate`};
    if(lower.includes('captured the king'))return{kind:'win',winner,reason:`${winner==='w'?'White':'Black'} captured the enemy king`};
    return null;
  }
  function show(result,signature){
    const ai=isEngineMode(),human=humanColor();let outcome='neutral';
    if(result.kind==='draw')outcome='draw';
    else if(ai&&human)outcome=result.winner===human?'win':'loss';
    else outcome='win';
    card.classList.remove('win','loss','draw');card.classList.add(outcome==='neutral'?'win':outcome);
    if(result.kind==='draw'){title.textContent='Draw';icon.textContent='½';kicker.textContent='GAME OVER'}
    else if(ai&&human){title.textContent=result.winner===human?'Victory':'Defeat';icon.textContent=result.winner===human?'♛':'♚';kicker.textContent=result.winner===human?'YOU WON':'YOU LOST'}
    else{title.textContent=`${result.winner==='w'?'White':'Black'} wins`;icon.textContent='♚';kicker.textContent='GAME OVER'}
    reason.textContent=result.reason;overlay.hidden=false;lastSignature=signature;
  }
  function check(){
    const status=document.querySelector('#status');if(!status)return;
    const text=(status.textContent||'').trim(),result=parseResult(text);
    if(!result){lastSignature='';dismissed='';if(!overlay.hidden)overlay.hidden=true;return}
    const signature=text+'|'+(document.querySelector('[data-variant].active')?.textContent||'')+'|'+(document.querySelector('[data-mode].active')?.textContent||'');
    if(signature===dismissed||signature===lastSignature&&!overlay.hidden)return;
    show(result,signature);
  }
  overlay.querySelector('.fc-result-review').onclick=()=>{dismissed=lastSignature;overlay.hidden=true};
  overlay.querySelector('.fc-result-rematch').onclick=()=>{dismissed=lastSignature;overlay.hidden=true;document.querySelector('#new')?.click()};
  overlay.addEventListener('click',e=>{if(e.target===overlay){dismissed=lastSignature;overlay.hidden=true}});
  const obs=new MutationObserver(()=>queueMicrotask(check));
  function attach(){const app=document.querySelector('#app');if(app){obs.observe(app,{subtree:true,childList:true,characterData:true,attributes:true});check()}else setTimeout(attach,50)}
  attach();
})();