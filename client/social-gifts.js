const emotes={laugh:'😄',shocked:'😱',fire:'🔥',lightning:'⚡',skull:'💀',cry:'😭'};
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||document.body.classList.contains('reduced-motion');
export function initSocialGifts(app){
 const active=new Set();
 const profile=id=>id===app.playerId?app.el.localPlayerProfile:document.querySelector('[data-profile-id="'+id+'"] .opponent-card-badge');
 const clear=()=>{for(const node of active){node.getAnimations().forEach(a=>a.cancel());node.remove();}active.clear();};
 document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});
 app.syncSocialGifts=()=>{
  if(app.gameState?.status!=='playing'){clear();return;}
  for(const player of app.gameState.players){if(player.id===app.playerId)continue;const badge=profile(player.id);if(!badge)continue;let gift=badge.querySelector('.opponent-gift');if(player.isEliminated){gift?.remove();continue;}if(gift)continue;
   gift=document.createElement('button');gift.type='button';gift.className='opponent-gift';gift.setAttribute('aria-label','Send animation to '+player.name);gift.title='Send animation to '+player.name;gift.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9C3 9 5 1 9 4l3 5Zm0 0c9 0 7-8 3-5l-3 5Z"/></svg>';
   gift.addEventListener('click',event=>{event.stopPropagation();app.giftTargetPlayerId=player.id;app.el.reactionTray.dataset.targetName='To '+(app.gameState.players.find(p=>p.id===player.id)?.name||'player');app.el.reactionTray.style.display='flex';app.el.reactionTray.querySelector('button')?.focus();});badge.append(gift);
  }
 };
 app.showGiftReaction=data=>{
  if(document.hidden||app.gameState?.status!=='playing'||!emotes[data?.emoteId])return;
  const sender=app.gameState.players.find(p=>p.id===data.playerId);if(!sender)return;
  const targets=data.targetPlayerId?app.gameState.players.filter(p=>p.id===data.targetPlayerId):app.gameState.players.filter(p=>p.id!==data.playerId&&!p.isEliminated);
  const source=profile(data.playerId)?.getBoundingClientRect();if(!source?.width)return;
  const add=(className)=>{if(active.size>=24)return null;const node=document.createElement('span');node.className=className;node.textContent=emotes[data.emoteId];node.setAttribute('aria-hidden','true');document.body.append(node);active.add(node);return node;};
  const finish=node=>{node.remove();active.delete(node);};
  for(const target of targets){const end=profile(target.id)?.getBoundingClientRect();if(!end?.width)continue;const node=add('gift-flight');if(!node)break;const x=source.left+source.width/2-20,y=source.top+source.height/2-20,dx=end.left+end.width/2-20-x,dy=end.top+end.height/2-20-y;node.style.left=x+'px';node.style.top=y+'px';node.dataset.sender=data.playerId;node.dataset.recipient=target.id;
   const arrival=()=>{finish(node);if(data.targetPlayerId&&target.id===app.playerId){const burst=add('gift-received');if(!burst)return;burst.setAttribute('role','status');burst.removeAttribute('aria-hidden');burst.setAttribute('aria-label',sender.name+' sent you '+data.emoteId);burst.dataset.sender=data.playerId;const motion=burst.animate(reduced()?[{opacity:1},{opacity:0}]:[{opacity:0,transform:'scale(.45) rotate(-12deg)'},{opacity:1,transform:'scale(1.12) rotate(8deg)',offset:.22},{opacity:1,transform:'scale(1) rotate(-5deg)',offset:.7},{opacity:0,transform:'scale(1.2) translateY(-30px)'}],{duration:1500,easing:'ease-out'});motion.onfinish=()=>finish(burst);}};
   const motion=node.animate(reduced()?[{opacity:1},{opacity:0}]:[{opacity:0,transform:'translate(0,0) scale(.5)'},{opacity:1,transform:'translate('+dx*.45+'px,'+(dy*.45-45)+'px) scale(1.2) rotate(-12deg)',offset:.5},{opacity:1,transform:'translate('+dx+'px,'+dy+'px) scale(.8) rotate(8deg)'}],{duration:reduced()?200:750,easing:'cubic-bezier(.2,.65,.3,1)'});motion.onfinish=arrival;
  }
 };
}
