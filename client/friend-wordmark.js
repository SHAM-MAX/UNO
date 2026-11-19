// Start the one-time entrance only after the supplied friendship artwork is ready.
export function initFriendWordmark() {
  const artwork = new Image();
  artwork.src = new URL('./assets/friends-uno-nav.png',import.meta.url).href;
  artwork.decode().then(()=>requestAnimationFrame(()=>{
    document.querySelectorAll('.nav-friends-wordmark').forEach(mark=>mark.classList.add('friends-ready'));
  })).catch(()=>{});
}
