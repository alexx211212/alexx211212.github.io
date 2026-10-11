/* Z.ai Service Worker
 * Стратегии:
 *  - App shell (префетч): cache-first
 *  - Навигация: network-first -> cache -> /offline
 *  - Статика (icons, manifest, _next): network-first (кэш — только офлайн-фолбэк)
 *  - /api/*: network-only (стриминг не кэшируем)
 */
const VERSION = 'v20';
const SHELL_CACHE = `shell-${VERSION}`;
const ASSET_CACHE = `assets-${VERSION}`;
const OFFLINE_URL = '/offline.html';

const SHELL_ASSETS = [
  '/',
  OFFLINE_URL,
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
  '/favicon.png',
  '/css/v16x.css',
  '/js/v16x.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_ASSETS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('shell-') && k !== SHELL_CACHE)
          .concat(keys.filter((k) => k.startsWith('assets-') && k !== ASSET_CACHE))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // POST /api/chat — всегда сеть

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // network-only

  // Навигация: сеть первая, офлайн-фолбэк
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('/', fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match('/')) ||
            (await cache.match(OFFLINE_URL)) ||
            new Response('Офлайн', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
          );
        }
      })()
    );
    return;
  }

  // Статика: NETWORK-FIRST с кэшем как офлайн-фолбэком
  // (v18: раньше был cache-first — устройства со старым кэшем неделями видели
  //  устаревший UI после обновлений сайта; теперь свежесть всегда в приоритете)
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/favicon.png'
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        try {
          const fresh = await fetch(request);
          if (fresh.ok) cache.put(request, fresh.clone());
          return fresh;
        } catch {
          const cached = await cache.match(request);
          if (cached) return cached;
          throw new Error('offline and not cached');
        }
      })()
    );
  }
});

// Сообщения от клиента (например, запрос на немедленное обновление)
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
