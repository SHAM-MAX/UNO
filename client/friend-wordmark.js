// Keep the approved logo intact; reveal it only after its image is decoded.
export function initFriendWordmark() {
  const artwork = new Image();
  artwork.src = new URL('./assets/friends-uno-nav.png',import.meta.url).href;
  artwork.decode().then(()=>requestAnimationFrame(()=>{
    if(matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('reduced-motion')) return;
    document.querySelectorAll('.nav-friends-wordmark').forEach(mark=>mark.classList.add('friends-ready'));
  })).catch(()=>{});
}
