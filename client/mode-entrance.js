// A dealt +10 card turns into the live form; no screenshot or duplicate controls.
export function playNoMercyEntrance(card) {
  if (!card || matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('reduced-motion')) return () => {};
  const rect = card.getBoundingClientRect();
  if (!rect.width || !rect.height) return () => {};
  const face = document.createElement('img');
  face.src = new URL('./assets/no-mercy-cards/wild_draw10.webp', import.meta.url).href;
  face.alt = '';
  face.setAttribute('aria-hidden', 'true');
  face.dataset.modeEntrance = 'no-mercy';
  Object.assign(face.style, {
    position:'fixed', left:rect.left+'px', top:rect.top+'px', width:rect.width+'px', height:rect.height+'px',
    objectFit:'fill', borderRadius:'28px', pointerEvents:'none', zIndex:'110',
    filter:'drop-shadow(0 24px 30px #0009)', transformOrigin:'center',
  });
  document.body.append(face);
  const flight = face.animate([
    {opacity:0, transform:'perspective(1200px) translate(34vw, -20vh) scale(.18) rotate(-42deg) rotateY(0deg)', offset:0},
    {opacity:1, transform:'perspective(1200px) translate(14vw, -9vh) scale(.45) rotate(12deg) rotateY(180deg)', offset:.38},
    {opacity:1, transform:'perspective(1200px) translate(0, 0) scale(1) rotate(-4deg) rotateY(360deg)', offset:.78},
    {opacity:1, transform:'perspective(1200px) translate(0, 0) scale(1) rotate(0deg) rotateY(450deg)', offset:1},
  ], {duration:760, easing:'cubic-bezier(.2,.65,.3,1)', fill:'forwards'});
  const reveal = card.animate([
    {opacity:0, transform:'perspective(1200px) rotateY(-90deg)', offset:0},
    {opacity:0, transform:'perspective(1200px) rotateY(-90deg)', offset:.65},
    {opacity:1, transform:'perspective(1200px) rotateY(7deg) scale(1.015)', offset:.9},
    {opacity:1, transform:'perspective(1200px) rotateY(0deg) scale(1)', offset:1},
  ], {duration:1170, easing:'cubic-bezier(.16,1,.3,1)'});
  const wasInert = card.inert;
  card.inert = true;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    flight.cancel(); reveal.cancel(); face.remove(); card.inert = wasInert;
    window.removeEventListener('resize', cleanup);
  };
  flight.finished.then(()=>face.remove()).catch(()=>{});
  reveal.finished.then(cleanup).catch(()=>{});
  window.addEventListener('resize', cleanup, {once:true});
  return cleanup;
}
