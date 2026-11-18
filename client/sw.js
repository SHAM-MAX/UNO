// UNO Arena Service Worker — Version 2.2.0
const CACHE_NAME = 'uno-arena-install-v12';
const STATIC_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/install.js?v=1',
  '/install.css?v=1',
  '/style.css?v=2.2.0',
  '/home.css?v=2.2.0',
  '/lobby.css?v=2.2.0',
  '/arena.css?v=2.2.1',
  '/mobile.css?v=2.2.0',
  '/app.js?v=2.2.0',
  '/audio.js',
  '/cardGraphics.js',
  '/shared/constants.js',
  '/shared/rules.js',
  '/manifest.json',
  '/branding.css?v=2',
  '/victory.css?v=3',
  '/mobile-layout.css?v=2',
  '/assets/victory-champion-trophy.png',
  '/assets/uno-brand-v4.png',
  '/assets/uno-brand-v4-32.png?v=4',
  '/assets/uno-brand-v4-180.png?v=4',
  '/assets/uno-brand-v4-192.png',
  '/assets/uno-brand-v4-512.png',
  '/assets/tabletop-wood.jpg',
  '/assets/uno-arena-mobile-hero.png',
  '/assets/game-modes/classic-card.png',
  '/assets/game-modes/flip-card.png',
  '/assets/game-modes/no-mercy-card.png',
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
      fetch(event.request)
        .catch(() => caches.match('/index.html') || caches.match('/'))
    );
    return;
  }

  // Network-first with cache fallback for code assets (CSS, JS) to guarantee latest styles/logic
  const isCodeAsset = url.pathname.endsWith('.css') || url.pathname.endsWith('.js') || url.search.includes('v=');
  if (isCodeAsset) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Stale-while-revalidate for static media assets (images, audio, fonts)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
