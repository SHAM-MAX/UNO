import { getActiveFace } from '../shared/deck.js';

// Table effects are visual-only: they never delay or alter an authoritative move.
export function animatePowerCard(app, previous) {
  const state = app.gameState;
  if (!state?.topDiscard || document.body.classList.contains('performance-lite') || document.body.classList.contains('reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const changed = state.topDiscard.id !== previous.topDiscard?.id;
  const flipped = state.mode === 'flip' && state.flipSide !== previous.flipSide;
  if (!changed && !flipped) return;
  const face = getActiveFace(state.topDiscard, state.mode, flipped ? previous.flipSide : state.flipSide);
  if (!face || (face.type === 'number' && ![0,7].includes(face.value))) return;
  if (face.type === 'number' && state.mode !== 'no_mercy') return;
  const pile = app.el.discardPile;
  const rect = pile.getBoundingClientRect();
  if (!rect.width) return;
  const colors = {red:'#ff5b5b',yellow:'#ffe35a',blue:'#57afff',green:'#4fdf9b',teal:'#45e2d0',orange:'#ffa44d',pink:'#ff75c2',purple:'#bb83ff'};
  const color = colors[state.currentColor || face.color] || '#ffe35a';
  const reverse = face.type.includes('reverse');
  const skip = face.type.includes('skip');
  const draw = face.type.includes('draw');
  const transfer = face.type === 'number';
  const path = reverse || transfer
    ? '<path d="M15 26a19 19 0 0 1 33-8l6 7M54 11v14H40M49 38a19 19 0 0 1-33 8l-6-7M10 53V39h14"/>'
    : skip ? '<circle cx="32" cy="32" r="22"/><path d="m17 17 30 30"/>'
    : draw ? '<rect x="12" y="18" width="26" height="34" rx="4"/><rect x="25" y="9" width="26" height="34" rx="4"/><path d="M38 17v17m-8-8h16"/>'
    : '<path d="M13 18h38v29H13zM23 10l-10 8 10 8m18 13 10 8-10 8"/>';
  const effect = document.createElement('div');
  effect.className = 'power-card-effect';
  effect.setAttribute('aria-hidden','true');
  effect.innerHTML = `<span class="power-card-ring"></span><svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const size = Math.min(96,Math.max(58,rect.width*.85));
  const left = rect.right+8+size<innerWidth-12?rect.right+8:rect.left-size-8;
  Object.assign(effect.style,{left:left+'px',top:rect.top+rect.height/2-size/2+'px',width:size+'px',height:size+'px',color});
  document.body.append(effect);
  const animation = effect.animate([
    {opacity:0,transform:'scale(.4) rotate(-18deg)'},
    {opacity:1,transform:'scale(1.12) rotate(0deg)',offset:.3},
    {opacity:1,transform:`scale(1) rotate(${reverse ? 160 : 0}deg)`,offset:.68},
    {opacity:0,transform:`scale(1.4) rotate(${reverse ? 200 : 8}deg)`},
  ],{duration:850,easing:'cubic-bezier(.16,1,.3,1)'});
  app.classicAnimationCleanups ||= new Set();
  const dispose=()=>{animation.cancel();effect.remove();app.classicAnimationCleanups.delete(dispose);};
  app.classicAnimationCleanups.add(dispose);animation.onfinish=dispose;
  if (flipped) {
    const cards=[...app.el.playerHandCards.querySelectorAll('.game-card'),...app.el.opponentsRow.querySelectorAll('.opponent-fan-card')].slice(0,32);
    cards.forEach((card,index)=>{
      const motion=card.animate([{transform:'perspective(700px) rotateY(90deg)',opacity:.4},{transform:'perspective(700px) rotateY(0deg)',opacity:1}],{duration:480,delay:Math.min(index*14,180),easing:'cubic-bezier(.2,.7,.3,1)'});
      const clean=()=>{motion.cancel();app.classicAnimationCleanups.delete(clean);};
      app.classicAnimationCleanups.add(clean);motion.onfinish=clean;
    });
  }
}
