export function syncDrawFourDecision(app){
 const action=app.gameState?.pendingAction;
 let overlay=document.getElementById('drawFourDecision');
 if(app.gameState?.status!=='playing'||action?.type!=='draw4_challenge'){if(overlay){const heldFocus=overlay.contains(document.activeElement);overlay.hidden=true;overlay.dataset.action='';if(heldFocus)app.el.drawPileBtn?.focus({preventScroll:true});}return;}
 if(!overlay){overlay=document.createElement('div');overlay.id='drawFourDecision';overlay.className='draw-four-decision';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','drawFourHeading');overlay.innerHTML='<section class="draw-four-panel"><div class="draw-four-symbol" aria-hidden="true">+4</div><h2 id="drawFourHeading"></h2><p id="drawFourDescription"></p><div class="draw-four-actions"><button type="button">Accept +4</button><button type="button">Challenge</button></div></section>';overlay.tabIndex=-1;overlay.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const available=[...overlay.querySelectorAll('button')].filter(button=>!button.disabled&&!button.closest('[hidden]'));event.preventDefault();if(!available.length){overlay.focus();return;}const index=available.indexOf(document.activeElement);available[(index+(event.shiftKey?-1:1)+available.length)%available.length].focus();});document.body.append(overlay);}
 const mine=action.targetPlayerId===app.playerId,buttons=[...overlay.querySelectorAll('button')],fresh=overlay.dataset.action!==action.id;
 overlay.hidden=false;overlay.dataset.action=action.id;
 overlay.querySelector('h2').textContent=mine?'Accept or challenge?':'Challenge in progress';
 overlay.querySelector('p').textContent=mine?'Accept to draw 4 cards, or challenge the Wild Draw Four. A failed challenge means you draw 6 cards.':'Waiting for the player to accept or challenge. Play resumes after their decision.';
 overlay.querySelector('.draw-four-actions').hidden=!mine;
 for(const [i,button]of buttons.entries()){button.disabled=app.isPlayInFlight;button.onclick=()=>{if(!mine||app.isPlayInFlight||app.gameState?.pendingAction?.id!==action.id)return;app.isPlayInFlight=true;buttons.forEach(b=>b.disabled=true);app.send({type:i?'challenge_draw4':'draw_card'});};}
 app.cancelCardDrag?.();
 if(fresh){if(mine)buttons[0].focus({preventScroll:true});else overlay.focus({preventScroll:true});}
}
