// Wait for artwork before starting: a cold network must not animate an empty image.
const artworkByMode = { no_mercy: [
  './assets/no-mercy-cards/wild_draw10.webp',
  './assets/no-mercy-setup-bg.jpg',
  './assets/no-mercy-card-canvas.png',
  './assets/no-mercy-card-header.png',
], flip: [
  './assets/flip-cards/Purple_FLIP.jpg',
  './assets/uno-flip-setup-bg.jpg',
  './assets/uno-flip-create-reference.png',
] };
for (const mode of Object.keys(artworkByMode)) artworkByMode[mode] = artworkByMode[mode].map(path => new URL(path, import.meta.url).href);
const artworkReady = {};
export function preloadNoMercyEntrance() { return preloadModeEntrance('no_mercy'); }
export function preloadFlipEntrance() { return preloadModeEntrance('flip'); }
function preloadModeEntrance(mode) {
  return artworkReady[mode] ||= Promise.all(artworkByMode[mode].map(src => {
    const image = new Image();
    image.src = src;
    return image.decode();
  })).catch(() => { artworkReady[mode] = null; return false; });
}
export function playNoMercyEntrance(card) { return playModeEntrance(card,'no_mercy'); }
export function playFlipEntrance(card) { return playModeEntrance(card,'flip'); }
function playModeEntrance(card, mode) {
  const artworkUrls = artworkByMode[mode];
  if (!card || matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('reduced-motion')) return () => {};
  let cleaned = false;
  let face, flight, reveal;
  const wasInert = card.inert;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    flight?.cancel(); reveal?.cancel(); face?.remove(); card.inert = wasInert;
    window.removeEventListener('resize', reposition);
  };
  const reposition = () => {
    if (!face) return;
    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return cleanup();
    Object.assign(face.style, {left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
  };
  const start = async () => {
    const ready = await preloadModeEntrance(mode);
    if (cleaned || ready === false || !card.isConnected) return;
    // Let the newly opened screen finish layout before measuring its form.
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (cleaned || !card.getBoundingClientRect().width) return;
    face = document.createElement('img');
    face.src = artworkUrls[0];
    face.alt = '';
    face.setAttribute('aria-hidden','true');
    face.dataset.modeEntrance = mode;
    Object.assign(face.style, {
      position:'fixed',objectFit:'fill',borderRadius:'28px',pointerEvents:'none',zIndex:'110',
      filter:'drop-shadow(0 24px 30px #0009)',transformOrigin:'center',
    });
    // Decode this element too, even when the resource is already cached.
    await face.decode().catch(()=>{});
    if (cleaned) return;
    reposition();
    document.body.append(face);
    card.inert = true;
    flight = face.animate([
      {opacity:0,transform:'perspective(1200px) translate(34vw,-20vh) scale(.18) rotate(-42deg) rotateY(0deg)',offset:0},
      {opacity:1,transform:'perspective(1200px) translate(14vw,-9vh) scale(.45) rotate(12deg) rotateY(180deg)',offset:.38},
      {opacity:1,transform:'perspective(1200px) translate(0,0) scale(1) rotate(-4deg) rotateY(360deg)',offset:.78},
      {opacity:1,transform:'perspective(1200px) translate(0,0) scale(1) rotate(0deg) rotateY(450deg)',offset:1},
    ],{duration:1100,easing:'cubic-bezier(.2,.65,.3,1)',fill:'forwards'});
    reveal = card.animate([
      {opacity:0,transform:'perspective(1200px) rotateY(-90deg)',offset:0},
      {opacity:0,transform:'perspective(1200px) rotateY(-90deg)',offset:1100/1600},
      {opacity:1,transform:'perspective(1200px) rotateY(7deg) scale(1.015)',offset:.93},
      {opacity:1,transform:'perspective(1200px) rotateY(0deg) scale(1)',offset:1},
    ],{duration:1600,easing:'linear'});
    flight.finished.then(()=>face.remove()).catch(()=>{});
    reveal.finished.then(cleanup).catch(()=>{});
    window.addEventListener('resize',reposition);
  };
  start().catch(cleanup);
  return cleanup;
}
