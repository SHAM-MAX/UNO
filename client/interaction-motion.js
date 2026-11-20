const states=new WeakMap(),cleanups=new Set();
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||document.body.classList.contains('reduced-motion');
function track(finish){cleanups.add(finish);return()=>{finish();cleanups.delete(finish);};}
export function clearInteractionMotion(){for(const cleanup of [...cleanups])cleanup();cleanups.clear();}
export function jumpControl(element){
 if(!element||reduced())return;
 states.get(element)?.();
 const animation=element.animate([{opacity:0,transform:'translateY(26px) scale(.82)'},{opacity:1,transform:'translateY(-7px) scale(1.04)',offset:.6},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:330,easing:'cubic-bezier(.2,.7,.25,1)'});
 const cleanup=track(()=>{animation.cancel();if(states.get(element)===cleanup)states.delete(element);});states.set(element,cleanup);animation.onfinish=cleanup;
}
export function exitControl(element){
 if(!element||reduced()||!element.getClientRects().length)return;
 states.get(element)?.();
 const rect=element.getBoundingClientRect(),style=getComputedStyle(element),clone=element.cloneNode(true);
 for(const name of style)clone.style.setProperty(name,style.getPropertyValue(name));
 clone.removeAttribute('id');clone.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));clone.className='interaction-control-exit';clone.inert=true;clone.setAttribute('aria-hidden','true');
 Object.assign(clone.style,{position:'fixed',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',margin:'0',pointerEvents:'none',zIndex:'180',animation:'none',transition:'none',transform:'none'});document.body.append(clone);
 const animation=clone.animate([{opacity:1,transform:'translateY(0) scale(1)'},{opacity:1,transform:'translateY(-4px) scale(1.02)',offset:.25},{opacity:0,transform:'translateY(18px) scale(.86)'}],{duration:170,easing:'ease-in'});
 const cleanup=track(()=>{animation.cancel();clone.remove();if(states.get(element)===cleanup)states.delete(element);});states.set(element,cleanup);animation.onfinish=cleanup;
}
export function setActionVisible(element,visible){
 if(!element)return;
 const wasVisible=element.style.display!=='none'&&element.getClientRects().length>0;
 if(Boolean(visible)===wasVisible)return;
 const siblings=[...element.parentElement.children].filter(n=>n!==element&&n.getClientRects().length).map(n=>[n,n.getBoundingClientRect()]);
 if(!visible)exitControl(element);
 element.style.display=visible?'inline-flex':'none';element.setAttribute('aria-hidden',String(!visible));
 if(visible)jumpControl(element);
 if(!reduced())for(const [node,before] of siblings){const after=node.getBoundingClientRect(),dx=before.left-after.left;if(Math.abs(dx)>1)node.animate([{transform:`translateX(${dx}px)`},{transform:'none'}],{duration:180,easing:'ease-out'});}
}
export function setGameModal(modal,visible){
 if(!modal)return;
 if(visible===modal.classList.contains('active'))return;
 states.get(modal)?.();
 const panel=modal.querySelector('.modal-card,.caught-failed-card');
 modal.setAttribute('aria-hidden',String(!visible));modal.inert=!visible;
 if(visible){
   modal.style.display='flex';modal.style.pointerEvents='';modal.classList.remove('interaction-exiting');modal.classList.add('active');
   if(reduced()||!panel)return;
   panel.classList.add('interaction-motion-panel');
   const backdrop=modal.animate([{opacity:0},{opacity:1}],{duration:180});
   const card=panel.animate([{opacity:0,transform:'translateY(24px) scale(.94)'},{opacity:1,transform:'translateY(-4px) scale(1.015)',offset:.65},{opacity:1,transform:'none'}],{duration:300,easing:'cubic-bezier(.2,.7,.3,1)'});
   const cleanup=track(()=>{backdrop.cancel();card.cancel();if(states.get(modal)===cleanup)states.delete(modal);});states.set(modal,cleanup);card.onfinish=cleanup;
 }else{
   modal.classList.remove('active');modal.classList.add('interaction-exiting');modal.style.pointerEvents='none';
   const finish=()=>{modal.style.display='none';modal.classList.remove('interaction-exiting');};
   if(reduced()||!panel){finish();return;}
   const backdrop=modal.animate([{opacity:1},{opacity:0}],{duration:170});
   const card=panel.animate([{opacity:1,transform:'none'},{opacity:0,transform:'translateY(16px) scale(.96)'}],{duration:170,easing:'ease-in'});
   const cleanup=track(()=>{backdrop.cancel();card.cancel();finish();if(states.get(modal)===cleanup)states.delete(modal);});states.set(modal,cleanup);backdrop.onfinish=cleanup;
 }
}
