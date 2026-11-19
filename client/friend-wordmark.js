// Keep the exact logo visible until its one-time walking entrance can render.
export function initFriendWordmark() {
  const artwork = new Image();
  artwork.src = new URL('./assets/friends-uno-nav.png',import.meta.url).href;
  artwork.decode().then(()=>requestAnimationFrame(()=>{
    if(matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('reduced-motion')) return;
    document.querySelectorAll('.nav-friends-wordmark').forEach(mark=>{
      mark.classList.add('friends-ready');
      mark.querySelectorAll('animateTransform').forEach(limb=>limb.beginElement());
    });
  })).catch(()=>{});
}
