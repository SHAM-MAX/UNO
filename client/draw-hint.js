export function initDrawHint(app){
 const hint=document.createElement('span');hint.id='deckDrawHint';hint.hidden=true;hint.textContent='👉';hint.setAttribute('aria-hidden','true');app.el.drawPileBtn.append(hint);
 app.el.btnDrawAction.hidden=true;
 let timer=null,key=null;
 const eligible=()=>!document.hidden&&app.gameState?.status==='playing'&&app.clientView?.isMyTurn&&app.clientView?.canDraw&&!app.gameState.pendingAction&&!app.gameState.rouletteInProgress&&!app.connectionRecovering&&!app.isPlayInFlight&&!app.isMoveInFlight&&!app.localPlayPreview;
 const clear=()=>{clearTimeout(timer);timer=null;hint.hidden=true;app.el.drawPileBtn.classList.remove('deck-needs-draw');};
 app.dismissDrawHint=()=>{clear();key=null;};
 app.syncDrawHint=()=>{if(!eligible()){clear();key=null;return;}const s=app.gameState,next=[s.roomId,s.matchId,s.currentTurn,s.turnDeadline,s.pendingDrawPenalty,app.clientView.myHand.map(c=>c.id).join(',')].join('|');if(next===key)return;clear();key=next;timer=setTimeout(()=>{timer=null;if(!eligible())return;hint.hidden=false;app.el.drawPileBtn.classList.add('deck-needs-draw');},5000);};
 document.addEventListener('visibilitychange',()=>{app.dismissDrawHint();if(!document.hidden)app.syncDrawHint();});
}
