// UNO Arena Service Worker
const CACHE_NAME = 'uno-arena-v1';
const STATIC_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/home.css',
  '/lobby.css',
  '/arena.css',
  '/mobile.css',
  '/app.js',
  '/manifest.json',
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
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
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

  // Stale-while-revalidate for static assets (CSS, JS, images)
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

