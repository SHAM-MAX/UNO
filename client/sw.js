// UNO Arena Service Worker — Version 2.2.0
const CACHE_NAME = 'uno-arena-launch-intro-v81';
const STATIC_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/navigation.js',
  '/mode-entrance.js',
  '/power-effects.js',
  '/game-experience.js',
  '/music.js',
  '/friend-wordmark.js',
  '/assets/flip-cards/Purple_FLIP.jpg',
  '/assets/no-mercy-cards/wild_draw10.webp',
  '/install.js?v=1',
  '/install.css?v=1',
  '/settings.css?v=1',
  '/style.css?v=2.2.0',
  '/home.css?v=2.2.1',
  '/lobby.css?v=2.2.0',
  '/arena.css?v=2.2.6',
  '/mobile.css?v=2.2.0',
  '/app.js?v=2.2.0',
  '/audio.js',
  '/cardGraphics.js',
  '/card-atlas.js',
  '/play-motion.js',
  '/play-motion.css?v=1',
  '/draw-four-decision.js',
  '/local-play-feedback.js',
  '/performance.js',
  '/arena-menu.js',
  '/player-hud.js',
  '/draw-hint.js',
  '/live-actions.js',
  '/social-gifts.js',
  '/reaction-stickers.js',
  '/reaction-stickers.css?v=1',
  '/shared/reactions.js',
  '/assets/action-buttons/gift.png',
  '/assets/action-buttons/leave.png',
  '/assets/action-buttons/call-uno.png',
  '/assets/action-buttons/caught.png',
  '/assets/action-buttons/pass-turn.png',
  '/live-actions.css?v=1',
  '/player-hud.css?v=1',
  '/card-atlas-manifest.js',
  '/card-atlas.css?v=1',
  '/instant-cards.js',
  '/interaction-motion.js',
  '/social-features.js',
  '/table-tools.js',
  '/round-seating.js',
  '/round-seating.css?v=1',
  '/table-tools.css?v=1',
  '/social-features.css?v=1',
  '/vendor/qrcode.mjs',
  '/interaction-motion.css?v=1',
  '/shared/constants.js',
  '/shared/rules.js',
  '/manifest.json',
  '/branding.css?v=6',
  '/nav-brand-theme.css?v=1',
  '/victory.css?v=4',
  '/mobile-layout.css?v=6',
  '/assets/uno-brand-v4.png',
  '/assets/uno-launcher-yellow-32.png',
  '/assets/uno-launcher-yellow-180.png',
  '/assets/uno-wordmark-512.png',
  '/assets/uno-launcher-yellow-192.png',
  '/assets/uno-launcher-yellow-512.png',
  '/assets/uno-classic-back.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_SHELL_ASSETS).catch((err) => {
        console.warn('[SW] Pre-caching partial failure, proceeding:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Purging outdated cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Bypass API calls, websockets, and health checks completely
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/health') ||
    url.protocol === 'ws:' ||
    url.protocol === 'wss:' ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // Network-first with cache fallback for navigation / HTML
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'reload' })
        .catch(async () => (await caches.match('/index.html')) || (await caches.match('/')) || Response.error())
    );
    return;
  }

  // Version-scoped cache-first assets: no duplicate requests during play.
  event.respondWith(caches.open(CACHE_NAME).then(async cache=>{
    const cached=await cache.match(event.request);if(cached)return cached;
    const response=await fetch(event.request);
    if(response.status===200&&response.type==='basic')event.waitUntil(cache.put(event.request,response.clone()).catch(()=>{}));
    return response;
  }));
});
